'use client';
import { useEffect, useState } from 'react';
import { api } from './inbox';
export function useRemote<T>(url: string, revision = 0, keepPrevious = false) {
  const key = `${url}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    url?: string;
    data?: T;
    error?: Error;
  }>({
    key: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    if (url)
      api<T>(url, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) setState({ key, url, data });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              key,
              url,
              error:
                error instanceof Error
                  ? error
                  : new Error('Serviço indisponível.'),
            });
        });
    return () => controller.abort();
  }, [url, key]);
  return state.key === key
    ? state
    : keepPrevious && state.url === url && state.data
      ? { key, data: state.data }
      : { key };
}
