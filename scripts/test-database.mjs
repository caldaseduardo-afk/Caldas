import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const name = `atendente-db-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const environment = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  NODE_ENV: 'development',
  AUTH_SECRET: randomBytes(32).toString('hex'),
  AUTH_ORIGIN: 'http://localhost:3000',
};

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    // Não imprimir env ou saída capturada: pode conter credenciais.
    throw new Error(`Falha no comando ${command}.`);
  }
  return result.stdout?.trim();
}

let started = false;
try {
  run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_DB=task002_test',
      '--publish',
      '127.0.0.1::5432',
      'postgres:17-bookworm',
    ],
    true,
  );
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const result = spawnSync(
      'docker',
      // O servidor temporário do entrypoint só atende socket Unix; aguardar TCP real.
      [
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'task002_test',
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(1000);
  }
  if (!ready) throw new Error('PostgreSQL de teste não ficou disponível.');
  const port = run('docker', ['port', name, '5432/tcp'], true)
    .split(':')
    .at(-1);
  environment.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:${port}/task002_test`;
  environment.TEST_DATABASE_URL = environment.DATABASE_URL;
  const scoped = ['--filter', '@atendente/database'];
  run('pnpm', [...scoped, 'db:migrate']);
  run('pnpm', [...scoped, 'db:migrate']);
  run('pnpm', [...scoped, 'db:seed']);
  run('pnpm', [...scoped, 'db:seed']);
  run('pnpm', [...scoped, 'test:integration']);
  run('pnpm', ['--filter', '@atendente/api', 'test:integration']);
  console.log(
    'Migrations do zero, reaplicação, seed e testes de integração aprovados.',
  );
} catch {
  console.error(
    'Validação de banco falhou. Confira os resultados acima e o Docker.',
  );
  process.exitCode = 1;
} finally {
  if (started) {
    const cleanup = spawnSync('docker', ['rm', '--force', name], {
      stdio: 'ignore',
      timeout: 30_000,
    });
    if (cleanup.status !== 0) {
      console.error(`Não foi possível remover o container de teste ${name}.`);
      process.exitCode = 1;
    }
  }
}
