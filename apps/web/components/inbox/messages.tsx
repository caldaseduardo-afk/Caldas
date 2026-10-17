'use client';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  mergeHistory,
  dateLabel,
  senderLabel,
  typeLabels,
  type History,
  type Message,
} from '../../lib/inbox';
export function MessageBubble({
  message,
  timezone,
}: {
  message: Message;
  timezone: string;
}) {
  return (
    <li className={`message message-${message.senderType}`}>
      <div className="message-by">
        <strong>{senderLabel(message)}</strong>
        <time>{dateLabel(message.createdAt, timezone)}</time>
      </div>
      {message.messageType !== 'TEXT' && (
        <div className="attachment">
          <strong>
            {typeLabels[message.messageType] ?? 'Mensagem não suportada'}
          </strong>
          {Object.entries(message.metadata)
            .filter(([key]) =>
              [
                'fileName',
                'mimeType',
                'sizeBytes',
                'label',
                'latitude',
                'longitude',
                'displayName',
                'phone',
                'selectionId',
              ].includes(key),
            )
            .map(([key, value]) => (
              <span key={key}>{value}</span>
            ))}
          {['IMAGE', 'AUDIO', 'DOCUMENT'].includes(message.messageType) && (
            <small>Arquivo não disponível nesta etapa.</small>
          )}
        </div>
      )}
      {message.content && <p>{message.content}</p>}
      {message.deliveryStatus && message.senderType === 'USER' && (
        <small>
          {message.errorCode === 'SEND_UNCERTAIN'
            ? 'Envio não confirmado. Verifique antes de enviar novamente.'
            : (
                {
                  LOCAL: 'Registro local',
                  PENDING: 'Aguardando envio',
                  SENDING: 'Enviando',
                  SENT: 'Enviada',
                  DELIVERED: 'Entregue',
                  READ: 'Lida',
                  FAILED: 'Falha no envio',
                } as Record<string, string>
              )[message.deliveryStatus]}
        </small>
      )}
    </li>
  );
}
export function MessageList({
  id,
  timezone,
  revision,
}: {
  id: string;
  timezone: string;
  revision: number;
}) {
  const [history, setHistory] = useState<History>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setBusy(false);
    api<History>(`inbox/conversations/${id}/messages`, {
      signal: request.signal,
    })
      .then((data) => {
        if (!request.signal.aborted) {
          setHistory((previous) => mergeHistory(previous, data));
          setError('');
        }
      })
      .catch(() => {
        if (!request.signal.aborted)
          setError('Não foi possível carregar as mensagens.');
      });
    return () => request.abort();
  }, [id, revision]);
  async function older() {
    if (!history?.before || busy) return;
    const signal = controller.current!.signal;
    setBusy(true);
    setError('');
    try {
      const data = await api<History>(
        `inbox/conversations/${id}/messages?before=${history.before}`,
        { signal },
      );
      if (!signal.aborted)
        setHistory((old) => ({
          items: [
            ...new Map(
              [...data.items, ...old!.items].map((message) => [
                message.id,
                message,
              ]),
            ).values(),
          ],
          before: data.before,
        }));
    } catch {
      if (!signal.aborted)
        setError('Não foi possível carregar as mensagens anteriores.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <div
      className="message-history"
      aria-label="Histórico de mensagens"
      aria-live="polite"
    >
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {!history && !error ? (
        <p role="status">Carregando mensagens…</p>
      ) : (
        history && (
          <>
            {history.before && (
              <button className="older" disabled={busy} onClick={older}>
                {busy ? 'Carregando…' : 'Carregar mensagens anteriores'}
              </button>
            )}
            {!history.items.length && (
              <p className="notice">
                Esta conversa ainda não possui mensagens.
              </p>
            )}
            <ol className="messages">
              {history.items.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  timezone={timezone}
                />
              ))}
            </ol>
          </>
        )
      )}
    </div>
  );
}
export function MessageComposer({
  id,
  enabled,
  onSaved,
  integrated = false,
}: {
  id: string;
  enabled: boolean;
  onSaved: () => void;
  integrated?: boolean;
}) {
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const intent = useRef<{ text: string; id: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return (
    <form
      className="composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!enabled || !text.trim() || busy) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setNotice('');
        if (!intent.current || intent.current.text !== text)
          intent.current = { text, id: crypto.randomUUID() };
        try {
          await api(`conversations/${id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              messageType: 'TEXT',
              content: text,
              requestId: intent.current.id,
            }),
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            intent.current = null;
            setText('');
            setNotice(
              integrated
                ? 'Mensagem registrada para envio ao WhatsApp.'
                : 'Mensagem salva localmente. Não enviada ao WhatsApp.',
            );
            onSaved();
          }
        } catch {
          if (!controller.signal.aborted)
            setNotice(
              'Não foi possível confirmar a gravação. Atualize o histórico antes de tentar novamente.',
            );
        } finally {
          if (!controller.signal.aborted) setBusy(false);
        }
      }}
    >
      <label htmlFor="message">Mensagem do atendente</label>
      <textarea
        id="message"
        value={text}
        maxLength={4000}
        rows={3}
        disabled={!enabled || busy}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          enabled
            ? 'Escreva uma mensagem…'
            : 'Composição indisponível para esta conversa ou permissão.'
        }
      />
      <div className="composer-footer">
        <small>
          {integrated
            ? 'Envio pelo WhatsApp'
            : 'Registro local · sem envio ao WhatsApp'}
        </small>
        <button className="primary" disabled={!enabled || busy || !text.trim()}>
          {busy
            ? 'Salvando…'
            : integrated
              ? 'Enviar mensagem'
              : 'Salvar mensagem'}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
