import { useEffect, useRef, useState } from 'react';

export function useInterval(callback, delayMs) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);
  useEffect(() => {
    if (delayMs == null) return undefined;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

export function useDebounce(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useNow(tickMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), tickMs);
  return now;
}
