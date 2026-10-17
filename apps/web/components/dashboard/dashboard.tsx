'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { DashboardResponse, DashboardOptions } from '@atendente/types';
const number = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
export const percent = (value: number) =>
  `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`;
export function duration(seconds: number | null) {
  if (seconds === null) return 'Sem dados';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)
    .toString()
    .padStart(2, '0')}m ${(rounded % 60).toString().padStart(2, '0')}s`;
}
export function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <article className="dashboard-metric">
      <h3>{label}</h3>
      <strong>{typeof value === 'number' ? number(value) : value}</strong>
      <p>{description}</p>
    </article>
  );
}
export function SeriesChart<T extends { date: string }>({
  title,
  rows,
  lines,
}: {
  title: string;
  rows: T[];
  lines: {
    key: Exclude<keyof T & string, 'date'>;
    label: string;
    color: string;
  }[];
}) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) => lines.map((line) => Number(row[line.key]))),
  );
  const x = (i: number) =>
    45 + (rows.length === 1 ? 345 : (i * 690) / (rows.length - 1));
  const y = (v: number) => 210 - (v * 175) / max;
  return (
    <section className="dashboard-panel">
      <h2>{title}</h2>
      {!rows.some((row) => lines.some((line) => Number(row[line.key]) > 0)) ? (
        <p className="dashboard-empty">Sem dados no período selecionado.</p>
      ) : (
        <svg viewBox="0 0 780 250" role="img" aria-label={title}>
          <title>
            {title}. Evolução diária; valores disponíveis na tabela abaixo.
          </title>
          <line x1="45" y1="210" x2="735" y2="210" stroke="#cad5d7" />
          <line x1="45" y1="35" x2="735" y2="35" stroke="#e0e8e8" />
          <text x="8" y="40">
            {number(max)}
          </text>
          <text x="20" y="215">
            0
          </text>
          {lines.map((line) => (
            <g key={line.key}>
              <polyline
                fill="none"
                stroke={line.color}
                strokeWidth="2.5"
                points={rows
                  .map((row, i) => `${x(i)},${y(Number(row[line.key]))}`)
                  .join(' ')}
              />
              {rows.map((row, i) => (
                <circle
                  key={row.date}
                  cx={x(i)}
                  cy={y(Number(row[line.key]))}
                  r="3"
                  fill={line.color}
                >
                  <title>
                    {row.date}: {line.label} {Number(row[line.key])}
                  </title>
                </circle>
              ))}
            </g>
          ))}
          <text x="45" y="240">
            {rows[0]?.date}
          </text>
          <text x="735" y="240" textAnchor="end">
            {rows.at(-1)?.date}
          </text>
        </svg>
      )}
      <div className="dashboard-legend">
        {lines.map((line) => (
          <span key={line.key}>
            <i style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
      <details>
        <summary>Valores diários acessíveis</summary>
        <div className="dashboard-table">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                {lines.map((l) => (
                  <th key={l.key}>{l.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <th>{row.date}</th>
                  {lines.map((l) => (
                    <td key={l.key}>{number(Number(row[l.key]))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function ResourceFilter({
  kind,
  label,
  value,
  onChange,
}: {
  kind: 'unit' | 'service' | 'provider';
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<DashboardOptions | null>(null),
    [error, setError] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setError(false);
      fetch(
        `/api/analytics/dashboard/options?${new URLSearchParams({ kind, page: String(page), search })}`,
        { signal: controller.signal, cache: 'no-store' },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const body = (await response.json()) as DashboardOptions;
          if (!controller.signal.aborted) setData(body);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError(true);
            setData(null);
          }
        });
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, page, search]);
  const options = data?.items ?? [];
  return (
    <fieldset className="dashboard-resource">
      <legend>{label}</legend>
      <input
        aria-label={`Buscar ${label.toLowerCase()}`}
        placeholder="Buscar por nome"
        maxLength={100}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          setSelected(options.find((r) => r.id === e.target.value) ?? null);
          onChange(e.target.value);
        }}
      >
        <option value="">Todos</option>
        {selected && !options.some((r) => r.id === selected.id) && (
          <option value={selected.id}>{selected.name}</option>
        )}
        {options.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      {error && <small role="status">Não foi possível carregar opções.</small>}
      <div>
        <button
          type="button"
          aria-label={`Página anterior de ${label.toLowerCase()}`}
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <small>Página {page}</small>
        <button
          type="button"
          aria-label={`Próxima página de ${label.toLowerCase()}`}
          disabled={!data?.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </fieldset>
  );
}
const labels: Record<string, string> = {
  WHATSAPP_AI: 'WhatsApp · IA',
  WHATSAPP_HUMAN: 'WhatsApp · humano',
  WEB: 'Web',
  PHONE: 'Telefone',
  MANUAL: 'Manual',
  IMPORT: 'Importação',
};
export function DashboardContent({ data }: { data: DashboardResponse }) {
  const a = data.appointments,
    c = data.current;
  return (
    <>
      <p className="dashboard-period">
        {data.period.from} até {data.period.to} · {data.period.timezone} ·
        Atualizado em{' '}
        {new Intl.DateTimeFormat('pt-BR', {
          timeZone: data.period.timezone,
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(data.generatedAt))}
      </p>
      <section aria-label="Agenda no período">
        <h2>Agenda no período</h2>
        <p>
          Consultas pela data de realização. Os filtros de unidade, serviço e
          profissional se aplicam a esta seção e aos rankings.
        </p>
        <div className="dashboard-cards">
          <Metric
            label="Consultas agendadas"
            value={a.total}
            description="Total no período, incluindo canceladas; exclui históricos remarcados."
          />
          <Metric
            label="Confirmadas"
            value={a.confirmed}
            description={`Confirmadas, com chegada registrada ou concluídas. Taxa: ${percent(a.confirmationRate)} das não canceladas.`}
          />
          <Metric
            label="Cancelamentos"
            value={a.cancelled}
            description={`${percent(a.cancellationRate)} do total, pela data da consulta.`}
          />
          <Metric
            label="No-show"
            value={a.noShow}
            description={`${percent(a.noShowRate)} entre concluídas e faltas de consultas já iniciadas.`}
          />
        </div>
      </section>
      <SeriesChart
        title="Evolução das consultas"
        rows={data.appointmentSeries}
        lines={[
          { key: 'total', label: 'Total', color: '#0e6870' },
          { key: 'confirmed', label: 'Confirmadas', color: '#397b45' },
          { key: 'cancelled', label: 'Canceladas', color: '#b45c24' },
          { key: 'noShow', label: 'No-show', color: '#985388' },
        ]}
      />
      <section aria-label="Atendimento agora">
        <h2>Atendimento agora</h2>
        <p>
          Estado atual de toda a clínica, independente do período e dos filtros
          de agenda.
        </p>
        <div className="dashboard-cards">
          <Metric
            label="IA ativa"
            value={c.aiActive}
            description="Conversas atualmente atendidas pela IA."
          />
          <Metric
            label="Atendimento humano"
            value={c.humanActive}
            description="Conversas atualmente assumidas por atendentes."
          />
          <Metric
            label="Precisa humano"
            value={c.needsHuman}
            description="Conversas aguardando um atendente."
          />
          <Metric
            label="Aguardando paciente"
            value={c.waitingPatient}
            description="Conversas aguardando resposta do paciente."
          />
        </div>
        <p>
          Resolvidas: {number(c.resolved)} · Encerradas: {number(c.closed)}
        </p>
      </section>
      <section aria-label="Atendimento no período">
        <h2>Atendimento no período</h2>
        <p>
          Toda a clínica; filtros de agenda não restringem conversas, SLA ou
          conversão.
        </p>
        <div className="dashboard-cards">
          <Metric
            label="Conversas com atividade"
            value={data.conversations.total}
            description="Conversas distintas com mensagem no período."
          />
          <Metric
            label="Handoffs solicitados"
            value={data.conversations.handoffs}
            description="Solicitações reais registradas no período; uma conversa pode ter vários ciclos."
          />
          <Metric
            label="Tempo médio para assumir"
            value={duration(data.humanService.avgResponseSeconds)}
            description={`${data.humanService.claimedCycles} ciclos SLA assumidos no período; da solicitação à primeira atribuição.`}
          />
          <Metric
            label="Conversão em agendamento"
            value={percent(data.conversion.rate)}
            description={`${data.conversion.completed} de ${data.conversion.started} fluxos de agendamento iniciados no período concluíram com consulta pela IA.`}
          />
        </div>
      </section>
      <SeriesChart
        title="Evolução do atendimento"
        rows={data.conversationSeries}
        lines={[
          { key: 'total', label: 'Conversas ativas no dia', color: '#0e6870' },
          { key: 'aiMessages', label: 'Mensagens IA', color: '#6b5ba9' },
          {
            key: 'humanMessages',
            label: 'Mensagens humanas',
            color: '#397b45',
          },
          { key: 'handoffs', label: 'Handoffs', color: '#b45c24' },
        ]}
      />
      <p className="dashboard-note">
        Uma conversa pode aparecer em vários dias. A soma diária não equivale ao
        total de conversas distintas do período. Mensagens indicam volume, não
        estado atual.
      </p>
      <section className="dashboard-panel">
        <h2>SLA humano</h2>
        <div className="dashboard-cards">
          <Metric
            label="Alerta 1 · agora"
            value={c.firstAlert}
            description="Aguardando no primeiro nível de alerta."
          />
          <Metric
            label="Alerta 2 · agora"
            value={c.secondAlert}
            description="Aguardando no segundo nível de alerta."
          />
          <Metric
            label="Crítico · agora"
            value={c.externalAlert}
            description="Aguardando no nível crítico de alerta."
          />
          <Metric
            label="Violações no período"
            value={data.humanService.violations}
            description="Ciclos distintos com alerta efetivamente registrado no período."
          />
        </div>
        <p>
          Tempos incluem apenas ciclos com regra SLA e atendimento assumido.
          Níveis refletem o motor de SLA existente.
        </p>
      </section>
      <div className="dashboard-columns">
        <section className="dashboard-panel">
          <h2>Agendamentos por origem</h2>
          <ul className="dashboard-ranking">
            {a.sources.map((row) => (
              <li key={row.source}>
                <span>{labels[row.source] ?? row.source}</span>
                <strong>{number(row.count)}</strong>
              </li>
            ))}
          </ul>
        </section>
        {(['service', 'provider', 'unit'] as const)
          .filter(
            (kind) =>
              kind !== 'unit' ||
              data.rankings.filter((r) => r.kind === 'unit').length > 1,
          )
          .map((kind) => (
            <section className="dashboard-panel" key={kind}>
              <h2>
                {kind === 'service'
                  ? 'Top 5 serviços'
                  : kind === 'provider'
                    ? 'Top 5 profissionais'
                    : 'Top 5 unidades'}
              </h2>
              {!data.rankings.some((r) => r.kind === kind) ? (
                <p>Sem dados no período selecionado.</p>
              ) : (
                <ol className="dashboard-ranking">
                  {data.rankings
                    .filter((r) => r.kind === kind)
                    .map((row) => (
                      <li key={row.id}>
                        <span>{row.name}</span>
                        <strong>{number(row.count)}</strong>
                      </li>
                    ))}
                </ol>
              )}
            </section>
          ))}
      </div>
    </>
  );
}
export function ClinicDashboard() {
  const [filters, setFilters] = useState({
    period: 'LAST_30_DAYS',
    from: '',
    to: '',
    unitId: '',
    serviceId: '',
    providerId: '',
  });
  const [data, setData] = useState<DashboardResponse | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (input: typeof filters) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value && (input.period === 'CUSTOM' || !['from', 'to'].includes(key)))
        query.set(key, value);
    try {
      const response = await fetch(`/api/analytics/dashboard?${query}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const message =
          response.status === 403
            ? 'Sem permissão para acessar o dashboard.'
            : response.status === 401
              ? 'Entre na inbox para iniciar sua sessão.'
              : response.status === 400
                ? 'Verifique as datas e o limite de 366 dias.'
                : 'Não foi possível carregar os indicadores. Tente novamente.';
        throw new Error(message);
      }
      const result = (await response.json()) as DashboardResponse;
      if (!controller.signal.aborted) setData(result);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setData(null);
        setError(
          failure instanceof Error
            ? failure.message
            : 'Não foi possível carregar.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load({
      period: 'LAST_30_DAYS',
      from: '',
      to: '',
      unitId: '',
      serviceId: '',
      providerId: '',
    });
    return () => active.current?.abort();
  }, [load]);
  function submit(event: FormEvent) {
    event.preventDefault();
    void load(filters);
  }
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">ATENDENTE IA · CLÍNICA ATIVA</p>
          <h1>Dashboard</h1>
          <p>Agenda e atendimento em uma visão operacional.</p>
        </div>
        <Link href="/conversations">Abrir inbox</Link>
      </header>
      <form onSubmit={submit} className="dashboard-panel dashboard-filters">
        <div className="dashboard-period-filter">
          <label>
            Período
            <select
              aria-label="Período"
              value={filters.period}
              onChange={(e) =>
                setFilters({ ...filters, period: e.target.value })
              }
            >
              <option value="TODAY">Hoje</option>
              <option value="LAST_7_DAYS">Últimos 7 dias</option>
              <option value="LAST_30_DAYS">Últimos 30 dias</option>
              <option value="THIS_MONTH">Este mês</option>
              <option value="LAST_MONTH">Mês anterior</option>
              <option value="CUSTOM">Personalizado</option>
            </select>
          </label>
          {filters.period === 'CUSTOM' && (
            <>
              <label>
                Data inicial
                <input
                  type="date"
                  required
                  value={filters.from}
                  onChange={(e) =>
                    setFilters({ ...filters, from: e.target.value })
                  }
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  required
                  value={filters.to}
                  onChange={(e) =>
                    setFilters({ ...filters, to: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Atualizando…' : 'Aplicar / atualizar'}
          </button>
        </div>
        <div className="dashboard-filter-resources">
          {(['unit', 'service', 'provider'] as const).map((kind) => (
            <ResourceFilter
              key={kind}
              kind={kind}
              label={
                kind === 'unit'
                  ? 'Unidade'
                  : kind === 'service'
                    ? 'Serviço'
                    : 'Profissional'
              }
              value={filters[`${kind}Id`]}
              onChange={(value) =>
                setFilters((previous) => ({
                  ...previous,
                  [`${kind}Id`]: value,
                }))
              }
            />
          ))}
        </div>
        <small>
          Os filtros são aplicados ao clicar em atualizar. A unidade define
          também o timezone do período.
        </small>
      </form>
      {busy && (
        <p role="status" className="dashboard-loading">
          Carregando indicadores…
        </p>
      )}
      {error && (
        <p role="alert" className="dashboard-error">
          {error}
        </p>
      )}
      <div aria-busy={busy}>{data && <DashboardContent data={data} />}</div>
    </main>
  );
}
