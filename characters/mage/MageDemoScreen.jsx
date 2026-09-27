import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MageCompanion from './MageCompanion';

// Standalone visual test screen. The buttons do not save tasks or award rewards.
export default function MageDemoScreen() {
  const mage = useRef(null);
  const [focusing, setFocusing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('Tap the Mage to say hello.');
  const { width } = useWindowDimensions();

  function action(value) {
    setPaused(false);
    mage.current?.play(value);
  }

  const buttons = [
    ['Wave', () => action('wave')],
    [focusing ? 'Stop study' : 'Start study', () => { setFocusing(value => !value); setPaused(false); }],
    ['Celebrate', () => action('celebrate')],
    ['Cast spell', () => action('cast')],
    ['Celebrate + cast', () => action(['celebrate', 'cast'])],
    [paused ? 'Resume' : 'Pause', () => setPaused(value => !value)],
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>PRODIFYQUEST</Text>
      <Text style={styles.title}>Meet your Mage.</Text>
      <Text style={styles.subtitle}>Try each companion action in Expo Go.</Text>
      <View style={styles.stage}>
        <Text style={styles.badge}>{paused ? 'Paused' : focusing ? 'Study mode' : 'Ready for a quest'}</Text>
        <MageCompanion
          ref={mage}
          width={Math.min(368, Math.max(180, width - 48))}
          restingState={focusing ? 'study' : 'idle'}
          active={!paused}
          onAnimationEnd={name => setStatus(`${name} finished.`)}
          onError={setStatus}
        />
      </View>
      <View style={styles.buttons}>
        {buttons.map(([label, onPress]) => (
          <Pressable key={label} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
      <Text style={styles.note}>These controls preview animations. Connect task completion and guild contributions after testing. A device with Reduce Motion enabled shows a static companion.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8f5ff' },
  content: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 48, alignItems: 'center' },
  brand: { alignSelf: 'flex-start', color: '#7951d4', fontWeight: '800', fontSize: 12, letterSpacing: 2 },
  title: { alignSelf: 'flex-start', color: '#282236', fontSize: 32, fontWeight: '800', marginTop: 10 },
  subtitle: { alignSelf: 'flex-start', color: '#7d718b', marginTop: 10, marginBottom: 24, lineHeight: 22 },
  stage: { width: '100%', borderRadius: 24, backgroundColor: '#eee7ff', alignItems: 'center', paddingVertical: 20, overflow: 'hidden' },
  badge: { color: '#7951d4', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  buttons: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', marginTop: 18 },
  button: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: '#7951d4', marginRight: 8, marginBottom: 8 },
  pressed: { opacity: 0.75 },
  buttonText: { color: '#fff', fontWeight: '700' },
  status: { alignSelf: 'flex-start', color: '#584a68', marginTop: 14 },
  note: { color: '#8e809d', fontSize: 12, lineHeight: 19, marginTop: 16 },
});
