export const slaLabels: Record<string, string> = {
  NONE: 'Na fila humana',
  FIRST: 'Alerta SLA',
  SECOND: 'Alerta crítico',
  EXTERNAL: 'Alerta externo requerido',
};
export function waitingLabel(requestedAt: string | null, now: number) {
  const start = requestedAt ? Date.parse(requestedAt) : NaN;
  if (!Number.isFinite(start)) return 'Aguardando atendimento';
  return `Aguardando há ${Math.max(0, Math.floor((now - start) / 60000))} min`;
}
