'use client';
import { useEffect, useRef, useState } from 'react';
import { api, dateLabel, type Detail, type Session } from '../../lib/inbox';
const relationshipLabels: Record<string, string> = {
  SELF: 'Próprio paciente',
  MOTHER: 'Mãe',
  FATHER: 'Pai',
  SPOUSE: 'Cônjuge',
  SON_DAUGHTER: 'Filho(a)',
  SECRETARY: 'Secretário(a)',
  CAREGIVER: 'Cuidador(a)',
  LEGAL_GUARDIAN: 'Responsável legal',
  OTHER: 'Outro vínculo',
};
const authorizationLabels: Record<string, string> = {
  FULL: 'Completa',
  SCHEDULING_ONLY: 'Somente agendamento',
  NO_ACCESS: 'Sem acesso',
};
export function ContextPanel({
  detail,
  session,
  onChanged,
}: {
  detail: Detail;
  session: Session;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const closed = ['RESOLVED', 'CLOSED'].includes(detail.status);
  return (
    <aside className="context-panel" aria-label="Contexto da conversa">
      <div className="eyebrow">CONTEXTO</div>
      <section>
        <h3>Contato</h3>
        <strong>{detail.contact.displayName}</strong>
        <p>
          {detail.contact.channels[0]?.address ?? 'Sem telefone cadastrado'}
        </p>
        <span className="muted">{detail.channel}</span>
      </section>
      {session.canViewPatients && (
        <>
          <section>
            <h3>Paciente ativo</h3>
            <p>{detail.activePatient?.name ?? 'Nenhum paciente selecionado'}</p>
            {session.canReply && !closed && (
              <>
                <label htmlFor="patient">Falando sobre</label>
                <select
                  id="patient"
                  disabled={busy}
                  value={detail.activePatient?.id ?? ''}
                  onChange={async (e) => {
                    const request = new AbortController();
                    controller.current = request;
                    setBusy(true);
                    setError('');
                    try {
                      await api(`conversations/${detail.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          activePatientId: e.target.value || null,
                        }),
                        signal: request.signal,
                      });
                      if (!request.signal.aborted) onChanged();
                    } catch {
                      if (!request.signal.aborted)
                        setError(
                          'Não foi possível alterar o paciente. Verifique o vínculo e atualize.',
                        );
                    } finally {
                      if (!request.signal.aborted) setBusy(false);
                    }
                  }}
                >
                  <option value="">Sem paciente</option>
                  {detail.links.map((link) => (
                    <option
                      key={link.patient.id}
                      value={link.patient.id}
                      disabled={
                        link.relationshipStatus !== 'VERIFIED' ||
                        link.authorizationLevel === 'NO_ACCESS'
                      }
                    >
                      {link.patient.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </section>
          <section>
            <h3>Pacientes vinculados</h3>
            {!detail.links.length && <p>Nenhum vínculo disponível.</p>}
            {detail.links.map((link) => (
              <div className="patient-link" key={link.patient.id}>
                <strong>{link.patient.name}</strong>
                <span>
                  {relationshipLabels[link.relationshipType] ??
                    link.relationshipType}
                </span>
                <small>
                  {link.relationshipStatus === 'VERIFIED'
                    ? 'Verificado'
                    : link.relationshipStatus === 'REVOKED'
                      ? 'Revogado'
                      : 'Declarado'}{' '}
                  · {authorizationLabels[link.authorizationLevel]}
                </small>
              </div>
            ))}
          </section>
          {session.canViewAppointments && (
            <section>
              <h3>Próxima consulta</h3>
              {detail.appointment ? (
                <>
                  <strong>{detail.appointment.service}</strong>
                  <p>
                    {dateLabel(
                      detail.appointment.startAt,
                      detail.appointment.timezone,
                    )}
                  </p>
                  <p>
                    {detail.appointment.provider} · {detail.appointment.unit}
                  </p>
                  <span className="badge">
                    {detail.appointment.status === 'CONFIRMED'
                      ? 'Confirmada'
                      : 'Aguardando confirmação'}
                  </span>
                  <small className="timezone">
                    {detail.appointment.timezone}
                  </small>
                </>
              ) : (
                <p>Nenhuma consulta futura disponível para o paciente ativo.</p>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  );
}
