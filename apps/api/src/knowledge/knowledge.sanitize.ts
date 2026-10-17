import { sanitizeAIText } from '../ai/ai-context';
export function sanitizeKnowledgeText(value: string, max = 1200): string {
  const withoutControls = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 || code === 9 || code === 10 || code === 13;
    })
    .join('');
  return sanitizeAIText(
    withoutControls
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace('\u007F', ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, max);
}
