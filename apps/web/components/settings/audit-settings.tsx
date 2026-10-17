'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
export type AuditItem = {
  id: string;
  createdAt: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  source: string;
  resourceType: string;
  resourceId: string;
  previousValues: unknown;
  newValues: unknown;
  metadata: unknown;
  correlationId: string | null;
};
export function AuditDetails({ item }: { item: AuditItem }) {
  return (
    <section aria-label="Detalhes da auditoria">
      <h2>{item.action}</h2>
      <p>Recurso: {item.resourceId}</p>
      <p>Correlação: {item.correlationId ?? 'Não registrada'}</p>
      <h3>Antes</h3>
      <pre>{JSON.stringify(item.previousValues, null, 2)}</pre>
      <h3>Depois</h3>
      <pre>{JSON.stringify(item.newValues, null, 2)}</pre>
      <h3>Metadata</h3>
      <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
    </section>
  );
}
export function AuditSettings() {
  const [items, setItems] = useState<AuditItem[]>([]),
    [selected, setSelected] = useState<AuditItem | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [message, setMessage] = useState(
      'Use os filtros para consultar o histórico da clínica ativa.',
    ),
    [busy, setBusy] = useState(false);
  async function load(next: number) {
    setBusy(true);
    setSelected(null);
    setItems([]);
    try {
      const query = new URLSearchParams({ page: String(next), limit: '25' });
      for (const [k, v] of Object.entries(filters))
        if (v.trim())
          query.set(
            k,
            k.startsWith('date') ? new Date(v).toISOString() : v.trim(),
          );
      const response = await fetch(`/api/audit?${query}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        setMessage(
          response.status === 403
            ? 'Sem permissão para consultar auditoria.'
            : 'Não foi possível consultar. Verifique a sessão e os filtros.',
        );
        setMore(false);
        return;
      }
      const result = await response.json();
      setItems(result.items);
      setMore(result.hasMore);
      setPage(next);
      setMessage(result.items.length ? '' : 'Nenhum registro encontrado.');
    } catch {
      setMessage('Não foi possível consultar a auditoria.');
      setMore(false);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void load(1);
  }
  return (
    <main style={{ padding: '2rem', maxWidth: 1200, margin: 'auto' }}>
      <Link href="/">Início</Link>
      <h1>Auditoria</h1>
      <form
        onSubmit={submit}
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
      >
        {Object.entries({
          action: 'Ação',
          resourceType: 'Tipo de recurso',
          resourceId: 'ID do recurso',
          actorType: 'Tipo de ator',
          actorUserId: 'ID do usuário',
          source: 'Origem',
          correlationId: 'Correlação',
          dateFrom: 'A partir de (UTC)',
          dateTo: 'Até (UTC)',
        }).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={filters[key] ?? ''}
              placeholder={
                key.startsWith('date') ? '2026-10-13T00:00:00Z' : undefined
              }
              onChange={(e) =>
                setFilters({ ...filters, [key]: e.target.value })
              }
            />
          </label>
        ))}
        <button disabled={busy}>Consultar</button>
      </form>
      <p role="status">{busy ? 'Carregando…' : message}</p>
      <table>
        <thead>
          <tr>
            {[
              'Data/hora (UTC)',
              'Ator',
              'Ação',
              'Recurso',
              'Origem',
              'Detalhes',
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.createdAt}</td>
              <td>
                {item.actorType}
                {item.actorUserId ? ` · ${item.actorUserId}` : ''}
              </td>
              <td>{item.action}</td>
              <td>{item.resourceType}</td>
              <td>{item.source}</td>
              <td>
                <button onClick={() => setSelected(item)}>Abrir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={busy || page <= 1} onClick={() => void load(page - 1)}>
        Anterior
      </button>
      <span> Página {page} </span>
      <button disabled={busy || !more} onClick={() => void load(page + 1)}>
        Próxima
      </button>
      {selected && <AuditDetails item={selected} />}
    </main>
  );
}
