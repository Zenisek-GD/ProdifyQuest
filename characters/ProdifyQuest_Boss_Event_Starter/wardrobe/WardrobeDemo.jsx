import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import useLocalWardrobe from './useLocalWardrobe';
import WardrobeScreen from './WardrobeScreen';
function Content() {
  const store = useLocalWardrobe();
  if (store.loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /><Text>Loading your wardrobe…</Text></View>;
  if (store.error || !store.profile) return <View style={{ padding: 30 }}><Text>{store.error}</Text><Pressable accessibilityRole="button" onPress={store.retryLoad} style={{ padding: 16 }}><Text>Retry loading</Text></Pressable><Pressable accessibilityRole="button" onPress={store.reset} style={{ padding: 16 }}><Text>Start a new demo (replaces local wardrobe)</Text></Pressable></View>;
  return <WardrobeScreen profile={store.profile} onCommit={store.commit} saveStatus={store.saveStatus} onRetrySave={store.retrySave} demo />;
}
export default function WardrobeDemo() {
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#fbf9ff' }}><Content /></SafeAreaView></SafeAreaProvider>;
}
