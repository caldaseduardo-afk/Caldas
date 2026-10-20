'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlatformOverview, PlatformHealth } from '@atendente/types';
import { Metric, SeriesChart } from '../dashboard/dashboard';
const fmt = (value: number | null) =>
  value === null
    ? 'Não informado'
    : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(
        value,
      );
async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch(`/api/super-admin/${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Acesso restrito. Confira a conta de plataforma e o código exigido.'
        : 'Não foi possível concluir. Confira os dados ou tente novamente mais tarde.',
    );
  return res.status === 204 ? (undefined as T) : res.json();
}
export function PlatformMenu() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void api('session')
      .then(() => {
        if (live) setAllowed(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return allowed ? (
    <Link className="link-button" href="/super-admin">
      Super Admin
    </Link>
  ) : null;
}
export function PlatformDashboard() {
  const [authorized, setAuthorized] = useState(false),
    [checked, setChecked] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [enrolling, setEnrolling] = useState(false),
    [secret, setSecret] = useState('');
  const [data, setData] = useState<PlatformOverview | null>(null),
    [health, setHealth] = useState<PlatformHealth | null>(null);
  const [tab, setTab] = useState('Visão geral'),
    [target, setTarget] = useState(''),
    [period, setPeriod] = useState('LAST_30_DAYS');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [integrationStatus, setIntegrationStatus] = useState(''),
    [activeInPeriod, setActiveInPeriod] = useState('');
  const [planNotice, setPlanNotice] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState('');
  const generation = useRef(0);
  async function load(page = 1, tenantId = target) {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setData(null);
    const query = new URLSearchParams({
      period,
      page: String(page),
      limit: '25',
    });
    if (period === 'CUSTOM') {
      query.set('from', from);
      query.set('to', to);
    }
    if (!tenantId)
      for (const [key, value] of Object.entries({
        search,
        status,
        integrationStatus,
        activeInPeriod,
      }))
        if (value) query.set(key, value);
    try {
      const result = await api<PlatformOverview>(
        `${tenantId ? `tenants/${tenantId}` : 'overview'}?${query}`,
      );
      if (generation.current === current) setData(result);
    } catch (err) {
      if (generation.current === current) setError((err as Error).message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function healthLoad() {
    try {
      setHealth(await api<PlatformHealth>('health'));
    } catch {
      setHealth(null);
    }
  }
  useEffect(() => {
    let live = true;
    void api('session')
      .then(() => {
        if (live) {
          setAuthorized(true);
          void load();
          void healthLoad();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
      generation.current++;
    };
  }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    const body = {
      email: String(values.get('email')),
      password: String(values.get('password')),
      ...(enrolling ? { invite: String(values.get('invite')) } : {}),
      ...(values.get('code') ? { code: String(values.get('code')) } : {}),
    };
    try {
      if (enrolling) {
        const response = await api<{ secret?: string; enrolled?: boolean }>(
          'enroll',
          body,
        );
        if (response.secret) setSecret(response.secret);
        else {
          setSecret('');
          setEnrolling(false);
          setError(
            'Autenticador confirmado. Aguarde o próximo código para entrar.',
          );
        }
      } else {
        await api('login', body);
        setAuthorized(true);
        setSecret('');
        void load();
        void healthLoad();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!checked)
    return (
      <main className="login-shell">
        <p>Verificando acesso…</p>
      </main>
    );
  if (!authorized)
    return (
      <main className="login-shell">
        <section className="login-card">
          <h1>Super Admin</h1>
          <p>Acesso exclusivo à operação da plataforma.</p>
          <form onSubmit={authenticate}>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            {enrolling && (
              <label>
                Convite administrativo
                <input
                  name="invite"
                  type="password"
                  required
                  autoComplete="off"
                />
              </label>
            )}
            {secret && (
              <p>
                Adicione esta chave ao aplicativo autenticador (TOTP, 6 dígitos,
                30 segundos): <code>{secret}</code>
              </p>
            )}
            <label>
              Código do autenticador, quando exigido
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required={enrolling && !!secret}
              />
            </label>
            <button className="primary" disabled={busy}>
              {enrolling
                ? secret
                  ? 'Confirmar autenticador'
                  : 'Preparar autenticador'
                : 'Entrar'}
            </button>
          </form>
          <button
            onClick={() => {
              setEnrolling(!enrolling);
              setSecret('');
              setError('');
            }}
          >
            {enrolling
              ? 'Voltar ao login'
              : 'Cadastrar autenticador com convite'}
          </button>
          {error && <p role="alert">{error}</p>}
          <Link href="/">Voltar</Link>
        </section>
      </main>
    );
  const tabs = [
    'Visão geral',
    'Clínicas',
    'Uso de IA',
    'Integrações',
    'Jobs',
    'Incidentes',
  ];
  const series = data
    ? Array.from(new Set(data.series.map((r) => r.date))).map((date) => ({
        date,
        messages:
          data.series.find((r) => r.date === date && r.kind === 'messages')
            ?.count ?? 0,
        conversations:
          data.series.find((r) => r.date === date && r.kind === 'conversations')
            ?.count ?? 0,
        appointments:
          data.series.find((r) => r.date === date && r.kind === 'appointments')
            ?.count ?? 0,
        ai:
          data.series.find((r) => r.date === date && r.kind === 'ai')?.count ??
          0,
      }))
    : [];
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link href="/">Atendente IA</Link>
        <h1>Super Admin{data?.tenant ? ` · ${data.tenant.name}` : ''}</h1>
        <p>Operação da plataforma · dados agregados</p>
        <button
          onClick={async () => {
            try {
              await api('logout', {});
              generation.current++;
              setData(null);
              setHealth(null);
              setAuthorized(false);
            } catch {
              setError('Não foi possível sair. Tente novamente.');
            }
          }}
        >
          Sair da plataforma
        </button>
      </header>
      <nav className="platform-nav" aria-label="Seções do Super Admin">
        {tabs.map((name) => (
          <button
            key={name}
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {target && (
        <button
          onClick={() => {
            setTarget('');
            void load(1, '');
          }}
        >
          Voltar à visão global
        </button>
      )}
      <form
        className="dashboard-panel dashboard-period-filter"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
          void healthLoad();
        }}
      >
        <label>
          Período
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="TODAY">Hoje</option>
            <option value="LAST_7_DAYS">7 dias</option>
            <option value="LAST_30_DAYS">30 dias</option>
            <option value="THIS_MONTH">Este mês</option>
            <option value="CUSTOM">Personalizado</option>
          </select>
        </label>
        {period === 'CUSTOM' && (
          <>
            <label>
              De
              <input
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Até
              <input
                type="date"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
        {!target && (
          <>
            <label>
              Clínica
              <input
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos</option>
                {['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Integração
              <select
                value={integrationStatus}
                onChange={(e) => setIntegrationStatus(e.target.value)}
              >
                <option value="">Todas</option>
                {['ACTIVE', 'DEGRADED', 'ERROR', 'DISABLED'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Atividade no período
              <select
                value={activeInPeriod}
                onChange={(e) => setActiveInPeriod(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="true">Com atividade</option>
                <option value="false">Sem atividade</option>
              </select>
            </label>
          </>
        )}
        <button className="primary" disabled={busy}>
          Aplicar / atualizar
        </button>
      </form>
      {busy && <p role="status">Carregando…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.period.from} — {data.period.to} · {data.period.timezone}.
            Volumes por data de criação; estados atuais.
          </p>
          {tab === 'Visão geral' && (
            <>
              {target && data.tenant && data.clinics[0]?.plan && (
                <section className="dashboard-panel">
                  <h2>Plano e consumo · {data.clinics[0].plan.name}</h2>
                  <p>
                    {data.clinics[0].plan.status} · ciclo{' '}
                    {new Date(
                      data.clinics[0].plan.currentPeriodStart,
                    ).toLocaleDateString('pt-BR')}{' '}
                    –{' '}
                    {new Date(
                      data.clinics[0].plan.currentPeriodEnd,
                    ).toLocaleDateString('pt-BR')}
                    {data.clinics[0].plan.overLimit
                      ? ' · acima de ao menos um limite'
                      : ''}
                  </p>
                  <div className="platform-plan-metrics">
                    {data.clinics[0].plan.keyMetrics.map((m) => (
                      <span key={m.metric}>
                        {m.label}: {fmt(m.value)} / {fmt(m.limit)}
                      </span>
                    ))}
                  </div>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      setPlanBusy(true);
                      setPlanNotice('');
                      try {
                        const rawOverrides = String(
                          form.get('overrides') ?? '',
                        ).trim();
                        const overrides = rawOverrides
                          ? JSON.parse(rawOverrides)
                          : undefined;
                        await fetch(
                          `/api/super-admin/tenants/${target}/subscription`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              planCode: String(form.get('planCode')),
                              applyAt: String(form.get('applyAt')),
                              status: String(form.get('status')),
                              ...(form.get('graceUntil')
                                ? {
                                    graceUntil: `${String(form.get('graceUntil'))}T23:59:59.000Z`,
                                  }
                                : {}),
                              ...(overrides === undefined ? {} : { overrides }),
                            }),
                          },
                        ).then(async (response) => {
                          if (!response.ok)
                            throw new Error('Não foi possível salvar o plano.');
                        });
                        setPlanNotice('Assinatura atualizada.');
                        await load(1, target);
                      } catch (reason) {
                        setPlanNotice(
                          reason instanceof Error
                            ? reason.message
                            : 'Falha ao atualizar.',
                        );
                      } finally {
                        setPlanBusy(false);
                      }
                    }}
                    className="platform-plan-form"
                  >
                    <label>
                      Plano
                      <select
                        name="planCode"
                        defaultValue={data.clinics[0].plan.code}
                      >
                        <option>BASIC</option>
                        <option>PRO</option>
                        <option>ENTERPRISE</option>
                      </select>
                    </label>
                    <label>
                      Aplicar
                      <select name="applyAt" defaultValue="NOW">
                        <option value="NOW">Agora</option>
                        <option value="NEXT_CYCLE">No próximo ciclo</option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select
                        name="status"
                        defaultValue={data.clinics[0].plan.status}
                      >
                        <option>ACTIVE</option>
                        <option>TRIAL</option>
                        <option>GRACE</option>
                        <option>SUSPENDED</option>
                        <option>CANCELLED</option>
                      </select>
                    </label>
                    <label>
                      Carência até
                      <input name="graceUntil" type="date" />
                    </label>
                    <label>
                      Overrides JSON
                      <textarea
                        name="overrides"
                        rows={2}
                        placeholder='{"limits":{"maxUnits":8},"capabilities":{"sla_enabled":false}}'
                      />
                    </label>
                    <button className="primary" disabled={planBusy}>
                      Salvar plano
                    </button>
                    {planNotice && <span role="status">{planNotice}</span>}
                  </form>
                </section>
              )}
              <section className="dashboard-cards">
                {Object.entries({
                  tenants: 'Clínicas',
                  active: 'Clínicas ativas',
                  suspended: 'Clínicas suspensas',
                  users: 'Usuários ativos',
                  conversations: 'Conversas',
                  messages: 'Mensagens',
                  appointments: 'Consultas criadas',
                  tokens: 'Tokens de IA',
                  failedIntegrations: 'Integrações com falha',
                  tenantsWithIncidents: 'Clínicas com incidente',
                  aiRequests: 'Requests de IA',
                  totalUsers: 'Usuários cadastrados',
                  units: 'Unidades',
                }).map(([key, label]) => (
                  <Metric
                    key={key}
                    label={label}
                    value={fmt(data.summary[key] ?? null)}
                    description={
                      key === 'users'
                        ? 'Identidades distintas com vínculo ativo'
                        : 'Escopo e período selecionados'
                    }
                  />
                ))}
              </section>
              <SeriesChart
                title="Evolução de uso"
                rows={series}
                lines={[
                  { key: 'messages', label: 'Mensagens', color: '#156f68' },
                  {
                    key: 'conversations',
                    label: 'Conversas',
                    color: '#4056b5',
                  },
                  { key: 'appointments', label: 'Consultas', color: '#b55024' },
                  { key: 'ai', label: 'IA', color: '#873b99' },
                ]}
              />
              <section className="dashboard-panel">
                <h2>Distribuição operacional</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Estado / papel</th>
                      <th>Quantidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.groups.map((r) => (
                      <tr key={r.kind + r.status}>
                        <td>{r.kind}</td>
                        <td>{r.status}</td>
                        <td>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Inbound: PATIENT. Outbound: AI, USER e SYSTEM. Erros de
                  webhook: medição indisponível.
                </p>
              </section>
            </>
          )}
          {tab === 'Clínicas' && (
            <section className="dashboard-panel">
              <h2>Clínicas · {data.totalClinics}</h2>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {[
                        'Nome',
                        'Status',
                        'Plano',
                        'Consumo',
                        'Usuários',
                        'Mensagens',
                        'Conversas',
                        'Consultas',
                        'Tokens',
                        'Última atividade',
                        'Cadastro',
                        'Acesso',
                      ].map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.clinics.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            onClick={() => {
                              setTarget(c.id);
                              void load(1, c.id);
                              setTab('Visão geral');
                            }}
                          >
                            {c.name}
                          </button>
                        </td>
                        <td>{c.status}</td>
                        <td>
                          {c.plan
                            ? `${c.plan.name} · ${c.plan.status}`
                            : 'Indisponível'}
                        </td>
                        <td>
                          {c.plan
                            ? `${c.plan.alertCount} alerta(s)${c.plan.overLimit ? ' · acima do limite' : ''}`
                            : '—'}
                        </td>
                        <td>{c.users}</td>
                        <td>{c.messages}</td>
                        <td>{c.conversations}</td>
                        <td>{c.appointments}</td>
                        <td>{fmt(c.tokens)}</td>
                        <td>{c.lastActivity ?? 'Sem atividade'}</td>
                        <td>{c.createdAt}</td>
                        <td>
                          <button
                            disabled={!!accessBusy}
                            onClick={async () => {
                              const reason = window.prompt(
                                `Motivo para acessar ${c.name} (mínimo 10 caracteres):`,
                              );
                              if (!reason?.trim() || reason.trim().length < 10)
                                return;
                              setAccessBusy(c.id);
                              setError('');
                              try {
                                await api(`tenants/${c.id}/access`, {
                                  reason: reason.trim(),
                                });
                                window.location.assign('/');
                              } catch (failure) {
                                setError((failure as Error).message);
                                setAccessBusy('');
                              }
                            }}
                          >
                            {accessBusy === c.id
                              ? 'Abrindo…'
                              : 'Acessar clínica'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.clinics.length && <p>Nenhuma clínica encontrada.</p>}
            </section>
          )}
          {tab === 'Uso de IA' && (
            <section className="dashboard-panel">
              <h2>Uso de IA por clínica e modelo</h2>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {[
                        'Tenant',
                        'Provider / modelo',
                        'Requests',
                        'Entrada',
                        'Saída',
                        'Total',
                        'Tokens desconhecidos',
                        'Latência ms',
                        'Erros',
                      ].map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.map((r) => (
                      <tr key={r.tenantId + r.provider + r.model}>
                        <td>{r.tenantId}</td>
                        <td>
                          {r.provider} / {r.model}
                        </td>
                        <td>{r.requests}</td>
                        <td>{fmt(r.inputTokens)}</td>
                        <td>{fmt(r.outputTokens)}</td>
                        <td>{fmt(r.totalTokens)}</td>
                        <td>{r.unknownTokens}</td>
                        <td>{fmt(r.latencyMs)}</td>
                        <td>{r.errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.usage.length && <p>Sem uso registrado no período.</p>}
            </section>
          )}
          {tab === 'Integrações' && (
            <section className="dashboard-panel">
              <h2>Integrações</h2>
              <table>
                <thead>
                  <tr>
                    <th>Clínica</th>
                    <th>Integração</th>
                    <th>Status</th>
                    <th>Código seguro</th>
                    <th>Último teste</th>
                  </tr>
                </thead>
                <tbody>
                  {data.integrations.map((r) => (
                    <tr key={r.id}>
                      <td>{r.tenantName}</td>
                      <td>{r.type}</td>
                      <td>{r.status}</td>
                      <td>{r.errorCode ?? '—'}</td>
                      <td>{r.lastTestedAt ?? 'Não medido'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Estado cadastrado; não confirma disponibilidade atual do
                provedor.
              </p>
            </section>
          )}
          {tab === 'Incidentes' && (
            <section className="dashboard-panel">
              <h2>Incidentes operacionais</h2>
              {data.incidents.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Severidade</th>
                      <th>Subsistema</th>
                      <th>Ocorrências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incidents.map((r) => (
                      <tr key={r.tenantId + r.type}>
                        <td>{r.tenantId}</td>
                        <td>{r.severity}</td>
                        <td>{r.type}</td>
                        <td>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Nenhum incidente persistido no período.</p>
              )}
              {(!health || health.worker !== 'UP') && (
                <p>CRITICAL · Plataforma: sem heartbeat recente confirmado.</p>
              )}
            </section>
          )}
          {tab !== 'Visão geral' && tab !== 'Jobs' && (
            <div>
              <button
                disabled={data.page <= 1 || busy}
                onClick={() => void load(data.page - 1)}
              >
                Anterior
              </button>
              <span> Página {data.page} </span>
              <button
                disabled={
                  busy ||
                  (tab === 'Clínicas'
                    ? data.page * data.limit >= data.totalClinics
                    : (tab === 'Uso de IA'
                        ? data.usage
                        : tab === 'Integrações'
                          ? data.integrations
                          : data.incidents
                      ).length < data.limit)
                }
                onClick={() => void load(data.page + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'Jobs' && (
        <section className="dashboard-panel">
          <h2>Jobs e worker · plataforma inteira</h2>
          {health ? (
            <>
              <p>
                Saúde: {health.state} · Jobs falhos: {health.failedJobs} ·
                Provedores externos: {health.externalProviders} · Redis:{' '}
                {health.redis} · Worker: {health.worker} · Heartbeat:{' '}
                {health.heartbeatAt ?? 'Não confirmado'}
              </p>
              <table>
                <thead>
                  <tr>
                    {[
                      'Fila',
                      'Aguardando',
                      'Ativos',
                      'Atrasados',
                      'Falhos',
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {health.queues.map((q) => (
                    <tr key={q.name}>
                      <td>{q.name}</td>
                      <td>{q.waiting}</td>
                      <td>{q.active}</td>
                      <td>{q.delayed}</td>
                      <td>{q.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>Saúde das filas indisponível.</p>
          )}
          <button onClick={() => void healthLoad()}>Atualizar saúde</button>
        </section>
      )}
    </main>
  );
}
