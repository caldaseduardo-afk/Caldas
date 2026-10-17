import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MessagingProviderError,
  type MessagingProvider,
  type InboundMessage,
  type DeliveryStatus,
  type SendContext,
} from '@atendente/domain';

function invalid(): never {
  throw new MessagingProviderError('INVALID_PAYLOAD', false);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.includes('\0')
  )
    return invalid();
  return value;
}
function list(value: unknown, max = 100): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function digits(value: unknown) {
  const s = text(value, 32);
  if (!/^[1-9]\d{4,31}$/.test(s)) return invalid();
  return s;
}
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function envelopes(payload: unknown) {
  const root = object(payload);
  if (root.object !== 'whatsapp_business_account') return invalid();
  const result: {
    accountId: string;
    phoneNumberId: string;
    value: Record<string, unknown>;
  }[] = [];
  for (const entry of list(root.entry, 20)) {
    const e = object(entry),
      accountId = digits(e.id);
    for (const change of list(e.changes, 20)) {
      const c = object(change);
      if (c.field !== 'messages') continue;
      const value = object(c.value);
      if (value.messaging_product !== 'whatsapp') return invalid();
      result.push({
        accountId,
        phoneNumberId: digits(object(value.metadata).phone_number_id),
        value,
      });
    }
  }
  if (result.length > 100) return invalid();
  return result;
}
export class WhatsAppProvider implements MessagingProvider {
  constructor(
    private readonly version: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (version && !/^v\d{2,3}\.0$/.test(version))
      throw new MessagingProviderError('CONFIGURATION', false);
  }
  verifyWebhook(
    mode: unknown,
    token: unknown,
    challenge: unknown,
    expected: string,
  ) {
    if (
      !expected ||
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      !equal(token, expected) ||
      typeof challenge !== 'string' ||
      !/^\d{1,200}$/.test(challenge)
    )
      throw new MessagingProviderError('WEBHOOK_VERIFICATION', false);
    return challenge;
  }
  verifySignature(raw: Buffer, signature: unknown, secret: string) {
    if (
      !secret ||
      typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    )
      return false;
    return equal(
      signature,
      `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    );
  }
  parseInboundWebhook(payload: unknown): InboundMessage[] {
    const result: InboundMessage[] = [];
    for (const { value, accountId, phoneNumberId } of envelopes(payload)) {
      for (const raw of list(value.messages ?? [])) {
        const m = object(raw),
          from = digits(m.from),
          providerMessageId = text(m.id);
        const contact = list(value.contacts ?? [])
          .map(object)
          .find((c) => c.wa_id === from);
        const profileName = contact?.profile
          ? object(contact.profile).name
          : undefined;
        const displayName =
          typeof profileName === 'string' &&
          profileName.trim() &&
          !profileName.includes('\0')
            ? profileName.trim().slice(0, 200)
            : 'Contato WhatsApp';
        const base = {
          accountId,
          phoneNumberId,
          from,
          providerMessageId,
          displayName,
        };
        if (m.type === 'text')
          result.push({
            ...base,
            messageType: 'TEXT',
            content: text(object(m.text).body, 4000),
          });
        else if (
          m.type === 'image' ||
          m.type === 'audio' ||
          m.type === 'document'
        ) {
          const media = object(m[m.type]);
          const metadata: Record<string, string | number> = {
            mediaRef: digits(media.id),
          };
          if (media.mime_type !== undefined)
            metadata.mimeType = text(media.mime_type, 100);
          if (media.filename !== undefined)
            metadata.fileName = text(media.filename, 255);
          result.push({
            ...base,
            messageType:
              m.type === 'image'
                ? 'IMAGE'
                : m.type === 'audio'
                  ? 'AUDIO'
                  : 'DOCUMENT',
            content:
              media.caption === undefined ? '' : text(media.caption, 4000),
            metadata,
          });
        } else if (m.type === 'location') {
          const location = object(m.location);
          if (
            typeof location.latitude !== 'number' ||
            !Number.isFinite(location.latitude) ||
            Math.abs(location.latitude) > 90 ||
            typeof location.longitude !== 'number' ||
            !Number.isFinite(location.longitude) ||
            Math.abs(location.longitude) > 180
          )
            return invalid();
          result.push({
            ...base,
            messageType: 'LOCATION',
            content: '',
            metadata: {
              latitude: location.latitude,
              longitude: location.longitude,
              ...(location.name ? { label: text(location.name, 200) } : {}),
            },
          });
        } else if (m.type === 'contacts') {
          // Persist a bounded display representation, never the complete address book payload.
          const cards = list(m.contacts, 20);
          if (!cards.length) return invalid();
          const card = object(cards[0]),
            name = object(card.name),
            phones = list(card.phones, 20);
          if (!phones.length) return invalid();
          const phone = object(phones[0]);
          result.push({
            ...base,
            messageType: 'CONTACT',
            content: '',
            metadata: {
              displayName: text(name.formatted_name, 200),
              phone: phone.wa_id
                ? '+' + digits(phone.wa_id)
                : text(phone.phone, 64),
              sharedContactCount: cards.length,
            },
          });
        } else if (m.type === 'interactive' || m.type === 'button') {
          const interaction =
            m.type === 'button' ? object(m.button) : object(m.interactive);
          const selection =
            m.type === 'button'
              ? interaction
              : object(interaction.button_reply ?? interaction.list_reply);
          result.push({
            ...base,
            messageType: 'INTERACTIVE',
            content: text(selection.title ?? selection.text, 4000),
            metadata: {
              interactionId: text(selection.id ?? selection.payload, 200),
            },
          });
        }
        // Unknown provider types are acknowledged without inventing an internal type.
      }
    }
    if (result.length > 100) return invalid();
    return result;
  }
  parseStatusWebhook(payload: unknown): DeliveryStatus[] {
    const result: DeliveryStatus[] = [];
    for (const { value, accountId, phoneNumberId } of envelopes(payload))
      for (const raw of list(value.statuses ?? [])) {
        const s = object(raw);
        if (!['sent', 'delivered', 'read', 'failed'].includes(String(s.status)))
          continue;
        const timestamp = text(s.timestamp, 12);
        if (!/^\d{1,12}$/.test(timestamp)) return invalid();
        const at = new Date(Number(timestamp) * 1000);
        if (!Number.isFinite(+at) || +at > Date.now() + 300000)
          return invalid();
        result.push({
          accountId,
          phoneNumberId,
          providerMessageId: text(s.id),
          recipient: digits(s.recipient_id),
          status: String(s.status).toUpperCase() as DeliveryStatus['status'],
          at,
          ...(s.biz_opaque_callback_data === undefined
            ? {}
            : { correlationId: text(s.biz_opaque_callback_data, 100) }),
        });
      }
    if (result.length > 100) return invalid();
    return result;
  }
  private async send(
    context: SendContext,
    body: Record<string, unknown>,
  ): Promise<string> {
    if (!this.version) throw new MessagingProviderError('CONFIGURATION', false);
    digits(context.phoneNumberId);
    if (!/^\+[1-9]\d{7,14}$/.test(context.to) || !context.accessToken)
      throw new MessagingProviderError('CONFIGURATION', false);
    let response: Response;
    try {
      response = await this.transport(
        `https://graph.facebook.com/${this.version}/${context.phoneNumberId}/messages`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${context.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: context.to.slice(1),
            biz_opaque_callback_data: context.messageId,
            ...body,
          }),
        },
      );
    } catch {
      throw new MessagingProviderError('SEND_UNCERTAIN', true, true);
    }
    let payload: Record<string, unknown>;
    try {
      const raw = await response.text();
      if (raw.length > 65536) throw new Error();
      payload = object(JSON.parse(raw));
    } catch {
      throw new MessagingProviderError('SEND_UNCERTAIN', true, true);
    }
    if (!response.ok) {
      const err =
        payload.error && typeof payload.error === 'object'
          ? (payload.error as Record<string, unknown>)
          : {};
      const code = typeof err.code === 'number' ? err.code : 0;
      if (code === 190 || response.status === 401)
        throw new MessagingProviderError('CREDENTIALS', false);
      const transient =
        response.status === 429 ||
        [130429, 131056].includes(code) ||
        (response.status >= 500 && code > 0);
      throw new MessagingProviderError(
        transient
          ? 'PROVIDER_TRANSIENT'
          : response.status >= 500
            ? 'SEND_UNCERTAIN'
            : 'PROVIDER_REJECTED',
        transient || response.status >= 500,
        response.status >= 500 && !code,
      );
    }
    try {
      return text(object(list(payload.messages, 1)[0]).id);
    } catch {
      throw new MessagingProviderError('SEND_UNCERTAIN', true, true);
    }
  }
  sendTextMessage(context: SendContext, body: string) {
    return this.send(context, {
      type: 'text',
      text: { body: text(body, 4000), preview_url: false },
    });
  }
  sendMediaMessage(
    context: SendContext,
    media: {
      type: 'image' | 'audio' | 'document';
      id: string;
      caption?: string;
    },
  ) {
    return this.send(context, {
      type: media.type,
      [media.type]: {
        id: digits(media.id),
        ...(media.caption ? { caption: text(media.caption, 1024) } : {}),
      },
    });
  }
  sendInteractiveMessage(
    context: SendContext,
    interactive: { text: string; buttons: { id: string; title: string }[] },
  ) {
    if (!interactive.buttons.length || interactive.buttons.length > 3)
      return invalid();
    return this.send(context, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text(interactive.text, 1024) },
        action: {
          buttons: interactive.buttons.map((b) => ({
            type: 'reply',
            reply: { id: text(b.id, 200), title: text(b.title, 20) },
          })),
        },
      },
    });
  }
}
export function whatsappAccessToken(
  reference: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (
    !/^WHATSAPP_ACCESS_TOKEN_[A-Z][A-Z0-9_]{0,63}$/.test(reference) ||
    !env[reference]
  )
    throw new MessagingProviderError('CONFIGURATION', false);
  return env[reference]!;
}
