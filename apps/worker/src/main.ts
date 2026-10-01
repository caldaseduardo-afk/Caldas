import { createApplication } from './bootstrap';

async function main() {
  const app = await createApplication();
  const heartbeat = setInterval(() => {}, 60_000);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => clearInterval(heartbeat));
  }
  void app;
}

main().catch(() => {
  console.error('Falha ao iniciar aplicação.');
  process.exitCode = 1;
});
