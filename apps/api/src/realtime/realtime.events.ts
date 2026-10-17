import { ConsoleLogger, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
export const realtimeTypes = [
  'message.status_updated',
  'conversation.sla_updated',
  'conversation.created',
  'conversation.updated',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.active_patient_changed',
  'message.created',
  'message.delivered',
  'message.read',
] as const;
export interface EventDraft {
  type: (typeof realtimeTypes)[number];
  tenantId: string;
  conversationId: string;
  messageId?: string;
}
export interface RealtimeEvent extends EventDraft {
  eventId: string;
}
// Application events, independent of sockets. Never execute transport within a DB transaction.
@Injectable()
export class RealtimeEvents {
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private readonly invalidations = new Set<(sessionId: string) => void>();
  private readonly logger = new ConsoleLogger('RealtimeEvents');
  subscribe(listener: (event: RealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onSessionInvalidated(listener: (sessionId: string) => void) {
    this.invalidations.add(listener);
    return () => {
      this.invalidations.delete(listener);
    };
  }
  publish(draft: EventDraft) {
    const event: RealtimeEvent = {
      eventId: randomUUID(),
      type: draft.type,
      tenantId: draft.tenantId,
      conversationId: draft.conversationId,
      ...(draft.messageId ? { messageId: draft.messageId } : {}),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.logger.warn({
          action: 'publication_failed',
          eventId: event.eventId,
          tenantId: event.tenantId,
        });
      }
    }
    this.logger.log({ action: 'published', ...event });
  }
  invalidateSession(sessionId: string) {
    for (const listener of this.invalidations) {
      try {
        listener(sessionId);
      } catch {
        this.logger.warn({ action: 'session_invalidation_failed' });
      }
    }
  }
}
@Module({ providers: [RealtimeEvents], exports: [RealtimeEvents] })
export class RealtimeEventsModule {}
