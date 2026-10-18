import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
  SetMetadata,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { WhatsAppProvider, messagingLog } from '@atendente/database';
import { Public } from '../auth/auth.guard';
import { ConversationIngressService } from '../conversations/conversation-ingress.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@Controller('webhooks/whatsapp')
@Public()
@SetMetadata('auth:provider-webhook', true)
export class WhatsAppWebhookController {
  constructor(private readonly conversations: ConversationIngressService) {}
  @Get()
  @RateLimit(60)
  verify(@Query() query: Record<string, unknown>, @Res() response: Response) {
    try {
      const provider = new WhatsAppProvider(
        process.env.WHATSAPP_GRAPH_VERSION ?? '',
      );
      const challenge = provider.verifyWebhook(
        query['hub.mode'],
        query['hub.verify_token'],
        query['hub.challenge'],
        process.env.WHATSAPP_VERIFY_TOKEN ?? '',
      );
      response.type('text/plain').send(challenge);
    } catch {
      throw new ForbiddenException('Verificação inválida.');
    }
  }
  @Post()
  @HttpCode(200)
  @RateLimit(120)
  async receive(@Req() request: Request) {
    const started = Date.now(),
      correlationId = randomUUID();
    const provider = new WhatsAppProvider(
      process.env.WHATSAPP_GRAPH_VERSION ?? '',
    );
    if (
      !Buffer.isBuffer(request.body) ||
      !provider.verifySignature(
        request.body,
        request.headers['x-hub-signature-256'],
        process.env.WHATSAPP_APP_SECRET ?? '',
      )
    )
      throw new ForbiddenException('Assinatura inválida.');
    let messages, statuses;
    try {
      const body: unknown = JSON.parse(request.body.toString('utf8'));
      messages = provider.parseInboundWebhook(body);
      statuses = provider.parseStatusWebhook(body);
    } catch {
      throw new BadRequestException('Webhook inválido.');
    }
    messagingLog('webhook_received', {
      correlationId,
      result: 'validated',
      durationMs: Date.now() - started,
    });
    for (const event of messages) {
      try {
        const result = await this.conversations.receive(event, correlationId);
        messagingLog(result.outcome, {
          correlationId,
          tenantId: 'tenantId' in result ? result.tenantId : undefined,
          providerMessageId: event.providerMessageId,
          result: result.outcome,
          durationMs: Date.now() - started,
        });
      } catch (error) {
        if (error instanceof BadRequestException)
          throw new BadRequestException('Mensagem inválida.');
        messagingLog('webhook_failed', {
          correlationId,
          providerMessageId: event.providerMessageId,
          result: 'persistence_failed',
          durationMs: Date.now() - started,
        });
        throw new ServiceUnavailableException(
          'Não foi possível persistir o evento.',
        );
      }
    }
    for (const event of statuses) {
      try {
        const result = await this.conversations.status(event);
        messagingLog('status_received', {
          correlationId,
          tenantId: result.tenantId,
          providerMessageId: event.providerMessageId,
          result: result.outcome,
          durationMs: Date.now() - started,
        });
      } catch {
        throw new ServiceUnavailableException(
          'Não foi possível persistir o evento.',
        );
      }
    }
    if (!messages.length && !statuses.length)
      messagingLog('webhook_ignored', {
        correlationId,
        result: 'unsupported_or_empty',
        durationMs: Date.now() - started,
      });
    return { received: true };
  }
}
