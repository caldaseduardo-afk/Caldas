'use client';
import { useEffect, useRef, useState } from 'react';
import { connectRealtime, type ConnectionStatus } from './realtime';
export function useRealtime(
  tenantId: string,
  changed: (ids: string[]) => void,
  resync: () => void,
  denied: () => void,
) {
  const callbacks = useRef({ changed, resync, denied });
  callbacks.current = { changed, resync, denied };
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  useEffect(() => {
    const url = new URL('/realtime', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let disconnect: (() => void) | undefined;
    // Defer creation so React Strict Mode can clean its probe effect before any socket opens.
    const start = setTimeout(() => {
      disconnect = connectRealtime(url.toString(), tenantId, {
        status: setStatus,
        changed: (ids) => callbacks.current.changed(ids),
        resync: () => callbacks.current.resync(),
        denied: () => callbacks.current.denied(),
      });
    }, 0);
    return () => {
      clearTimeout(start);
      disconnect?.();
    };
  }, [tenantId]);
  return status;
}
