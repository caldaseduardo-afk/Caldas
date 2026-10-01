import { createApplication } from './bootstrap';

async function main() {
  const app = await createApplication();
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

main().catch(() => {
  console.error('Falha ao iniciar aplicação.');
  process.exitCode = 1;
});
