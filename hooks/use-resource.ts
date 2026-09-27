import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage } from '@/scripts/api';

export function useResource<T>(url: string | null, interval?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    if (!url) { setLoading(false); return; }
    const request = ++sequence.current;
    try {
      const response = await api.get<T>(url);
      if (request === sequence.current) { setData(response.data); setError(''); }
    } catch (err) { if (request === sequence.current) setError(errorMessage(err)); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [url]);
  useFocusEffect(useCallback(() => {
    setLoading(true);
    setData(null);
    setError('');
    void reload();
    const timer = interval ? setInterval(() => { void reload(); }, interval) : null;
    return () => { sequence.current++; if (timer) clearInterval(timer); };
  }, [reload, interval]));
  return { data, loading, error, reload };
}
