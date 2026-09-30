import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { nativePalette } from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
import type { ShareCardContent } from '@/services/shareContent';

export type WrappedShareCardHandle = { capture: () => Promise<string> };

const WrappedShareCard = forwardRef<WrappedShareCardHandle, { content: ShareCardContent }>(function WrappedShareCard({ content }, ref) {
  const colors = useColors();
  const shot = useRef<ViewShotRef | null>(null);
  useImperativeHandle(ref, () => ({
    capture: () => {
      if (!shot.current) return Promise.reject(new Error('The share-card preview is not ready yet.'));
      return shot.current.capture();
    },
  }), []);

  return (
    <ViewShot ref={shot} style={styles.captureFrame} options={{ format: 'png', quality: 1 }}>
      <View style={[styles.card, { backgroundColor: nativePalette.ink, borderColor: colors.border }]}>
        <View style={styles.orbitOuter}><View style={styles.orbitInner} /></View>
        <Text style={[styles.label, { color: colors.lime }]}>{content.label}</Text>
        <Text style={styles.brand}>LOCATION WRAPPED<Text style={{ color: colors.lime }}>.</Text></Text>
        <View style={styles.main}>
          <Text style={[styles.title, content.kind === 'top' && styles.topTitle]}>{content.title}</Text>
          <Text style={[styles.metric, { color: colors.lime }]}>{content.metric}</Text>
          {content.kind === 'top' ? (
            <View style={styles.placeList}>
              {content.places.map(place => (
                <View key={place.rank} style={[styles.placeRow, { borderBottomColor: `${colors.foreground}30` }]}>
                  <Text style={[styles.rank, { color: colors.lime }]}>{String(place.rank).padStart(2, '0')}</Text>
                  <View style={styles.placeText}>
                    <Text numberOfLines={1} style={styles.placeName}>{place.name}</Text>
                    <Text style={[styles.placeMeta, { color: colors.mutedForeground }]}>
                      {place.visits} {place.visits === 1 ? 'visit' : 'visits'}{place.duration ? `  ·  ${place.duration}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.summaryRule, { backgroundColor: colors.pink }]} />
          )}
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>{content.caption}</Text>
        </View>
        <View style={[styles.foot, { borderTopColor: `${colors.foreground}30` }]}>
          <Text style={[styles.footText, { color: colors.foreground }]}>PRIVATE BY DESIGN</Text>
          <Text style={[styles.footText, { color: colors.lime }]}>{content.sample ? 'SAMPLE STORY' : 'YOUR STORY'}</Text>
        </View>
      </View>
    </ViewShot>
  );
});

export default WrappedShareCard;

const styles = StyleSheet.create({
  captureFrame: { width: '100%', aspectRatio: 0.8, borderRadius: 18, overflow: 'hidden' },
  card: { flex: 1, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 25, paddingTop: 23, paddingBottom: 18, overflow: 'hidden' },
  orbitOuter: { position: 'absolute', right: -92, top: -124, width: 230, height: 230, borderRadius: 115, borderWidth: 1, borderColor: `${nativePalette.pink}70`, alignItems: 'center', justifyContent: 'center' },
  orbitInner: { width: 166, height: 166, borderRadius: 83, borderWidth: 1, borderColor: `${nativePalette.lime}70` },
  label: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.5 },
  brand: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.45, marginTop: 8 },
  main: { flex: 1, justifyContent: 'center', paddingTop: 16 },
  title: { maxWidth: 320, color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 33, lineHeight: 36, letterSpacing: -1.15 },
  topTitle: { fontSize: 28, lineHeight: 32 },
  metric: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 34, letterSpacing: -0.5, marginTop: 15, marginBottom: 10 },
  summaryRule: { width: 42, height: 4, borderRadius: 2, marginTop: 20 },
  placeList: { marginTop: 6 },
  placeRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5 },
  rank: { width: 24, fontFamily: 'Inter_700Bold', fontSize: 13 },
  placeText: { flex: 1 },
  placeName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  placeMeta: { fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 2 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 21 },
  foot: { minHeight: 31, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  footText: { fontFamily: 'Inter_700Bold', fontSize: 7, letterSpacing: 1.25 },
});