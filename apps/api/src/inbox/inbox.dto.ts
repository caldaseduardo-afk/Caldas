import { fields, textField } from '../configuration/dto';
import { choice, pagination } from '../conversations/conversation.dto';
import { conversationStatuses } from '../conversations/conversation.state';
import { uuid } from '../availability/availability.dto';
function query(input: unknown, keys: string[]) {
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    !Object.keys(input).length
  )
    return {};
  return fields(input, keys);
}
export function inboxQuery(input: unknown) {
  const q = query(input, ['q', 'status', 'page', 'limit']);
  return {
    ...pagination(q),
    q: q.q === undefined ? '' : textField(q.q, 100),
    status:
      q.status === undefined
        ? undefined
        : choice(q.status, conversationStatuses),
  };
}
export function historyQuery(input: unknown) {
  const q = query(input, ['before', 'limit']);
  return {
    limit: pagination({ limit: q.limit ?? '30' }).limit,
    before: q.before === undefined ? undefined : uuid(q.before),
  };
}
