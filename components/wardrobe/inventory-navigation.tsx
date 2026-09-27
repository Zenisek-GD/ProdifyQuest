import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { colors } from '@/components/quest-ui';

const sections = [
  { id: 'characters', label: 'Characters', icon: 'wizard-hat', path: '/(tabs)/cards' },
  { id: 'gear', label: 'Gear', icon: 'sword', path: '/(tabs)/cards/gear' },
  { id: 'looks', label: 'Looks', icon: 'palette-outline', path: '/(tabs)/cards/looks' },
  { id: 'chests', label: 'Chests', icon: 'treasure-chest', path: '/(tabs)/cards/chests' },
] as const;

export function InventoryNavigation({ active }: { active: typeof sections[number]['id'] }) {
  return <View style={{ flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderColor: colors.border }}>
    {sections.map(section => <Pressable key={section.id} accessibilityRole="tab" accessibilityState={{ selected: active === section.id }} accessibilityLabel={section.label} onPress={() => { if (active !== section.id) router.replace(section.path); }} style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderColor: active === section.id ? colors.purple : 'transparent' }}>
      <MaterialCommunityIcons name={section.icon} size={23} color={active === section.id ? colors.purple : colors.muted} />
      <Text style={{ color: active === section.id ? colors.purple : colors.muted, fontSize: 12, fontWeight: active === section.id ? '700' : '500' }}>{section.label}</Text>
    </Pressable>)}
  </View>;
}
