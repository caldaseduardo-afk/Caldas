'use client';
import { HandoffControls } from './handoff-controls';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  selectedConversation,
  statusLabels,
  intentLabels,
  type Detail,
  type Session,
  type Tenant,
} from '../../lib/inbox';
import { useRealtime } from '../../lib/use-realtime';
import { useRemote } from '../../lib/use-remote';
import { ConversationList } from './conversation-list';
import { MessageList, MessageComposer } from './messages';
import { ContextPanel } from './context-panel';
import { TopNavigation } from './top-navigation';
function ActiveConversation({
  id,
  session,
  onChanged,
  realtimeRevision,
}: {
  id: string;
  session: Session;
  onChanged: () => void;
  realtimeRevision: number;
}) {
  const [revision, setRevision] = useState(0),
    [contextOpen, setContextOpen] = useState(false);
  const { data, error } = useRemote<Detail>(
    `inbox/conversations/${id}`,
    revision + realtimeRevision,
    true,
  );
  const changed = () => {
    setRevision((r) => r + 1);
    onChanged();
  };
  if (error)
    return (
      <section className="empty">
        <h2>Conversa indisponível</h2>
        <p role="alert">{error.message}</p>
        <button onClick={() => setRevision((r) => r + 1)}>
          Tentar novamente
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="empty" role="status">
        Carregando conversa…
      </section>
    );
  return (
    <>
      <section className="active-conversation" aria-label="Conversa ativa">
        <header className="conversation-header">
          <div>
            <div className="eyebrow">{data.channel} · CONVERSA</div>
            <h2>{data.contact.displayName}</h2>
            {data.activePatient && (
              <p>
                Falando sobre: <strong>{data.activePatient.name}</strong>
              </p>
            )}
            <div className="header-meta">
              <span className={`badge status-${data.status}`}>
                {statusLabels[data.status]}
              </span>
              <span>Intenção: {intentLabels[data.intent]}</span>
              <span>
                {data.assignedUser
                  ? `Responsável: ${data.assignedUser.user.name}`
                  : 'Sem atendente atribuído'}
              </span>
            </div>
          </div>
          <button
            className="context-toggle"
            aria-expanded={contextOpen}
            aria-controls="context"
            onClick={() => setContextOpen(!contextOpen)}
          >
            Contexto
          </button>
        </header>
        <HandoffControls detail={data} session={session} onChanged={changed} />
        <MessageList
          key={id}
          id={id}
          timezone={session.tenant.timezone}
          revision={revision + realtimeRevision}
        />
        <MessageComposer
          id={id}
          integrated={!!data.integrationId}
          enabled={
            session.canReply &&
            data.status === 'HUMAN_ACTIVE' &&
            data.assignedUserId === session.userId
          }
          onSaved={changed}
        />
      </section>
      <div
        id="context"
        className={`context-container ${contextOpen ? 'context-open' : ''}`}
      >
        <ContextPanel detail={data} session={session} onChanged={changed} />
      </div>
    </>
  );
}
function Workspace({
  session,
  onDenied,
}: {
  session: Session;
  onDenied: () => void;
}) {
  const [selected, setSelected] = useState(''),
    [revision, setRevision] = useState(0),
    [activeRevision, setActiveRevision] = useState(0);
  const connection = useRealtime(
    session.tenant.id,
    (ids) => {
      setRevision((r) => r + 1);
      if (ids.includes(selected)) setActiveRevision((r) => r + 1);
    },
    () => {
      setRevision((r) => r + 1);
      setActiveRevision((r) => r + 1);
    },
    onDenied,
  );
  useEffect(() => {
    const sync = () =>
      setSelected(selectedConversation(window.location.search));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  function select(id: string) {
    window.history.pushState(
      null,
      '',
      `/conversations?conversationId=${encodeURIComponent(id)}`,
    );
    setSelected(id);
  }
  return (
    <main className="inbox-grid">
      <div className="realtime-status" role="status">
        {
          {
            connecting: 'Conectando tempo real…',
            connected: 'Tempo real conectado',
            reconnecting:
              'Reconectando… A consulta por API continua disponível.',
            blocked: 'Acesso alterado. Atualizando sessão…',
          }[connection]
        }
      </div>
      <ConversationList
        selected={selected}
        onSelect={select}
        timezone={session.tenant.timezone}
        revision={revision}
      />
      {selected ? (
        <ActiveConversation
          key={selected}
          id={selected}
          session={session}
          realtimeRevision={activeRevision}
          onChanged={() => setRevision((r) => r + 1)}
        />
      ) : (
        <section className="empty">
          <div className="empty-symbol" aria-hidden="true">
            ↗
          </div>
          <h2>Selecione uma conversa.</h2>
          <p>O histórico e o contexto do atendimento aparecerão aqui.</p>
        </section>
      )}
    </main>
  );
}
export function Inbox() {
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const identity = useRemote<{ name: string }>('auth/me', revision);
  const tenants = useRemote<Tenant[]>(
    identity.data ? 'tenancy/tenants' : '',
    revision,
  );
  const session = useRemote<Session>(
    identity.data ? 'inbox/session' : '',
    revision,
  );
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const needsLogin =
    identity.error instanceof ApiError && identity.error.status === 401;
  async function mutate(path: string, body?: unknown) {
    if (busy) return;
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    setError('');
    try {
      await api(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setRevision((r) => r + 1);
        setPassword('');
        if (path !== 'auth/login')
          window.history.replaceState(null, '', '/conversations');
      }
    } catch (e) {
      if (!request.signal.aborted)
        setError(
          e instanceof ApiError
            ? path === 'auth/login'
              ? 'Não foi possível entrar. Verifique suas credenciais.'
              : e.message
            : 'Serviço indisponível.',
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  if (needsLogin)
    return (
      <main className="login-shell">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate('auth/login', { email, password });
          }}
        >
          <div className="brand-mark">a</div>
          <div className="eyebrow">ATENDENTE IA</div>
          <h1>
            Seu atendimento,
            <br />
            em um só lugar.
          </h1>
          <p>Entre para acessar as conversas da sua clínica.</p>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    );
  return (
    <div className="application">
      <header className="app-header">
        <a className="brand" href="/conversations" aria-label="Atendente IA, início">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span className="brand-copy">
            <strong>Atendente IA</strong>
            <small>Atendimento da clínica</small>
          </span>
        </a>
        <TopNavigation />
        <div className="account-controls">
          {identity.data && (
            <>
              <label className="sr-only" htmlFor="tenant">
                Clínica ativa
              </label>
              <select
                id="tenant"
                disabled={busy || !tenants.data}
                value={session.data?.tenant.id ?? ''}
                onChange={(e) => {
                  if (e.target.value)
                    void mutate('tenancy/active', { tenantId: e.target.value });
                }}
              >
                <option value="">Selecionar clínica</option>
                {tenants.data?.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="account-name">{identity.data.name}</span>
              <button
                disabled={busy}
                onClick={() => void mutate('auth/logout')}
              >
                Sair
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {busy ? (
        <main className="empty" role="status">
          Atualizando sessão…
        </main>
      ) : identity.error ? (
        <main className="empty">
          <p role="alert">{identity.error.message}</p>
          <button onClick={() => setRevision((r) => r + 1)}>
            Tentar novamente
          </button>
        </main>
      ) : !identity.data || (!session.data && !session.error) ? (
        <main className="empty" role="status">
          Carregando atendimento…
        </main>
      ) : session.error ? (
        <main className="empty">
          <h1>Selecione uma clínica autorizada</h1>
          <p role="alert">{session.error.message}</p>
          {tenants.error && <p role="alert">{tenants.error.message}</p>}
          {tenants.data?.length === 0 && (
            <p>Nenhuma clínica disponível para este usuário.</p>
          )}
          <button onClick={() => setRevision((r) => r + 1)}>
            Atualizar acesso
          </button>
        </main>
      ) : (
        session.data && (
          <Workspace
            key={`${session.data.tenant.id}:${revision}`}
            session={session.data}
            onDenied={() => setRevision((r) => r + 1)}
          />
        )
      )}
      <footer className="app-footer">
        <span><i className="connection-dot" /> {session.data ? 'Clínica selecionada' : 'Sessão autenticada'}</span>
        <span>{session.data?.tenant.timezone ?? 'Acesso autenticado'}</span>
        <button onClick={() => setRevision((r) => r + 1)} disabled={busy}>
          Atualizar inbox
        </button>
      </footer>
    </div>
  );
}
