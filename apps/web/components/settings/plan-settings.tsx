'use client';
import { useEffect, useState } from 'react';
import type { TenantPlanContext } from '@atendente/types';

export function PlanSettings() {
  const [plan, setPlan] = useState<TenantPlanContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void fetch('/api/plans/current', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar o plano.');
        return response.json() as Promise<TenantPlanContext>;
      })
      .then((result) => { if (live) setPlan(result); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Falha ao carregar.'); });
    return () => { live = false; };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!plan) return <p role="status">Carregando…</p>;
  return (
    <div>
      <p><strong>{plan.plan.name}</strong> · {plan.subscription.status}</p>
      <p>Ciclo: {new Date(plan.subscription.currentPeriodStart).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} – {new Date(plan.subscription.currentPeriodEnd).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p>
      {plan.subscription.graceUntil && <p>Período de carência até {new Date(plan.subscription.graceUntil).toLocaleDateString('pt-BR')}</p>}
      {plan.subscription.scheduledPlanCode && <p>Próximo plano: {plan.subscription.scheduledPlanCode}</p>}
      {plan.alerts.length > 0 && <p role="status">Há métricas próximas ou acima do limite. Os limites de IA e mensagens são acompanhados sem interromper atendimentos.</p>}
      <p>Mensagens no ciclo: {new Intl.NumberFormat('pt-BR').format(plan.messageBreakdown.inbound)} recebidas · {new Intl.NumberFormat('pt-BR').format(plan.messageBreakdown.outbound)} enviadas.</p>
      <div className="plan-metrics">
        {plan.usage.map((item) => (
          <article key={item.metric}>
            <strong>{item.label}</strong>
            <span>{new Intl.NumberFormat('pt-BR').format(item.value)}{item.limit === null ? ' · sem limite' : ` / ${new Intl.NumberFormat('pt-BR').format(item.limit)}`}</span>
            <small>{item.level === 'OVER_LIMIT' ? 'Acima do limite' : item.level === 'UNLIMITED' ? 'Sem limite' : `${item.enforcement.replace('_', ' ').toLowerCase()}${item.percent === null ? '' : ` · ${Math.round(item.percent)}%`}`}</small>
          </article>
        ))}
      </div>
      <h2>Recursos</h2>
      <ul>{Object.entries(plan.capabilities).map(([name, enabled]) => <li key={name}>{name.replaceAll('_', ' ')}: {enabled ? 'incluído' : 'não incluído'}</li>)}</ul>
    </div>
  );
}
