import {
  AIProviderError,
  type AIMessage,
  type AIResponseFormat,
} from '@atendente/domain';
export interface AIInput {
  systemInstructions: string;
  messages: readonly AIMessage[];
  correlationId?: string;
  responseFormat?: AIResponseFormat;
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (): never => {
  throw new AIProviderError('AI_BAD_REQUEST');
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) bad();
}
/** Defense in depth, not a substitute for selecting minimal context before calling AI. */
export function sanitizeAIText(
  value: unknown,
  secrets: readonly string[] = [],
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 16000)
    return bad();
  let text = value;
  for (const secret of secrets)
    if (secret) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(
      /["']?\b(password(?:_?hash)?|senha|(?:client[_-]?)?secret|(?:access[_-]?|refresh[_-]?)?token|authorization|api[_-]?key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '[REDACTED]',
    )
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[DOCUMENT]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(
      /(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}\b/g,
      '[PHONE]',
    );
}
export function prepareAIInput(
  input: unknown,
  secrets: readonly string[] = [],
): AIInput {
  const v = record(input);
  keys(v, [
    'systemInstructions',
    'messages',
    'correlationId',
    'responseFormat',
  ]);
  if (!Array.isArray(v.messages) || v.messages.length > 40) return bad();
  const messages: AIMessage[] = v.messages.map((raw) => {
    const message = record(raw);
    keys(message, ['role', 'content']);
    if (!['SYSTEM', 'USER', 'ASSISTANT'].includes(String(message.role)))
      return bad();
    return {
      role: message.role as AIMessage['role'],
      content: sanitizeAIText(message.content, secrets),
    };
  });
  const systemInstructions = sanitizeAIText(v.systemInstructions, secrets);
  if (
    systemInstructions.length +
      messages.reduce((sum, m) => sum + m.content.length, 0) >
    64000
  )
    return bad();
  if (
    v.correlationId !== undefined &&
    (typeof v.correlationId !== 'string' || !UUID.test(v.correlationId))
  )
    return bad();
  let responseFormat: AIResponseFormat | undefined;
  if (v.responseFormat !== undefined) {
    const f = record(v.responseFormat);
    if (f.type === 'text') {
      keys(f, ['type']);
      responseFormat = { type: 'text' };
    } else {
      keys(f, ['type', 'name', 'schema']);
      if (
        f.type !== 'json_schema' ||
        typeof f.name !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(f.name)
      )
        return bad();
      const schema = record(f.schema);
      // Schema comes from trusted application code, never a public request or a tool registry.
      let serialized: string;
      try {
        serialized = JSON.stringify(schema);
      } catch {
        return bad();
      }
      if (
        serialized.length > 16000 ||
        sanitizeAIText(serialized, secrets) !== serialized
      )
        return bad();
      responseFormat = {
        type: 'json_schema',
        name: f.name,
        schema: JSON.parse(serialized) as Record<string, unknown>,
      };
    }
  }
  return {
    systemInstructions,
    messages,
    ...(v.correlationId ? { correlationId: v.correlationId as string } : {}),
    ...(responseFormat ? { responseFormat } : {}),
  };
}
