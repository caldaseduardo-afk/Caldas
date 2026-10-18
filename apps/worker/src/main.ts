import {
  startPlatformHeartbeat,
  GoogleCalendarProvider,
  createCalendarSyncQueue,
  createCalendarSyncWorker,
  dispatchCalendarSync,
  calendarReconciliationHorizon,
  WhatsAppProvider,
  createMessagingQueue,
  createMessagingWorker,
  dispatchMessages,
  humanSlaConnection,
  createHumanSlaQueue,
  createHumanSlaWorker,
  dispatchHumanSlaJobs,
  createDatabaseClient,
  sweepExpiredHolds,
  createNotificationQueue,
  createNotificationWorker,
  reconcileAndDispatchNotifications,
  workerConcurrency,
  reconciliationHorizon,
} from '@atendente/database';
import { createApplication } from './bootstrap';
import { startHoldExpiry, sweepInterval } from './hold-expiry';
async function main() {
  humanSlaConnection(process.env.REDIS_URL);
  const interval = sweepInterval(process.env.HOLD_SWEEP_INTERVAL_MS);
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  const app = await createApplication();
  const calendarQueue = createCalendarSyncQueue(process.env.REDIS_URL ?? '');
  const calendarWorker = createCalendarSyncWorker(
    client,
    process.env.REDIS_URL ?? '',
    new GoogleCalendarProvider(),
    workerConcurrency(process.env.WORKER_CONCURRENCY),
  );
  const calendarHorizon = calendarReconciliationHorizon(
    process.env.CALENDAR_RECONCILIATION_HORIZON_DAYS,
  );
  const stopCalendar = startHoldExpiry(
    () => dispatchCalendarSync(client, calendarQueue, calendarHorizon),
    30000,
    () =>
      console.error(
        'Falha ao reconciliar calendário; intenção permanece no PostgreSQL.',
      ),
  );
  const notificationQueue = createNotificationQueue(
    process.env.REDIS_URL ?? '',
  );
  const notificationWorker = createNotificationWorker(
    client,
    process.env.REDIS_URL ?? '',
    workerConcurrency(process.env.WORKER_CONCURRENCY),
  );
  const notificationHorizon = reconciliationHorizon(
    process.env.NOTIFICATION_RECONCILIATION_HORIZON_DAYS,
  );
  const stopNotifications = startHoldExpiry(
    () =>
      reconcileAndDispatchNotifications(
        client,
        notificationQueue,
        notificationHorizon,
      ),
    30000,
    () =>
      console.error(
        'Falha ao reconciliar automações; intenção permanece no PostgreSQL.',
      ),
  );
  const queue = createHumanSlaQueue(process.env.REDIS_URL ?? '');
  const slaWorker = createHumanSlaWorker(client, process.env.REDIS_URL ?? '');
  const stopSla = startHoldExpiry(
    () => dispatchHumanSlaJobs(client, queue),
    5000,
    () =>
      console.error('Falha ao agendar SLA; intenção permanece no PostgreSQL.'),
  );
  const messagingQueue = process.env.WHATSAPP_GRAPH_VERSION
    ? createMessagingQueue(process.env.REDIS_URL ?? '')
    : undefined;
  const messagingWorker = messagingQueue
    ? createMessagingWorker(
        client,
        process.env.REDIS_URL ?? '',
        new WhatsAppProvider(process.env.WHATSAPP_GRAPH_VERSION!),
      )
    : undefined;
  const stopMessaging = messagingQueue
    ? startHoldExpiry(
        () => dispatchMessages(client, messagingQueue),
        5000,
        () => console.error('Falha ao despachar mensagens.'),
      )
    : async () => {};
  const stop = startHoldExpiry(
    () => sweepExpiredHolds(client),
    interval,
    () =>
      console.error('Falha ao expirar HOLDs; nova tentativa no próximo ciclo.'),
  );
  const stopHeartbeat = startPlatformHeartbeat(process.env.REDIS_URL ?? '');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      if (closing) return;
      closing = true;
      stopHeartbeat();
      void Promise.all([
        stop(),
        stopSla(),
        stopMessaging(),
        stopNotifications(),
        stopCalendar(),
      ])
        .then(() =>
          Promise.all([
            slaWorker.close(),
            messagingWorker?.close(),
            notificationWorker.close(),
            calendarWorker.close(),
          ]),
        )
        .then(() =>
          Promise.all([
            queue.close(),
            messagingQueue?.close(),
            notificationQueue.close(),
            calendarQueue.close(),
          ]),
        )
        .then(() => client.$disconnect())
        .then(() => app.close())
        .catch(() => {
          console.error('Falha ao encerrar worker.');
          process.exitCode = 1;
        });
    });
}
main().catch(() => {
  console.error(
    'Falha ao iniciar worker. Verifique configuração e migrations.',
  );
  process.exitCode = 1;
});
