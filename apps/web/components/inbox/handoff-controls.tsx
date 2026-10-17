'use client';
import { useWaitClock } from '../../lib/use-wait-clock';
import { SlaIndicator } from './sla-indicator';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  dateLabel,
  type Detail,
  type Session,
} from '../../lib/inbox';
import { useRemote } from '../../lib/use-remote';
export const reasonLabels: Record<string, string> = {
  USER_REQUESTED_HUMAN: 'Solicitação de atendimento humano',
  AI_LOW_CONFIDENCE: 'Baixa confiança da IA',
  PAYMENT_NEGOTIATION: 'Negociação de pagamento',
  COMPLAINT: 'Reclamação',
  CLINICAL_QUESTION: 'Dúvida clínica',
  AUTHORIZATION_PROBLEM: 'Problema de autorização',
  SCHEDULING_CONFLICT: 'Conflito de agenda',
  SYSTEM_ERROR: 'Erro de sistema',
  OTHER: 'Outro motivo',
};
export function HandoffControls({
  detail,
  session,
  onChanged,
}: {
  detail: Detail;
  session: Session;
  onChanged: () => void;
}) {
  const now = useWaitClock();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reason, setReason] = useState('USER_REQUESTED_HUMAN'),
    [transferOpen, setTransferOpen] = useState(false),
    [page, setPage] = useState(1),
    [target, setTarget] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const candidates = useRemote<{
    items: { id: string; name: string }[];
    hasMore: boolean;
  }>(
    transferOpen && session.canTransfer
      ? `inbox/assignees?page=${page}&limit=20`
      : '',
    0,
  );
  async function act(action: string, body: unknown = {}) {
    if (busy) return;
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    setError('');
    try {
      await api(`conversations/${detail.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setTransferOpen(false);
        setTarget('');
        onChanged();
      }
    } catch (e) {
      if (!request.signal.aborted) {
        setError(
          e instanceof ApiError && e.status === 409
            ? 'A conversa foi alterada ou já foi assumida. O estado foi atualizado.'
            : e instanceof Error
              ? e.message
              : 'Não foi possível concluir.',
        );
        onChanged();
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  const owned = detail.assignedUserId === session.userId;
  return (
    <div className="handoff-controls" aria-label="Atendimento humano">
      <SlaIndicator conversation={detail} now={now} />
      {detail.status === 'NEEDS_HUMAN' && (
        <>
          <p>
            {reasonLabels[detail.handoffReason ?? 'OTHER']} · Na fila desde{' '}
            {dateLabel(detail.handoffRequestedAt, session.tenant.timezone)}
          </p>
          {session.canAssign && session.canReply && (
            <button disabled={busy} onClick={() => void act('claim')}>
              Assumir conversa
            </button>
          )}
        </>
      )}
      {['AI_ACTIVE', 'WAITING_PATIENT'].includes(detail.status) &&
        session.canReply && (
          <>
            <label>
              Motivo do handoff{' '}
              <select
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              >
                {Object.entries(reasonLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void act('request-human', { reason })}
            >
              Solicitar humano
            </button>
          </>
        )}
      {detail.status === 'HUMAN_ACTIVE' && (
        <>
          <p>
            Em atendimento por {detail.assignedUser?.user.name ?? 'atendente'}
          </p>
          {session.canTransfer && (
            <button
              disabled={busy}
              onClick={() => setTransferOpen(!transferOpen)}
            >
              Transferir
            </button>
          )}
          {owned && session.canTransfer && (
            <button disabled={busy} onClick={() => void act('return-to-ai')}>
              Devolver para IA
            </button>
          )}
          {owned && session.canClose && (
            <button disabled={busy} onClick={() => void act('resolve')}>
              Encerrar atendimento
            </button>
          )}
          {transferOpen && session.canTransfer && (
            <div>
              <label>
                Novo responsável{' '}
                <select
                  value={target}
                  disabled={busy || !candidates.data}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Selecionar atendente</option>
                  {candidates.data?.items
                    .filter((u) => u.id !== detail.assignedUserId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy || !target}
                onClick={() => void act('transfer', { targetUserId: target })}
              >
                Confirmar transferência
              </button>
              <button
                disabled={page === 1 || busy}
                onClick={() => {
                  setPage(page - 1);
                  setTarget('');
                }}
              >
                Atendentes anteriores
              </button>
              <button
                disabled={!candidates.data?.hasMore || busy}
                onClick={() => {
                  setPage(page + 1);
                  setTarget('');
                }}
              >
                Próximos atendentes
              </button>
              {candidates.error && (
                <p role="alert">{candidates.error.message}</p>
              )}
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
