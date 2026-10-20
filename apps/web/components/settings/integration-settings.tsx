'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type Settings = {
  openAi: { configured: boolean };
  whatsapp: {
    configured: boolean;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    status: string | null;
  };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.message ??
        'Falha ao salvar as configurações.',
    );
  return response.json();
}

export function IntegrationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openAiKey, setOpenAiKey] = useState('');
  const [whatsappToken, setWhatsappToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [whatsappSimulation, setWhatsappSimulation] = useState(false);

  const load = async () => {
    const result = await api<Settings>('settings/integrations');
    setSettings(result);
    setPhoneNumberId(result.whatsapp.phoneNumberId ?? '');
    setBusinessAccountId(result.whatsapp.businessAccountId ?? '');
  };

  useEffect(() => {
    void load().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'Falha ao carregar.'),
    );
  }, []);

  const save = async (event: FormEvent, payload: object) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await api('settings/integrations', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setOpenAiKey('');
      setWhatsappToken('');
      await load();
      setNotice(
        'Credencial salva com segurança. O valor não será exibido novamente.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card settings-card">
        <Link href="/" className="link-button">
          ← Início
        </Link>
        <h1>Configurações de integrações</h1>
        <p>
          As credenciais pertencem à clínica selecionada e são armazenadas
          criptografadas.
        </p>

        <form
          onSubmit={(event) => void save(event, { openAiApiKey: openAiKey })}
        >
          <h2>Inteligência artificial</h2>
          <p>
            Chave OpenAI:{' '}
            {settings?.openAi.configured ? 'configurada' : 'não configurada'}.
          </p>
          <label htmlFor="openai-key">Chave de API OpenAI</label>
          <input
            id="openai-key"
            type="password"
            autoComplete="new-password"
            value={openAiKey}
            onChange={(event) => setOpenAiKey(event.target.value)}
            placeholder={
              settings?.openAi.configured
                ? 'Informe uma nova chave para trocar'
                : 'sk-…'
            }
            minLength={20}
            maxLength={512}
            required
          />
          <button
            className="primary"
            disabled={busy || !openAiKey}
            type="submit"
          >
            Salvar chave OpenAI
          </button>
        </form>

        <form
          onSubmit={(event) =>
            void save(event, {
              whatsapp: {
                accessToken: whatsappToken,
                phoneNumberId,
                businessAccountId,
              },
            })
          }
        >
          <h2>WhatsApp Cloud API</h2>
          <p>
            Credenciais:{' '}
            {settings?.whatsapp.configured
              ? 'cadastradas para esta clínica'
              : 'ainda não cadastradas'}.
          </p>
          <div
            className={`whatsapp-simulation-status${whatsappSimulation ? ' is-simulated' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="simulation-dot" aria-hidden="true" />
            <strong>
              {whatsappSimulation
                ? 'Conectado · simulação local'
                : 'WhatsApp não conectado'}
            </strong>
            {whatsappSimulation && <span className="simulation-tag">SIMULAÇÃO</span>}
          </div>
          <div className="whatsapp-simulation-box">
            <div>
              <strong>Testar a aparência da conexão</strong>
              <p>
                Simulação visual apenas. Não valida as credenciais, não acessa a Meta e não envia nem recebe mensagens.
              </p>
            </div>
            <button
              type="button"
              className={whatsappSimulation ? '' : 'primary'}
              onClick={() => setWhatsappSimulation((active) => !active)}
            >
              {whatsappSimulation ? 'Encerrar simulação' : 'Simular conexão'}
            </button>
          </div>
          <label htmlFor="wa-phone-id">Phone Number ID</label>
          <input
            id="wa-phone-id"
            inputMode="numeric"
            value={phoneNumberId}
            onChange={(event) => setPhoneNumberId(event.target.value)}
            required
          />
          <label htmlFor="wa-business-id">WhatsApp Business Account ID</label>
          <input
            id="wa-business-id"
            inputMode="numeric"
            value={businessAccountId}
            onChange={(event) => setBusinessAccountId(event.target.value)}
            required
          />
          <label htmlFor="wa-token">Token de acesso permanente</label>
          <input
            id="wa-token"
            type="password"
            autoComplete="new-password"
            value={whatsappToken}
            onChange={(event) => setWhatsappToken(event.target.value)}
            placeholder={
              settings?.whatsapp.configured
                ? 'Informe um novo token para trocar'
                : 'Token do app Meta'
            }
            minLength={20}
            maxLength={4096}
            required
          />
          <button
            className="primary"
            disabled={busy || !whatsappToken}
            type="submit"
          >
            Salvar configuração WhatsApp
          </button>
          <p>
            O segredo da aplicação Meta e o token de verificação do webhook
            continuam configurados pelo operador do sistema.
          </p>
        </form>
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
