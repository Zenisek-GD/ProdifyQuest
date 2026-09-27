import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/auth';
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#6242cf" /></View>;
  return <Redirect href={user ? '/(tabs)/home' : '/auth/login'} />;
}