import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage } from '@/scripts/api';
import type { Raid, RaidResponse } from '@/scripts/battle-types';
import { canAcceptRaidUpdate, type RaidUpdateOptions } from './raid-state';

export function useGuildRaid(guildId: string) {
  const [data, setData] = useState<RaidResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef<RaidResponse | null>(null);
  const sequence = useRef(0);
  const alive = useRef(true);
  const accept = useCallback((update: RaidResponse | { raid: Raid }, options: RaidUpdateOptions = {}) => {
    if (!alive.current || !canAcceptRaidUpdate(latest.current?.raid || null, update.raid, options)) return false;
    sequence.current++;
    if ('serverTime' in update) latest.current = update;
    else if (latest.current) latest.current = { ...latest.current, raid: update.raid };
    setData(latest.current); setError('');
    return true;
  }, []);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await api.get<RaidResponse>(`/guilds/${guildId}/raid`);
      if (alive.current && request === sequence.current) accept(response.data, { authoritative: true });
    } catch (err) { if (alive.current && request === sequence.current) setError(errorMessage(err)); }
    finally { if (alive.current) setLoading(false); }
  }, [accept, guildId]);
  useFocusEffect(useCallback(() => {
    alive.current = true;
    void reload();
    const timer = setInterval(() => { void reload(); }, 5000);
    return () => { alive.current = false; sequence.current++; clearInterval(timer); };
  }, [reload]));
  return { data, error, loading, reload, accept, latest };
}
