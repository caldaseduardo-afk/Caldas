export const eventTypes = [
  'message.status_updated',
  'conversation.sla_updated',
  'conversation.created',
  'conversation.updated',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.active_patient_changed',
  'message.created',
  'message.delivered',
  'message.read',
] as const;
export interface InboxEvent {
  eventId: string;
  type: (typeof eventTypes)[number];
  tenantId: string;
  conversationId: string;
  messageId?: string;
}
export type ConnectionStatus =
  'connecting' | 'connected' | 'reconnecting' | 'blocked';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseEvent(
  value: unknown,
  tenantId: string,
): InboxEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (
    Object.keys(e).some(
      (key) =>
        ![
          'eventId',
          'type',
          'tenantId',
          'conversationId',
          'messageId',
        ].includes(key),
    ) ||
    e.tenantId !== tenantId ||
    typeof e.eventId !== 'string' ||
    !uuid.test(e.eventId) ||
    typeof e.conversationId !== 'string' ||
    !uuid.test(e.conversationId) ||
    !eventTypes.includes(e.type as InboxEvent['type']) ||
    (e.messageId !== undefined &&
      (typeof e.messageId !== 'string' || !uuid.test(e.messageId)))
  )
    return null;
  return e as unknown as InboxEvent;
}
export function reconnectDelay(attempt: number, random = Math.random()) {
  return (
    Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) * (0.75 + random * 0.25)
  );
}
export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
}
export interface RealtimeCallbacks {
  status: (status: ConnectionStatus) => void;
  changed: (ids: string[]) => void;
  resync: () => void;
  denied: () => void;
}
// One instance per authenticated Workspace. No local mutation is inferred from an event.
export function connectRealtime(
  url: string,
  tenantId: string,
  callbacks: RealtimeCallbacks,
  factory: (url: string) => SocketLike = (url) => new WebSocket(url),
) {
  let socket: SocketLike | undefined,
    stopped = false,
    ready = false,
    attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined,
    batch: ReturnType<typeof setTimeout> | undefined,
    handshake: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>(),
    changed = new Set<string>();
  const detach = () => {
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
  };
  const denied = () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (batch) clearTimeout(batch);
    if (handshake) clearTimeout(handshake);
    changed.clear();
    detach();
    callbacks.status('blocked');
    callbacks.denied();
  };
  function schedule() {
    if (stopped) return;
    callbacks.status('reconnecting');
    retry = setTimeout(open, reconnectDelay(attempts++));
  }
  function open() {
    if (stopped) return;
    ready = false;
    try {
      socket = factory(url);
    } catch {
      schedule();
      return;
    }
    const current = socket;
    handshake = setTimeout(() => {
      if (!ready && socket === current) current.close();
    }, 10000);
    current.onopen = () => {
      /* Wait for server-authenticated tenant acknowledgement. */
    };
    current.onerror = () => {
      /* close drives backoff; REST remains available. */
    };
    current.onclose = (event) => {
      if (handshake) clearTimeout(handshake);
      if (stopped || socket !== current) return;
      if ([4401, 4403].includes(event.code)) {
        denied();
        return;
      }
      schedule();
    };
    current.onmessage = (event) => {
      if (
        stopped ||
        socket !== current ||
        typeof event.data !== 'string' ||
        event.data.length > 4096
      )
        return;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        payload.type === 'realtime.ready'
      ) {
        if (!('tenantId' in payload) || payload.tenantId !== tenantId) {
          denied();
          return;
        }
        if (ready) return;
        ready = true;
        attempts = 0;
        if (handshake) clearTimeout(handshake);
        callbacks.status('connected');
        callbacks.resync();
        return;
      }
      if (!ready) return;
      const e = parseEvent(payload, tenantId);
      if (!e || seen.has(e.eventId)) return;
      seen.add(e.eventId);
      if (seen.size > 512) seen.delete(seen.values().next().value!);
      changed.add(e.conversationId);
      if (!batch)
        batch = setTimeout(() => {
          batch = undefined;
          if (!stopped) {
            callbacks.changed([...changed]);
            changed.clear();
          }
        }, 100);
    };
  }
  callbacks.status('connecting');
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (batch) clearTimeout(batch);
    if (handshake) clearTimeout(handshake);
    detach();
    seen.clear();
    changed.clear();
  };
}
