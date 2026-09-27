import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CompanionScene } from '@/components/companion-scene';
import type { MageHandle } from '@/components/mage/MageCompanion';
import { colors } from '@/components/quest-theme';
import { useAuth } from '@/context/auth';
import type { Companion } from '@/scripts/companion-types';
import { useCompanion } from '@/context/companion';

function StatBar({ label, value, maximum, unit, color }: { label: string; value: number; maximum: number; unit: string; color: string }) {
  const max = Math.max(1, maximum);
  const current = Math.min(max, Math.max(0, value));
  return <View style={s.barRow}>
    <Text style={s.label}>{unit}</Text>
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={current} aria-valuetext={`${current} of ${max} ${unit}`} style={s.track}>
      <View style={{ height: '100%', width: `${current / max * 100}%`, backgroundColor: color, borderRadius: 5 }} />
    </View>
    <Text style={s.value}>{current}/{max}</Text>
  </View>;
}

export const CompanionStatusHeader = forwardRef<MageHandle, { companion?: Companion; active?: boolean }>(function CompanionStatusHeader({ companion, active = true }, ref) {
  const { user } = useAuth();
  const { data, loading, error, studying, remainingSeconds } = useCompanion();
  const c = companion || data?.companion || user?.companion;
  const xp = c?.xpIntoLevel ?? 0;
  const remaining = c?.xpToNextLevel ?? 100;
  const focus = data?.focus;
  const time = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  const activity = studying ? `Studying · ${time}` : focus?.status === 'paused' && remainingSeconds > 0 ? `Focus paused · ${time}`
    : (focus?.status === 'running' || focus?.status === 'paused') && remainingSeconds === 0 ? 'Focus complete'
      : loading && !data ? 'Syncing companion…' : error && !data ? 'Companion offline' : 'Ready to quest';
  return <View testID="companion-status-header" style={s.container}>
    <View style={s.inner}>
      <View style={s.portrait}><CompanionScene ref={ref} companion={c} thumbnail active={active} studying={studying} /></View>
      <View style={s.stats}>
        <View style={s.titleRow}><Text style={s.name} numberOfLines={1}>{c?.nickname || 'Apprentice Mage'}</Text><Text style={s.level}>Lv. {c?.level ?? 1}</Text></View>
        <Text testID="companion-focus-status" style={[s.activity, studying && { color: colors.purple }]}>{activity}</Text>
        <StatBar label="Companion health" value={c?.health ?? 100} maximum={c?.maxHealth ?? 100} unit="HP" color={colors.green} />
        <StatBar label="Companion XP" value={xp} maximum={xp + remaining} unit="XP" color={colors.purple} />
      </View>
    </View>
  </View>;
});

const s = StyleSheet.create({
  container: { backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: colors.border, flexShrink: 0 },
  inner: { width: '100%', maxWidth: 1000, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 6 },
  portrait: { width: 102, flexShrink: 0 },
  stats: { flex: 1, minWidth: 0, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '800', flex: 1 },
  level: { color: colors.purple, fontSize: 12, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: colors.muted, fontSize: 10, fontWeight: '600', width: 18 },
  value: { color: colors.ink, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'], width: 48, textAlign: 'right' },
  track: { height: 6, flex: 1, borderRadius: 5, backgroundColor: colors.pale, overflow: 'hidden' },
  activity: { color: colors.muted, fontSize: 11, fontWeight: '600' },
});
