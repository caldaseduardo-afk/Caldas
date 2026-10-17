export interface AppointmentMetrics {
  total: number;
  confirmed: number;
  cancelled: number;
  noShow: number;
  confirmationEligible: number;
  noShowEligible: number;
  confirmationRate: number;
  cancellationRate: number;
  noShowRate: number;
}
export interface DashboardResponse {
  generatedAt: string;
  period: {
    from: string;
    to: string;
    startAt: string;
    endAt: string;
    timezone: string;
  };
  filters: { unitId?: string; serviceId?: string; providerId?: string };
  appointments: AppointmentMetrics & {
    sources: { source: string; count: number }[];
  };
  appointmentSeries: ({ date: string } & AppointmentMetrics)[];
  conversations: {
    total: number;
    messages: number;
    aiMessages: number;
    humanMessages: number;
    handoffs: number;
  };
  conversationSeries: {
    date: string;
    total: number;
    messages: number;
    aiMessages: number;
    humanMessages: number;
    handoffs: number;
  }[];
  current: {
    aiActive: number;
    waitingPatient: number;
    needsHuman: number;
    humanActive: number;
    resolved: number;
    closed: number;
    firstAlert: number;
    secondAlert: number;
    externalAlert: number;
  };
  humanService: {
    avgResponseSeconds: number | null;
    claimedCycles: number;
    violations: number;
  };
  conversion: { started: number; completed: number; rate: number };
  rankings: {
    kind: 'service' | 'provider' | 'unit';
    id: string;
    name: string;
    count: number;
  }[];
}
export interface DashboardOptions {
  items: { id: string; name: string }[];
  page: number;
  hasMore: boolean;
}
