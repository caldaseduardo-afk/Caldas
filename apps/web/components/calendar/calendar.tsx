'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNavigation } from '../inbox/top-navigation';

type Tenant = { id: string; name: string; timezone: string };
type Unit = { id: string; name: string };
type CalendarAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  patient: { name: string };
  service: { name: string };
  provider: { name: string };
  unit: { name: string };
};
const statusLabels: Record<string, string> = {
  PENDING_CONFIRMATION: 'Aguardando confirmação',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Em atendimento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'Não compareceu',
  RESCHEDULED: 'Remarcada',
};

export function addCivilDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

export function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function startOfWeek(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addCivilDays(dateKey, -mondayOffset);
}

export function localMidnightAsUtc(dateKey: string, timezone: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day);
  let instant = desired;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observed = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const difference = desired - observed;
    instant += difference;
    if (difference === 0) break;
  }
  return new Date(instant);
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 403 ? 'Seu perfil não tem permissão para consultar esta agenda.' : 'Não foi possível carregar a agenda.');
  return response.json() as Promise<T>;
}

function civilLabel(dateKey: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: timezone }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function timeLabel(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(instant));
}

export function Calendar() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getJson<Tenant>('tenancy/active', controller.signal),
      getJson<Unit[]>('tenancy/units', controller.signal),
    ]).then(([activeTenant, activeUnits]) => {
      if (controller.signal.aborted) return;
      setTenant(activeTenant);
      setUnits(activeUnits);
      setSelectedDate(dateKeyInTimezone(new Date(), activeTenant.timezone));
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a agenda.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const monday = selectedDate ? startOfWeek(selectedDate) : '';
  useEffect(() => {
    if (!tenant || !monday) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const startAt = localMidnightAsUtc(monday, tenant.timezone);
    const endAt = localMidnightAsUtc(addCivilDays(monday, 7), tenant.timezone);
    const params = new URLSearchParams({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    if (selectedUnit) params.set('unitId', selectedUnit);
    void getJson<CalendarAppointment[]>(`appointments/calendar?${params}`, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setAppointments(rows); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a agenda.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tenant, monday, selectedUnit]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addCivilDays(monday || '2026-01-05', index)), [monday]);
  const visibleAppointments = appointments.filter((appointment) => {
    if (statusFilter === 'ACTIVE') return ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'].includes(appointment.status);
    if (statusFilter === 'HISTORY') return ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(appointment.status);
    return true;
  });
  const count = visibleAppointments.length;
  const timezone = tenant?.timezone ?? 'UTC';

  return (
    <div className="application">
      <header className="app-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span className="brand-copy"><strong>Atendente IA</strong><small>Atendimento da clínica</small></span>
        </Link>
        <TopNavigation />
      </header>
      <main className="calendar-page">
      <header className="calendar-heading">
        <div>
          <div className="eyebrow">AGENDA DA CLÍNICA</div>
          <h1>Agenda</h1>
          <p>Visualização semanal dos agendamentos registrados.</p>
        </div>
        <div className="calendar-timezone">Fuso horário <strong>{timezone}</strong></div>
      </header>
      <section className="calendar-toolbar" aria-label="Controles da agenda">
        <div className="calendar-navigation">
          <button aria-label="Semana anterior" disabled={!selectedDate} onClick={() => setSelectedDate(addCivilDays(monday, -7))}>‹</button>
          <button onClick={() => tenant && setSelectedDate(dateKeyInTimezone(new Date(), tenant.timezone))}>Hoje</button>
          <button aria-label="Próxima semana" disabled={!selectedDate} onClick={() => setSelectedDate(addCivilDays(monday, 7))}>›</button>
          <strong>{monday && `${civilLabel(monday, timezone, { day: 'numeric', month: 'long' })} – ${civilLabel(addCivilDays(monday, 6), timezone, { day: 'numeric', month: 'long', year: 'numeric' })}`}</strong>
        </div>
        <label className="calendar-unit-filter">
          Unidade
          <select value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
        <label className="calendar-status-filter">
          Situação
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">Todas</option>
            <option value="ACTIVE">Agendamentos ativos</option>
            <option value="HISTORY">Histórico</option>
          </select>
        </label>
        <span className="calendar-count">{count} {count === 1 ? 'agendamento' : 'agendamentos'}</span>
      </section>
      {error && <p role="alert" className="notice">{error}</p>}
      {loading ? <p className="calendar-state" role="status">Carregando agenda…</p> : error ? null : (
        <section className="calendar-week" aria-label="Agendamentos da semana">
          {days.map((dateKey) => {
            const rows = visibleAppointments.filter((appointment) => dateKeyInTimezone(new Date(appointment.startAt), timezone) === dateKey);
            const isToday = tenant && dateKeyInTimezone(new Date(), tenant.timezone) === dateKey;
            return (
              <article className={`calendar-day${isToday ? ' is-today' : ''}`} key={dateKey}>
                <header className="calendar-day-header">
                  <span>{civilLabel(dateKey, timezone, { weekday: 'short' })}</span>
                  <strong>{civilLabel(dateKey, timezone, { day: '2-digit', month: 'short' })}</strong>
                </header>
                <div className="calendar-day-events">
                  {!rows.length ? <p className="calendar-no-events">Sem agendamentos</p> : rows.map((appointment) => (
                    <article className={`calendar-event status-${appointment.status}`} key={appointment.id}>
                      <strong className="calendar-event-time">{timeLabel(appointment.startAt, timezone)}–{timeLabel(appointment.endAt, timezone)}</strong>
                      <strong className="calendar-event-patient">{appointment.patient.name}</strong>
                      <span>{appointment.service.name}</span>
                      <span>{appointment.provider.name}</span>
                      <span className="calendar-event-unit">{appointment.unit.name}</span>
                      <small>{statusLabels[appointment.status] ?? appointment.status}</small>
                    </article>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}
      </main>
    </div>
  );
}
