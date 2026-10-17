'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
type Version = {
  id: string;
  versionNumber: number;
  status: string;
  assistantName: string;
  tone: string;
  customTone: string | null;
  greeting: string;
  systemInstructions: string;
  allowedContent: string[];
  enabledCapabilities: string[];
  knowledgeEnabled: boolean;
  handoffPaymentNegotiation: boolean;
  handoffKnowledgeMiss: boolean;
  model: string;
  temperature: number | null;
  maxOutputTokens: number;
  confidenceThreshold: number;
  updatedAt: string;
  publishedAt: string | null;
};
type Overview = {
  id: string | null;
  activeVersionId: string | null;
  activeVersion: Version | null;
  versions: Version[];
  updatedAt?: string;
};
const defaults = {
  assistantName: 'Clara',
  tone: 'FRIENDLY',
  greeting: 'Olá! Como posso ajudar?',
  systemInstructions: 'Responda dúvidas administrativas com clareza.',
  allowedContent: [
    'SCHEDULING',
    'RESCHEDULING',
    'CANCELLATION',
    'CLINIC_INFORMATION',
    'INSURANCE_INFORMATION',
    'PAYMENT_INFORMATION',
    'APPOINTMENT_PREPARATION',
  ],
  enabledCapabilities: [
    'SCHEDULING',
    'RESCHEDULING',
    'CANCELLATION',
    'KNOWLEDGE',
    'HANDOFF',
  ],
  knowledgeEnabled: true,
  handoffPaymentNegotiation: true,
  handoffKnowledgeMiss: true,
  temperature: 0.3,
  maxOutputTokens: 800,
  confidenceThreshold: 0.65,
};
const capabilityOptions = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'KNOWLEDGE',
  'HANDOFF',
];
const contentOptions = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'CLINIC_INFORMATION',
  'INSURANCE_INFORMATION',
  'PAYMENT_INFORMATION',
  'APPOINTMENT_PREPARATION',
];
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.message ??
        'Falha na operação.',
    );
  return response.json();
}
export function AISettings() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState<Version | null>(null);
  const [message, setMessage] = useState('Vocês aceitam Alfa Saúde?');
  const [simulation, setSimulation] = useState<unknown>(null);
  const [comparison, setComparison] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [o, v, m] = await Promise.all([
      api<Overview>('ai-configuration'),
      api<Version[]>('ai-configuration/versions'),
      api<{ models: string[] }>('ai-configuration/models'),
    ]);
    setOverview(o);
    setVersions(v);
    setModels(m.models);
    setDraft(v.find((x) => x.status === 'DRAFT') ?? null);
  };
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      await load();
      setNotice('Alteração salva.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Falha na operação.');
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    act(() =>
      api('ai-configuration/versions', {
        method: 'POST',
        body: JSON.stringify({
          ...defaults,
          model: models[0] ?? 'gpt-4.1-mini',
        }),
      }),
    );
  const clone = () =>
    act(() =>
      api('ai-configuration/versions/clone-active', {
        method: 'POST',
        body: JSON.stringify({
          expectedConfigurationUpdatedAt: overview?.updatedAt,
        }),
      }),
    );
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    return act(() =>
      api(`ai-configuration/versions/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedUpdatedAt: draft.updatedAt,
          assistantName: draft.assistantName,
          tone: draft.tone,
          customTone: draft.customTone,
          greeting: draft.greeting,
          systemInstructions: draft.systemInstructions,
          allowedContent: draft.allowedContent,
          enabledCapabilities: draft.enabledCapabilities,
          knowledgeEnabled: draft.knowledgeEnabled,
          handoffPaymentNegotiation: draft.handoffPaymentNegotiation,
          handoffKnowledgeMiss: draft.handoffKnowledgeMiss,
          model: draft.model,
          temperature: draft.temperature,
          maxOutputTokens: draft.maxOutputTokens,
          confidenceThreshold: draft.confidenceThreshold,
        }),
      }),
    );
  };
  const publish = () =>
    draft &&
    window.confirm(`Publicar a versão ${draft.versionNumber}?`) &&
    act(() =>
      api(`ai-configuration/versions/${draft.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: draft.updatedAt }),
      }),
    );
  const simulate = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      setSimulation(
        await api(`ai-configuration/versions/${draft.id}/simulate`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        }),
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Falha na simulação.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="settings-shell">
      <header className="settings-header">
        <Link href="/conversations">← Inbox</Link>
        <div>
          <span className="eyebrow">CONFIGURAÇÕES</span>
          <h1>Assistente de IA</h1>
          <p>
            Edite em rascunho, simule sem efeitos e publique quando estiver
            pronto.
          </p>
        </div>
        <div className="status-pill">
          Produção:{' '}
          {overview?.activeVersion
            ? `v${overview.activeVersion.versionNumber}`
            : 'padrão seguro'}
        </div>
      </header>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="settings-grid">
        <article className="settings-card">
          <h2>Versão em edição</h2>
          {!draft ? (
            <div className="empty">
              <p>Nenhum rascunho pendente.</p>
              <button
                disabled={busy || !models.length}
                onClick={overview?.activeVersion ? clone : create}
              >
                {overview?.activeVersion
                  ? 'Criar nova versão'
                  : 'Criar configuração inicial'}
              </button>
            </div>
          ) : (
            <form onSubmit={save}>
              <div className="version-row">
                <strong>v{draft.versionNumber}</strong>
                <span className="draft-badge">RASCUNHO</span>
              </div>
              <label>
                Nome do assistente
                <input
                  value={draft.assistantName}
                  maxLength={80}
                  onChange={(e) =>
                    setDraft({ ...draft, assistantName: e.target.value })
                  }
                />
              </label>
              <label>
                Tom
                <select
                  value={draft.tone}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tone: e.target.value,
                      customTone:
                        e.target.value === 'CUSTOM' ? draft.customTone : null,
                    })
                  }
                >
                  <option value="PROFESSIONAL">Profissional</option>
                  <option value="FRIENDLY">Amigável</option>
                  <option value="CONCISE">Conciso</option>
                  <option value="WARM">Acolhedor</option>
                  <option value="FORMAL">Formal</option>
                  <option value="CUSTOM">Personalizado</option>
                </select>
              </label>
              {draft.tone === 'CUSTOM' && (
                <label>
                  Tom personalizado
                  <textarea
                    value={draft.customTone ?? ''}
                    maxLength={500}
                    onChange={(e) =>
                      setDraft({ ...draft, customTone: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                Saudação
                <textarea
                  value={draft.greeting}
                  onChange={(e) =>
                    setDraft({ ...draft, greeting: e.target.value })
                  }
                />
              </label>
              <label>
                Instruções administrativas
                <textarea
                  rows={6}
                  value={draft.systemInstructions}
                  onChange={(e) =>
                    setDraft({ ...draft, systemInstructions: e.target.value })
                  }
                />
              </label>
              <label>
                Modelo
                <select
                  value={draft.model}
                  onChange={(e) =>
                    setDraft({ ...draft, model: e.target.value })
                  }
                >
                  {models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <div className="settings-inline">
                <label>
                  Temperatura
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={draft.temperature ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        temperature:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Confiança mínima
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={draft.confidenceThreshold}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        confidenceThreshold: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Máximo de tokens
                  <input
                    type="number"
                    min="64"
                    max="4096"
                    value={draft.maxOutputTokens}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxOutputTokens: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.knowledgeEnabled}
                  onChange={(e) =>
                    setDraft({ ...draft, knowledgeEnabled: e.target.checked })
                  }
                />{' '}
                Usar Base de Conhecimento publicada
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.handoffKnowledgeMiss}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      handoffKnowledgeMiss: e.target.checked,
                    })
                  }
                />{' '}
                Encaminhar quando faltar conhecimento
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.handoffPaymentNegotiation}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      handoffPaymentNegotiation: e.target.checked,
                    })
                  }
                />{' '}
                Encaminhar negociação de pagamento
              </label>
              <fieldset>
                <legend>Capacidades habilitadas</legend>
                {capabilityOptions.map((capability) => (
                  <label className="check" key={capability}>
                    <input
                      type="checkbox"
                      checked={draft.enabledCapabilities.includes(capability)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          enabledCapabilities: e.target.checked
                            ? [...draft.enabledCapabilities, capability]
                            : draft.enabledCapabilities.filter(
                                (value) => value !== capability,
                              ),
                        })
                      }
                    />{' '}
                    {capability}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Conteúdos permitidos</legend>
                {contentOptions.map((topic) => (
                  <label className="check" key={topic}>
                    <input
                      type="checkbox"
                      checked={draft.allowedContent.includes(topic)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          allowedContent: e.target.checked
                            ? [...draft.allowedContent, topic]
                            : draft.allowedContent.filter(
                                (value) => value !== topic,
                              ),
                        })
                      }
                    />{' '}
                    {topic}
                  </label>
                ))}
              </fieldset>
              <div className="actions">
                <button disabled={busy} type="submit">
                  Salvar rascunho
                </button>
                <button
                  disabled={busy}
                  type="button"
                  className="primary"
                  onClick={publish}
                >
                  Publicar
                </button>
              </div>
            </form>
          )}
        </article>
        <article className="settings-card">
          <h2>Simulação segura</h2>
          <p className="muted">
            Usa o rascunho e a base publicada. Ferramentas mutáveis nunca são
            executadas.
          </p>
          <label>
            Mensagem de teste
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <button disabled={busy || !draft} onClick={simulate}>
            Simular rascunho
          </button>
          {simulation !== null && (
            <pre className="simulation">
              {JSON.stringify(simulation, null, 2)}
            </pre>
          )}
        </article>
        <article className="settings-card history">
          <h2>Histórico</h2>
          {versions.map((v) => (
            <div className="history-row" key={v.id}>
              <div>
                <strong>
                  v{v.versionNumber} · {v.assistantName}
                </strong>
                <p>
                  {v.status}{' '}
                  {v.publishedAt
                    ? `· ${new Date(v.publishedAt).toLocaleString('pt-BR')}`
                    : ''}
                </p>
              </div>
              <div className="actions">
                {overview?.activeVersionId &&
                  overview.activeVersionId !== v.id && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        api('ai-configuration/compare', {
                          method: 'POST',
                          body: JSON.stringify({
                            from: overview.activeVersionId,
                            to: v.id,
                          }),
                        })
                          .then(setComparison)
                          .catch((e) => setNotice(e.message))
                      }
                    >
                      Comparar com ativa
                    </button>
                  )}
                {v.status === 'ARCHIVED' && (
                  <button
                    disabled={busy || !!draft}
                    onClick={() =>
                      window.confirm(
                        `Restaurar a versão ${v.versionNumber} como uma nova versão publicada?`,
                      ) &&
                      act(() =>
                        api(`ai-configuration/versions/${v.id}/restore`, {
                          method: 'POST',
                        }),
                      )
                    }
                  >
                    Restaurar como nova versão
                  </button>
                )}
              </div>
            </div>
          ))}
          {comparison !== null && (
            <pre className="simulation">
              {JSON.stringify(comparison, null, 2)}
            </pre>
          )}
        </article>
      </section>
    </main>
  );
}
