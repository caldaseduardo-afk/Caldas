export interface Tenant {
  id: string;
  name: string;
  timezone: string;
}
export interface Session {
  tenant: Tenant;
  userId: string;
  canAssign: boolean;
  canTransfer: boolean;
  canClose: boolean;
  canReply: boolean;
  canViewPatients: boolean;
  canViewAppointments: boolean;
}
export interface Patient {
  id: string;
  name: string;
}
export interface Conversation {
  integrationId?: string | null;
  id: string;
  channel: string;
  status: string;
  intent: string;
  assignedUserId: string | null;
  slaLevel: 'NONE' | 'FIRST' | 'SECOND' | 'EXTERNAL';
  handoffReason: string | null;
  handoffRequestedAt: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  contact: {
    id: string;
    displayName: string;
    channels: { address: string; type: string }[];
  };
  assignedUser: { user: { name: string } } | null;
  messages: { content: string; messageType: string }[];
  activePatient: Patient | null;
}
export interface Detail extends Conversation {
  links: {
    patient: Patient;
    relationshipType: string;
    relationshipStatus: string;
    authorizationLevel: string;
  }[];
  appointment: {
    startAt: string;
    status: string;
    service: string;
    provider: string;
    unit: string;
    timezone: string;
  } | null;
}
export interface Message {
  deliveryStatus?: string;
  errorCode?: string | null;
  id: string;
  senderType: string;
  senderUser: { user: { name: string } } | null;
  messageType: string;
  content: string;
  createdAt: string;
  metadata: Record<string, string | number>;
}
export interface History {
  items: Message[];
  before: string | null;
}
export interface Page {
  items: Conversation[];
  page: number;
  limit: number;
  hasMore: boolean;
}
export const statusLabels: Record<string, string> = {
  AI_ACTIVE: 'IA ativa',
  HUMAN_ACTIVE: 'Humano',
  NEEDS_HUMAN: 'Precisa humano',
  WAITING_PATIENT: 'Aguardando paciente',
  RESOLVED: 'Resolvida',
  CLOSED: 'Encerrada',
};
export const intentLabels: Record<string, string> = {
  SCHEDULING: 'Agendamento',
  RESCHEDULING: 'Reagendamento',
  CANCELLATION: 'Cancelamento',
  CONFIRMATION: 'Confirmação',
  INFORMATION: 'Informação',
  PAYMENT: 'Pagamento',
  COMPLAINT: 'Reclamação',
  CLINICAL_QUESTION: 'Dúvida clínica',
  OTHER: 'Outros',
};
export const typeLabels: Record<string, string> = {
  TEXT: 'Texto',
  IMAGE: 'Imagem',
  AUDIO: 'Áudio',
  DOCUMENT: 'Documento',
  LOCATION: 'Localização',
  CONTACT: 'Contato compartilhado',
  INTERACTIVE: 'Interação',
};
export function dateLabel(value: string | null, timezone: string) {
  if (!value) return 'Sem mensagens';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
export function senderLabel(message: Message) {
  return message.senderType === 'USER'
    ? (message.senderUser?.user.name ?? 'Atendente')
    : ({ PATIENT: 'Contato', AI: 'IA', SYSTEM: 'Sistema' }[
        message.senderType
      ] ?? 'Autor desconhecido');
}
export function selectedConversation(search: string) {
  const id = new URLSearchParams(search).get('conversationId');
  return id &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      id,
    )
    ? id
    : '';
}
export class ApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Sua sessão expirou. Entre novamente.'
        : status === 403
          ? 'Acesso não permitido. Selecione uma clínica autorizada.'
          : status === 404
            ? 'Conversa indisponível.'
            : 'Não foi possível carregar ou salvar os dados. Tente novamente.',
    );
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.status === 204 ? (undefined as T) : response.json();
}

// REST snapshots win; an event never supplies a possibly stale message snapshot.
export function mergeHistory(
  previous: History | undefined,
  recent: History,
): History {
  if (!previous?.items.length || !recent.items.length) return recent;
  const ids = new Set(previous.items.map((message) => message.id));
  if (!recent.items.some((message) => ids.has(message.id))) return recent;
  const items = new Map(previous.items.map((message) => [message.id, message]));
  for (const message of recent.items) items.set(message.id, message);
  return {
    items: [...items.values()].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
    before: previous.before,
  };
}
