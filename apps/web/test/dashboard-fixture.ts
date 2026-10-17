import type { DashboardResponse } from '@atendente/types';
export function dashboardFixture(total = 9): DashboardResponse {
  const metrics = {
    total,
    confirmed: total === 9 ? 6 : total,
    cancelled: total === 9 ? 2 : 0,
    noShow: total === 9 ? 1 : 0,
    confirmationEligible: total === 9 ? 7 : total,
    noShowEligible: total === 9 ? 1 : 0,
    confirmationRate: total === 9 ? 85.71 : total ? 100 : 0,
    cancellationRate: total === 9 ? 22.22 : 0,
    noShowRate: total === 9 ? 100 : 0,
  };
  return {
    generatedAt: '2026-01-15T18:00:00Z',
    period: {
      from: '2026-01-15',
      to: '2026-01-15',
      startAt: '2026-01-15T03:00:00Z',
      endAt: '2026-01-16T03:00:00Z',
      timezone: 'America/Sao_Paulo',
    },
    filters: {},
    appointments: {
      ...metrics,
      sources: [{ source: 'WHATSAPP_AI', count: total }],
    },
    appointmentSeries: [{ date: '2026-01-15', ...metrics }],
    conversations: {
      total: 7,
      messages: 7,
      aiMessages: 5,
      humanMessages: 2,
      handoffs: 1,
    },
    conversationSeries: [
      {
        date: '2026-01-15',
        total: 7,
        messages: 7,
        aiMessages: 5,
        humanMessages: 2,
        handoffs: 1,
      },
    ],
    current: {
      aiActive: 3,
      humanActive: 2,
      needsHuman: 1,
      waitingPatient: 1,
      resolved: 0,
      closed: 0,
      firstAlert: 1,
      secondAlert: 0,
      externalAlert: 0,
    },
    humanService: { avgResponseSeconds: 240, claimedCycles: 3, violations: 1 },
    conversion: { started: 3, completed: 1, rate: 33.33 },
    rankings: total
      ? [
          { kind: 'service', id: 's', name: 'Consulta geral', count: total },
          { kind: 'provider', id: 'p', name: 'Dra. Ana', count: total },
          { kind: 'unit', id: 'u', name: 'Unidade Centro', count: total },
        ]
      : [],
  };
}
