import { slaLabels, waitingLabel } from '../../lib/human-sla';
import type { Conversation } from '../../lib/inbox';
export function SlaIndicator({
  conversation,
  now,
}: {
  conversation: Pick<
    Conversation,
    'status' | 'slaLevel' | 'handoffRequestedAt'
  >;
  now: number;
}) {
  if (conversation.status !== 'NEEDS_HUMAN') return null;
  const level = conversation.slaLevel ?? 'NONE';
  return (
    <span className={`sla-indicator sla-${level}`}>
      <strong>{slaLabels[level] ?? slaLabels.NONE}</strong> ·{' '}
      {waitingLabel(conversation.handoffRequestedAt, now)}
    </span>
  );
}
