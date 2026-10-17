import { expect, test, type Page } from '@playwright/test';
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222';
const patient = '33333333-3333-4333-8333-333333333333';
const tenant = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Clínica Aurora',
  timezone: 'America/Sao_Paulo',
};
function conversation(id = a) {
  return {
    id,
    assignedUserId: a,
    handoffReason: 'OTHER',
    handoffRequestedAt: '2026-10-02T17:00:00Z',
    assignedAt: '2026-10-02T17:00:00Z',
    resolvedAt: null,
    channel: 'WHATSAPP',
    status: id === a ? 'HUMAN_ACTIVE' : 'NEEDS_HUMAN',
    intent: 'SCHEDULING',
    lastMessageAt: '2026-10-02T17:32:00Z',
    contact: {
      id,
      displayName: id === a ? 'Maria Silva' : 'João Costa',
      channels: [{ address: '+5561999999999', type: 'WHATSAPP' }],
    },
    assignedUser: { user: { name: 'Ana' } },
    messages: [
      { content: 'Gostaria de confirmar minha consulta.', messageType: 'TEXT' },
    ],
    activePatient: { id: patient, name: 'Lucas Silva' },
  };
}
function detail(id = a) {
  return {
    ...conversation(id),
    links: [
      {
        patient: { id: patient, name: 'Lucas Silva' },
        relationshipType: 'MOTHER',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'SCHEDULING_ONLY',
      },
      {
        patient: { id: b, name: 'Pedro Silva' },
        relationshipType: 'MOTHER',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'FULL',
      },
    ],
    appointment: {
      startAt: '2026-10-15T14:00:00Z',
      status: 'CONFIRMED',
      service: 'Consulta de rotina',
      provider: 'Dra. Luiza Mendes',
      unit: 'Unidade Centro',
      timezone: 'America/Manaus',
    },
  };
}
function messages(id = a) {
  return ['PATIENT', 'AI', 'USER', 'SYSTEM'].map((senderType, index) => ({
    id: `${id}-${index}`,
    senderType,
    senderUser: senderType === 'USER' ? { user: { name: 'Ana' } } : null,
    messageType: 'TEXT',
    content: `${id === a ? 'Maria' : 'João'} ${['Olá! Gostaria de confirmar a consulta do Lucas.', 'A consulta está marcada para o dia 15 de outubro.', 'Olá, Maria. Vou conferir os detalhes para você.', 'Conversa registrada na central.'][index]}`,
    createdAt: '2026-10-02T17:32:00Z',
    metadata: {},
  }));
}
interface Options {
  denied?: boolean;
  noPatients?: boolean;
  noReply?: boolean;
  empty?: boolean;
  fail?: boolean;
  slowA?: boolean;
  nonText?: boolean;
  login?: boolean;
}
async function setup(page: Page, options: Options = {}) {
  const calls: string[] = [];
  let active = patient;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/', '');
    calls.push(path + url.search);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === 'auth/me')
      return json({ name: 'Ana Oliveira' }, options.login ? 401 : 200);
    if (path === 'tenancy/tenants') return json([tenant]);
    if (path === 'inbox/session')
      return json(
        {
          tenant,
          userId: a,
          canAssign: true,
          canTransfer: true,
          canClose: true,
          canReply: !options.noReply,
          canViewPatients: !options.noPatients,
          canViewAppointments: true,
        },
        options.denied ? 403 : 200,
      );
    if (path === 'inbox/conversations')
      return json(
        {
          items: options.empty
            ? []
            : [conversation(), conversation(b)].filter(
                (c) =>
                  !url.searchParams.has('status') ||
                  c.status === url.searchParams.get('status'),
              ),
          page: Number(url.searchParams.get('page') ?? 1),
          limit: 20,
          hasMore: true,
        },
        options.fail ? 500 : 200,
      );
    if (
      path.startsWith('conversations/') &&
      route.request().method() === 'PATCH'
    ) {
      active = route.request().postDataJSON().activePatientId;
      return json({});
    }
    if (
      path.startsWith('conversations/') &&
      route.request().method() === 'POST'
    )
      return json({}, 201);
    if (path.startsWith('inbox/conversations/')) {
      const id = path.split('/')[2]!;
      if (options.slowA && id === a)
        await new Promise((resolve) => setTimeout(resolve, 800));
      if (id !== a && id !== b) return json({}, 404);
      if (path.endsWith('/messages')) {
        const items = options.nonText
          ? [
              'IMAGE',
              'AUDIO',
              'DOCUMENT',
              'LOCATION',
              'CONTACT',
              'INTERACTIVE',
            ].map((messageType, index) => ({
              ...messages(id)[0],
              id: `media-${index}`,
              messageType,
              content: '<script>window.evil=true</script>',
              metadata: {
                fileName: 'arquivo.pdf',
                mediaRef: 'javascript:alert(1)',
              },
            }))
          : messages(id);
        return json(
          url.searchParams.has('before')
            ? {
                items: [
                  {
                    ...messages(id)[0],
                    id: 'older',
                    content: 'Mensagem anterior',
                  },
                ],
                before: null,
              }
            : { items, before: 'older-cursor' },
        );
      }
      const data = detail(id);
      data.activePatient = {
        id: active,
        name: active === patient ? 'Lucas Silva' : 'Pedro Silva',
      };
      return json({
        ...data,
        ...(options.noPatients
          ? { activePatient: null, links: [], appointment: null }
          : {}),
      });
    }
    return json({}, 404);
  });
  return calls;
}
test('inbox autorizada: três áreas, contexto, autores, status, intenção e timezone', async ({
  page,
}) => {
  await setup(page);
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(
    page.getByRole('heading', { name: 'Conversas', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Maria Silva' }),
  ).toBeVisible();
  const history = page.getByLabel('Histórico de mensagens');
  for (const author of ['Contato', 'IA', 'Ana', 'Sistema'])
    await expect(history.getByText(author, { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Conversa ativa').getByText('Intenção: Agendamento'),
  ).toBeVisible();
  await expect(
    page.getByLabel('Conversa ativa').getByText('Humano', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Mãe', { exact: true })).toHaveCount(2);
  await expect(
    page.getByText('Verificado · Somente agendamento'),
  ).toBeVisible();
  await expect(
    page.getByText('Dra. Luiza Mendes · Unidade Centro'),
  ).toBeVisible();
  await expect(page.getByText('15/10/2026, 10:00')).toBeVisible();
  await expect(history.getByText('02/10/2026, 14:32')).toHaveCount(4);
  await page.screenshot({
    path: '/tmp/task016-inbox-desktop.png',
    fullPage: true,
  });
});
test('sem conversation.view: nenhum histórico ou lista', async ({ page }) => {
  const calls = await setup(page, { denied: true });
  await page.goto('/conversations');
  await expect(
    page.getByRole('heading', { name: 'Selecione uma clínica autorizada' }),
  ).toBeVisible();
  expect(calls).not.toContain('inbox/conversations?page=1&limit=20');
});
test('URL direta estrangeira indisponível e refresh mantém seleção', async ({
  page,
}) => {
  await setup(page);
  await page.goto(
    '/conversations?conversationId=55555555-5555-4555-8555-555555555555',
  );
  await expect(
    page.getByRole('heading', { name: 'Conversa indisponível' }),
  ).toBeVisible();
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(
    page.getByRole('heading', { name: 'Maria Silva' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Maria Silva' }),
  ).toBeVisible();
});
test('filtros, busca e paginação consultam servidor; anteriores preservam histórico', async ({
  page,
}) => {
  const calls = await setup(page);
  await page.goto('/conversations');
  await page.getByLabel('Situação').selectOption('NEEDS_HUMAN');
  await expect(page.getByRole('button', { name: /João Costa/ })).toBeVisible();
  await page.getByLabel('Buscar contato').fill('João');
  await page.getByRole('button', { name: 'Buscar conversas' }).click();
  await expect
    .poll(() => calls.some((c) => c.includes('q=Jo%C3%A3o')))
    .toBe(true);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(() => calls.some((c) => c.includes('page=2'))).toBe(true);
  await page.getByRole('button', { name: /João Costa/ }).click();
  await page
    .getByRole('button', { name: 'Carregar mensagens anteriores' })
    .click();
  await expect(
    page.getByText('Mensagem anterior', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Histórico de mensagens').locator('li'),
  ).toHaveCount(5);
});
test('troca rápida cancela/ignora A atrasada sem sobrescrever B', async ({
  page,
}) => {
  await setup(page, { slowA: true });
  await page.goto('/conversations');
  await page.getByRole('button', { name: /Maria Silva/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Carregando conversa' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /João Costa/ }).click();
  await expect(page.getByRole('heading', { name: 'João Costa' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'João Costa' })).toBeVisible();
  await expect(page.getByLabel('Histórico de mensagens')).not.toContainText(
    'Maria Olá!',
  );
  expect(page.url()).toContain(b);
});
test('permissões ocultam pacientes e desabilitam composer', async ({
  page,
}) => {
  await setup(page, { noPatients: true, noReply: true });
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(
    page.getByRole('heading', { name: 'Maria Silva' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Paciente ativo' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Mensagem do atendente')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Salvar mensagem' }),
  ).toBeDisabled();
});
test('composer persiste localmente e paciente usa PATCH validado no backend', async ({
  page,
}) => {
  await setup(page);
  await page.goto(`/conversations?conversationId=${a}`);
  await page.getByLabel('Mensagem do atendente').fill('Resposta local');
  const sent = page.waitForRequest(
    (r) =>
      r.url().endsWith(`/conversations/${a}/messages`) && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar mensagem' }).click();
  expect((await sent).postDataJSON()).toEqual({
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    messageType: 'TEXT',
    content: 'Resposta local',
  });
  await expect(
    page.getByText('Registro local · sem envio ao WhatsApp'),
  ).toBeVisible();
  await page.getByLabel('Falando sobre', { exact: true }).selectOption(b);
  await expect(
    page.getByLabel('Conversa ativa').getByText('Falando sobre: Pedro Silva'),
  ).toBeVisible();
});
test('HTML é texto e tipos não-texto têm fallback sem URLs', async ({
  page,
}) => {
  await setup(page, { nonText: true });
  await page.goto(`/conversations?conversationId=${a}`);
  const history = page.getByLabel('Histórico de mensagens');
  for (const type of [
    'Imagem',
    'Áudio',
    'Documento',
    'Localização',
    'Contato compartilhado',
    'Interação',
  ])
    await expect(history.getByText(type, { exact: true })).toBeVisible();
  await expect(history.locator('script,img,audio,iframe,a')).toHaveCount(0);
  await expect(
    history.getByText('<script>window.evil=true</script>', { exact: true }),
  ).toHaveCount(6);
  expect(await page.evaluate(() => 'evil' in window)).toBe(false);
});
test('vazio e conversa não selecionada', async ({ page }) => {
  await setup(page, { empty: true });
  await page.goto('/conversations');
  await expect(page.getByText('Não há conversas para exibir.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Selecione uma conversa.' }),
  ).toBeVisible();
});
test('erro de API é genérico', async ({ page }) => {
  await setup(page, { fail: true });
  await page.goto('/conversations');
  await expect(
    page.getByLabel('Lista de conversas').getByRole('alert'),
  ).toContainText('Não foi possível');
});
test('notebook mantém chat utilizável e contexto recolhível, foco e teclado', async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/conversations?conversationId=${a}`);
  await expect(page.getByLabel('Mensagem do atendente')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Próxima consulta' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Contexto', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Próxima consulta' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/tmp/task016-inbox-notebook.png',
    fullPage: true,
  });
});
test('login reutiliza autenticação sem conteúdo de inbox', async ({ page }) => {
  await setup(page, { login: true });
  await page.goto('/conversations');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Senha')).toHaveAttribute('type', 'password');
  await expect(
    page.getByRole('heading', { name: 'Conversas', exact: true }),
  ).toHaveCount(0);
});
