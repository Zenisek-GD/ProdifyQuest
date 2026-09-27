import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDemoProfile, restoreProfile } from './wardrobeRules';
const KEY = 'prodifyquest:wardrobe-demo:v1';
export default function useLocalWardrobe() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('Saved on this device');
  const current = useRef(null), writes = useRef(Promise.resolve()), sequence = useRef(0), mounted = useRef(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const next = raw == null ? createDemoProfile() : restoreProfile(JSON.parse(raw));
      if (mounted.current) { current.current = next; setProfile(next); }
    } catch { if (mounted.current) setError('Could not load the saved wardrobe. Retry, or start a new demo.'); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);
  const commit = useCallback(update => {
    const next = typeof update === 'function' ? update(current.current) : update;
    const serialized = JSON.stringify(next); // Do not publish unserializable state.
    current.current = next; setProfile(next); setError(null); setSaveStatus('Saving…');
    const revision = ++sequence.current;
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(KEY, serialized));
    writes.current.then(() => { if (mounted.current && revision === sequence.current) setSaveStatus('Saved on this device'); }, () => { if (mounted.current && revision === sequence.current) setSaveStatus('Save failed — tap Retry save'); });
    return next;
  }, []);
  return { profile, loading, error, saveStatus, commit, retryLoad: load, retrySave: () => commit(current.current), reset: () => commit(createDemoProfile()) };
}
