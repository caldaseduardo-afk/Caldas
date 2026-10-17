import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  canAiRespond,
  conversationStatuses,
  handoffReasons,
} from '../src/conversations/conversation.state';
import { handoffDto } from '../src/conversations/handoff.dto';
test('IA só pode responder em AI_ACTIVE; espera e atendimento humano suspendem', () => {
  for (const status of conversationStatuses)
    assert.equal(canAiRespond({ status }), status === 'AI_ACTIVE');
});
test('handoff valida motivos, alvo e rejeita autoria/tenant/timestamps forjados', () => {
  for (const reason of handoffReasons)
    assert.deepEqual(handoffDto('request-human', { reason }), { reason });
  assert.throws(() => handoffDto('request-human', { reason: 'inventado' }));
  const targetUserId = randomUUID();
  assert.deepEqual(handoffDto('transfer', { targetUserId }), { targetUserId });
  for (const action of ['claim', 'resolve', 'return-to-ai'] as const) {
    assert.deepEqual(handoffDto(action, {}), {});
    for (const body of [
      { assignedUserId: targetUserId },
      { actor_user_id: targetUserId },
      { tenantId: targetUserId },
      { assignedAt: new Date() },
      null,
      [],
    ])
      assert.throws(() => handoffDto(action, body));
  }
});
