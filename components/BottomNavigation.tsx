import { MaterialIcons } from '@expo/vector-icons';
import { Href, router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/components/quest-ui';
import { useBattlePresentation } from '@/context/battle-presentation';

const items: { name: string; icon: React.ComponentProps<typeof MaterialIcons>['name']; path: Href; match: string }[] = [
  { name: 'Home', icon: 'home', path: '/(tabs)/home', match: '/home' },
  { name: 'Tasks', icon: 'check-circle-outline', path: '/(tabs)/task', match: '/task' },
  { name: 'Inventory', icon: 'inventory-2', path: '/(tabs)/cards', match: '/cards' },
  { name: 'Guilds', icon: 'groups', path: '/(tabs)/guild', match: '/guild' },
  { name: 'Rewards', icon: 'redeem', path: '/(tabs)/reward', match: '/reward' },
  { name: 'Reports', icon: 'bar-chart', path: '/(tabs)/reports', match: '/reports' },
];
export default function BottomNavigation() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { busy } = useBattlePresentation();
  return <View style={{ backgroundColor: '#FFF', borderTopWidth: 1, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 8 }}><View style={{ flexDirection: 'row', maxWidth: 780, width: '100%', alignSelf: 'center' }}>{items.map(item => {
    const selected = pathname === item.match || pathname.startsWith(`${item.match}/`);
    return <Pressable key={item.name} accessibilityRole="tab" accessibilityState={{ selected, disabled: busy }} accessibilityLabel={item.name} disabled={busy} onPress={() => router.replace(item.path)} style={{ flex: 1, paddingVertical: 6, alignItems: 'center', gap: 4, opacity: busy ? 0.5 : 1 }}><View style={{ paddingHorizontal: 13, paddingVertical: 4, borderRadius: 12, backgroundColor: selected ? colors.pale : 'transparent' }}><MaterialIcons name={item.icon} size={22} color={selected ? colors.purple : colors.muted} /></View><Text style={{ fontSize: 10, fontWeight: selected ? '700' : '500', color: selected ? colors.purple : colors.muted }}>{item.name}</Text></Pressable>;
  })}</View></View>;
}

