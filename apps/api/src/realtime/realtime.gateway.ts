import {
  ConsoleLogger,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'cookie';
import { AuthService } from '../auth/auth.service';
import { PlatformAuthService } from '../platform-admin/platform-auth.service';
import { AuthConfig } from '../auth/auth.config';
import { readToken } from '../auth/auth.guard';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import {
  conversationWhere,
  viewPermissions,
} from '../conversations/conversation-access';
import type { TenantScope } from '../tenancy/tenant.context';
import { RealtimeEvents, type RealtimeEvent } from './realtime.events';
interface Connection {
  socket: WebSocket;
  scope: TenantScope;
  alive: boolean;
  pending: number;
  tail: Promise<void>;
}
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  private readonly rooms = new Map<string, Set<Connection>>();
  private readonly logger = new ConsoleLogger('RealtimeGateway');
  private http?: Server;
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private unsubscribeSession?: () => void;
  private checking = false;
  private stopped = false;
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly auth: AuthService,
    private readonly platformAuth: PlatformAuthService,
    private readonly config: AuthConfig,
    private readonly database: DatabaseService,
    private readonly events: RealtimeEvents,
  ) {}
  onModuleInit() {
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.http.on('upgrade', this.upgrade);
    this.unsubscribe = this.events.subscribe((event) => this.deliver(event));
    this.unsubscribeSession = this.events.onSessionInvalidated((id) => {
      for (const room of this.rooms.values())
        for (const connection of room)
          if (connection.scope.sessionId === id)
            connection.socket.close(4403, 'Context changed');
    });
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, 20000);
    this.timer.unref();
  }
  private valid(scope: TenantScope) {
    return this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, viewPermissions),
      select: { id: true },
    });
  }
  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    void this.connect(request, socket, head);
  };
  private async connect(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    // API owns this HTTP server. No arbitrary room, ID or token query is supported.
    const reject = () => {
      if (!socket.destroyed)
        socket.end(
          'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
    };
    const timeout = setTimeout(() => socket.destroy(), 5000);
    socket.on('error', () => {
      /* No credentials or raw upgrade request in logs. */
    });
    try {
      if (
        this.stopped ||
        request.url !== '/realtime' ||
        request.headers.origin !== this.config.origin
      ) {
        reject();
        return;
      }
      const cookies = parse(request.headers.cookie ?? '');
      const platformTenantToken =
        cookies[this.platformAuth.tenantAccessCookieName];
      const platformAccess = platformTenantToken
        ? await this.platformAuth.authenticateTenantAccess(platformTenantToken)
        : null;
      const clinicalToken = platformTenantToken
        ? undefined
        : readToken(request, this.config);
      if (!platformAccess && !clinicalToken) {
        reject();
        return;
      }
      const identity = platformAccess
        ? {
            identity: platformAccess.identity,
            sessionId: platformAccess.sessionId,
            activeTenantId: platformAccess.tenantId,
          }
        : await this.auth.authenticate(clinicalToken!);
      if (!identity.activeTenantId) {
        reject();
        return;
      }
      const scope: TenantScope = {
        userId: identity.identity.id,
        sessionId: identity.sessionId,
        tenantId: identity.activeTenantId,
        ...(platformAccess
          ? { platformTenantAccessId: platformAccess.accessId }
          : {}),
      };
      if (!(await this.valid(scope)) || socket.destroyed || this.stopped) {
        reject();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (ws) => {
        const connection: Connection = {
          socket: ws,
          scope,
          alive: true,
          pending: 0,
          tail: Promise.resolve(),
        };
        let room = this.rooms.get(scope.tenantId);
        if (!room) {
          room = new Set();
          this.rooms.set(scope.tenantId, room);
        }
        room.add(connection);
        ws.on('pong', () => {
          connection.alive = true;
        });
        ws.on('message', () => ws.close(1008, 'Server events only'));
        ws.on('error', () => {
          this.logger.warn({
            action: 'socket_error',
            tenantId: scope.tenantId,
            userId: scope.userId,
          });
        });
        ws.on('close', () => {
          room!.delete(connection);
          if (!room!.size) this.rooms.delete(scope.tenantId);
          this.logger.log({
            action: 'closed',
            tenantId: scope.tenantId,
            userId: scope.userId,
          });
        });
        ws.send(
          JSON.stringify({ type: 'realtime.ready', tenantId: scope.tenantId }),
        );
        this.logger.log({
          action: 'opened',
          tenantId: scope.tenantId,
          userId: scope.userId,
        });
      });
    } catch {
      reject();
      this.logger.warn({ action: 'connection_rejected' });
    } finally {
      clearTimeout(timeout);
    }
  }
  private deliver(event: RealtimeEvent) {
    const room = this.rooms.get(event.tenantId);
    if (!room) return;
    for (const connection of room) {
      if (++connection.pending > 100) {
        connection.socket.close(1013, 'Resynchronize');
        connection.pending--;
        continue;
      }
      connection.tail = connection.tail
        .then(async () => {
          const ws = connection.socket;
          if (ws.readyState !== WebSocket.OPEN) return;
          if (!(await this.valid(connection.scope))) {
            ws.close(4403, 'Access changed');
            return;
          }
          // Protect even against a malformed internal event or an ID of another tenant.
          const where = {
            id: event.conversationId,
            ...conversationWhere(connection.scope, viewPermissions),
          };
          const permitted = event.messageId
            ? await this.database.client.message.findFirst({
                where: {
                  id: event.messageId,
                  tenantId: event.tenantId,
                  conversationId: event.conversationId,
                  conversation: where,
                },
                select: { id: true },
              })
            : await this.database.client.conversation.findFirst({
                where,
                select: { id: true },
              });
          if (!permitted || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 1024 * 1024) {
            ws.close(1013, 'Resynchronize');
            return;
          }
          ws.send(JSON.stringify(event), (error) => {
            if (error) {
              this.logger.warn({
                action: 'delivery_failed',
                eventId: event.eventId,
                tenantId: event.tenantId,
              });
              ws.terminate();
            }
          });
        })
        .catch(() => {
          this.logger.warn({
            action: 'delivery_failed',
            eventId: event.eventId,
            tenantId: event.tenantId,
          });
          connection.socket.close(1011, 'Unavailable');
        })
        .finally(() => {
          connection.pending--;
        });
    }
  }
  async heartbeat() {
    if (this.checking || this.stopped) return;
    this.checking = true;
    try {
      await Promise.all(
        [...this.rooms.values()]
          .flatMap((room) => [...room])
          .map(async (connection) => {
            try {
              if (!connection.alive) {
                connection.socket.terminate();
                return;
              }
              if (!(await this.valid(connection.scope))) {
                connection.socket.close(4403, 'Access changed');
                return;
              }
              if (connection.socket.readyState === WebSocket.OPEN) {
                connection.alive = false;
                connection.socket.ping();
              }
            } catch {
              connection.socket.close(1011, 'Unavailable');
            }
          }),
      );
    } finally {
      this.checking = false;
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    this.unsubscribeSession?.();
    this.http?.off('upgrade', this.upgrade);
    for (const room of this.rooms.values())
      for (const connection of room) connection.socket.terminate();
    this.rooms.clear();
    this.server.close();
  }
}
