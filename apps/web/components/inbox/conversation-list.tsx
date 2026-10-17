'use client';
import { useWaitClock } from '../../lib/use-wait-clock';
import { SlaIndicator } from './sla-indicator';
import { reasonLabels } from './handoff-controls';
import { useState } from 'react';
import {
  dateLabel,
  intentLabels,
  statusLabels,
  type Page,
  typeLabels,
} from '../../lib/inbox';
import { useRemote } from '../../lib/use-remote';
export function ConversationList({
  selected,
  onSelect,
  timezone,
  revision,
}: {
  selected: string;
  onSelect: (id: string) => void;
  timezone: string;
  revision: number;
}) {
  const now = useWaitClock();
  const [search, setSearch] = useState(''),
    [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    limit: '20',
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  });
  const { data, error } = useRemote<Page>(
    `inbox/conversations?${params}`,
    revision,
    true,
  );
  return (
    <aside className="conversation-list" aria-label="Lista de conversas">
      <div className="list-tools">
        <div className="eyebrow">CENTRAL DE ATENDIMENTO</div>
        <h1>Conversas</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
            setPage(1);
          }}
        >
          <label htmlFor="search">Buscar contato, telefone ou paciente</label>
          <div className="search-row">
            <input
              id="search"
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar…"
              type="search"
            />
            <button type="submit" aria-label="Buscar conversas">
              Buscar
            </button>
          </div>
        </form>
        <label htmlFor="filter">Situação</label>
        <select
          id="filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas</option>
          {['AI_ACTIVE', 'HUMAN_ACTIVE', 'NEEDS_HUMAN', 'WAITING_PATIENT'].map(
            (s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="conversation-items" aria-live="polite">
        {error ? (
          <p role="alert" className="notice">
            {error.message}
          </p>
        ) : !data ? (
          <p role="status" className="notice">
            Carregando conversas…
          </p>
        ) : !data.items.length ? (
          <p className="notice">Não há conversas para exibir.</p>
        ) : (
          data.items.map((c) => (
            <button
              key={c.id}
              className={`conversation-item ${selected === c.id ? 'selected' : ''}`}
              onClick={() => onSelect(c.id)}
              aria-pressed={selected === c.id}
            >
              <span className="item-top">
                <strong>{c.contact.displayName}</strong>
                <span className={`badge status-${c.status}`}>
                  {statusLabels[c.status] ?? c.status}
                </span>
              </span>
              <span className="muted">
                {c.contact.channels[0]?.address ?? 'Sem telefone'} · {c.channel}
              </span>
              <span className="preview">
                {c.messages[0]
                  ? c.messages[0].content ||
                    typeLabels[c.messages[0].messageType]
                  : 'Sem mensagens'}
              </span>
              <span className="item-meta">
                Intenção: {intentLabels[c.intent] ?? c.intent}
              </span>
              {c.activePatient && (
                <span className="item-meta">
                  Paciente: {c.activePatient.name}
                </span>
              )}
              {c.assignedUser && (
                <span className="item-meta">
                  Responsável: {c.assignedUser.user.name}
                </span>
              )}
              {c.status === 'NEEDS_HUMAN' && (
                <span className="item-meta">
                  {reasonLabels[c.handoffReason ?? 'OTHER']} · Na fila desde{' '}
                  {dateLabel(c.handoffRequestedAt, timezone)}
                </span>
              )}
              <SlaIndicator conversation={c} now={now} />
              <time className="item-meta">
                {dateLabel(c.lastMessageAt, timezone)}
              </time>
            </button>
          ))
        )}
      </div>
      <nav className="pagination" aria-label="Paginação das conversas">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>Página {page}</span>
        <button disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>
          Próxima
        </button>
      </nav>
    </aside>
  );
}
