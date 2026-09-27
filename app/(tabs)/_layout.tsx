import { Redirect, Slot, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import BottomNavigation from '@/components/BottomNavigation';
import { colors } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { CompanionProvider } from '@/context/companion';
import { BattlePresentationProvider } from '@/context/battle-presentation';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const params = useLocalSearchParams<{ invite?: string }>();
  const invite = typeof params.invite === 'string' && /^[a-zA-Z0-9]{1,24}$/.test(params.invite) ? params.invite : undefined;
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.purple} /></View>;
  if (!user) return <Redirect href={{ pathname: '/auth/login', params: invite ? { invite } : {} }} />;
  return <CompanionProvider key={user.id}><BattlePresentationProvider><View style={{ flex: 1, backgroundColor: colors.canvas }}><View style={{ flex: 1 }}><Slot /></View><BottomNavigation /></View></BattlePresentationProvider></CompanionProvider>;
}
