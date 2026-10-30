import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../api/client';

/** GET helper returning { data, loading, error, reload }. Keeps the last good data while reloading. */
export function useApi(url, { params, enabled = true, refreshMs } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const key = JSON.stringify([url, params]);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!enabled || !url) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await client.get(url, { params });
      if (alive.current) setState({ data: res.data, loading: false, error: null });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return { ...state, reload: load };
}

export function errorText(err, fallback = 'Something went wrong') {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d?.message) return `${d.message}${d.constraints ? ': ' + d.constraints.map((c) => c.text).join(' ') : ''}`;
  return err?.message || fallback;
}
