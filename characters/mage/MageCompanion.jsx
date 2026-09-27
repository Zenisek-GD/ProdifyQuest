import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ANIMATIONS, SHEET, advancePlayback, createPlayback, getPose, setRestingState, startActions } from './magePlayback';

// Keep this literal path: Metro must be able to discover the asset at build time.
const MAGE_SHEET = require('./assets/apprentice-mage-spritesheet.png');

/**
 * Expo Go-compatible companion, using React Native core components only.
 *
 * Props: restingState='idle'|'study', width=320, active=true,
 *        style, onAnimationEnd(action), onError(message).
 * Ref:   play('wave'|'celebrate'|'cast'),
 *        play(['celebrate', 'cast']), stop().
 */
const MageCompanion = forwardRef(function MageCompanion(
  { restingState = 'idle', width = 320, active = true, style, onAnimationEnd, onError },
  ref,
) {
  const playback = useRef(createPlayback(restingState));
  const renderedPose = useRef(getPose(playback.current));
  const [pose, setPose] = useState(renderedPose.current);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  const [reducedMotion, setReducedMotion] = useState(null);
  const reducedMotionRef = useRef(null);
  const finishedRef = useRef(onAnimationEnd);
  const errorRef = useRef(onError);
  finishedRef.current = onAnimationEnd;
  errorRef.current = onError;

  const publish = useCallback(() => {
    const next = getPose(playback.current);
    if (next.animation !== renderedPose.current.animation || next.frame !== renderedPose.current.frame) {
      renderedPose.current = next;
      setPose(next);
    }
  }, []);

  const stop = useCallback(() => {
    playback.current = createPlayback(playback.current.restingState);
    publish();
  }, [publish]);

  const play = useCallback(actionOrSequence => {
    // A static companion respects the device's reduced-motion preference.
    if (reducedMotionRef.current === true) return;
    playback.current = startActions(playback.current, actionOrSequence);
    publish();
  }, [publish]);

  useImperativeHandle(ref, () => ({ play, stop }), [play, stop]);

  useEffect(() => {
    playback.current = setRestingState(playback.current, restingState);
    publish();
  }, [restingState, publish]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    function applyPreference(value) {
      if (!mounted) return;
      reducedMotionRef.current = value;
      setReducedMotion(value);
      if (value) stop();
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceChanged = true;
      applyPreference(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (!preferenceChanged) applyPreference(value); })
      .catch(() => { if (!preferenceChanged) applyPreference(false); });
    return () => { mounted = false; subscription.remove(); };
  }, [stop]);

  useEffect(() => {
    if (!ready || error || !active || !foreground || reducedMotion !== false) return;
    let animationFrame;
    let lastTime;
    let running = true;
    const tick = now => {
      if (!running) return;
      if (lastTime !== undefined) {
        // Long JS stalls slow the animation slightly instead of skipping whole actions.
        const result = advancePlayback(playback.current, Math.min(now - lastTime, 100));
        playback.current = result.playback;
        publish();
        for (const action of result.completed) finishedRef.current?.(action);
      }
      lastTime = now;
      if (running) animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animationFrame); };
  }, [ready, error, active, foreground, reducedMotion, publish]);

  const frameWidth = Number.isFinite(width) && width > 0 ? width : 320;
  const scale = frameWidth / SHEET.frameWidth;
  const frameHeight = SHEET.frameHeight * scale;
  const row = ANIMATIONS[pose.animation].row;

  return (
    <Pressable
      onPress={() => play('wave')}
      disabled={!active || reducedMotion === true || Boolean(error)}
      accessibilityRole={reducedMotion ? 'image' : 'button'}
      accessibilityLabel="Apprentice Mage companion"
      accessibilityHint={reducedMotion ? undefined : 'Plays a greeting animation'}
      style={[style, { width: frameWidth, height: frameHeight }]}
    >
      <View collapsable={false} style={[styles.viewport, { width: frameWidth, height: frameHeight }]}>
        <Image
          source={MAGE_SHEET}
          accessible={false}
          resizeMode="stretch"
          resizeMethod="scale"
          fadeDuration={0}
          onLoad={() => { setReady(true); setError(null); }}
          onError={event => {
            const message = event.nativeEvent.error || 'The companion image could not load.';
            setReady(false);
            setError(message);
            errorRef.current?.(message);
          }}
          style={{
            position: 'absolute',
            width: frameWidth * SHEET.columns,
            height: frameHeight * SHEET.rows,
            left: -pose.frame * frameWidth,
            top: -row * frameHeight,
            opacity: ready ? 1 : 0,
          }}
        />
        {!ready && <View style={styles.message}><Text style={styles.messageText}>{error ? 'Companion image could not load.' : 'Loading your companion…'}</Text></View>}
      </View>
    </Pressable>
  );
});

export default MageCompanion;

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  message: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20 },
  messageText: { color: '#766b85', textAlign: 'center' },
});
