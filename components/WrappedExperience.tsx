import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { nativePalette } from '@/constants/colors';
import { useLocation } from '@/context/LocationContext';
import { useColors } from '@/hooks/useColors';
import { generateDemoWrapped, generateWrapped, type WrappedCard, type WrappedTheme } from '@/services/wrappedGenerator';
import { buildShareContent, buildShareSvg, shouldKeepSharePreview, type ShareCardContent } from '@/services/shareContent';
import WrappedShareCard, { type WrappedShareCardHandle } from '@/components/WrappedShareCard';

type StoryMode = 'real' | 'demo';
type Theme = { gradient: readonly [string, string, string]; foreground: string; accent: string; muted: string };

const themes: Record<WrappedTheme, Theme> = {
  purple: { gradient: [nativePalette.purple, '#48209A', '#1C123A'], foreground: nativePalette.white, accent: nativePalette.lime, muted: '#D9C8FF' },
  lime: { gradient: [nativePalette.lime, '#B9EC59', '#79AC30'], foreground: nativePalette.blueInk, accent: nativePalette.purple, muted: '#344D20' },
  orange: { gradient: [nativePalette.orange, '#DC5732', '#842F40'], foreground: nativePalette.white, accent: nativePalette.lime, muted: '#FFE5D3' },
  blue: { gradient: ['#253D63', '#192645', nativePalette.ink], foreground: nativePalette.white, accent: nativePalette.lime, muted: '#C4D0E8' },
};

const totalCards = 10;

async function renderWebPng(content: ShareCardContent): Promise<Blob> {
  const svgBlob = new Blob([buildShareSvg(content)], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The share preview could not be rendered. Try again.'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The PNG image could not be created. Try again.');
    return png;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function downloadWebPng(blob: Blob, kind: ShareCardContent['kind']) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `location-wrapped-${kind}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Eyebrow({ children, color }: { children: React.ReactNode; color: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

function Heatmap({ card, theme }: { card: WrappedCard; theme: Theme }) {
  const heat = card.heat ?? [];
  return (
    <View style={styles.heatFrame}>
      <View style={[styles.heatGrid, { borderColor: `${theme.foreground}33` }]}>
        {[0.25, 0.5, 0.75].map(n => (
          <React.Fragment key={n}>
            <View style={[styles.gridVertical, { left: `${n * 100}%`, backgroundColor: `${theme.foreground}20` }]} />
            <View style={[styles.gridHorizontal, { top: `${n * 100}%`, backgroundColor: `${theme.foreground}20` }]} />
          </React.Fragment>
        ))}
        {heat.map(spot => (
          <View key={spot.id} style={[styles.heatHalo, {
            left: `${Math.max(0, Math.min(1, spot.x)) * 100}%`,
            top: `${Math.max(0, Math.min(1, spot.y)) * 100}%`,
            backgroundColor: theme.accent,
            opacity: 0.18 + spot.intensity * 0.38,
            transform: [{ scale: 0.65 + spot.intensity * 0.9 }],
          }]}>
            <View style={[styles.heatCore, { backgroundColor: theme.accent }]} />
          </View>
        ))}
        {heat.length === 0 ? <Text style={[styles.heatEmpty, { color: theme.muted }]}>YOUR MAP BEGINS HERE</Text> : null}
      </View>
      <View style={styles.legend}><View style={[styles.legendDot, { backgroundColor: theme.accent }]} /><Text style={[styles.legendText, { color: theme.muted }]}>Observed places · more visits glow brighter</Text></View>
    </View>
  );
}

function TopPlaces({ card, theme }: { card: WrappedCard; theme: Theme }) {
  const spots = card.spots ?? [];
  return (
    <View style={styles.topList}>
      {spots.map((spot, i) => (
        <View key={spot.id} style={[styles.topRow, { borderBottomColor: `${theme.foreground}35` }]}>
          <Text style={[styles.topRank, { color: theme.accent }]}>{String(i + 1).padStart(2, '0')}</Text>
          <View style={styles.topNameBox}>
            <Text numberOfLines={1} style={[styles.topName, { color: theme.foreground }]}>{spot.name}</Text>
            <Text style={[styles.topDetail, { color: theme.muted }]}>{spot.visits} {spot.visits === 1 ? 'visit' : 'visits'}  ·  {spot.duration}</Text>
          </View>
        </View>
      ))}
      {spots.length === 0 ? <Text style={[styles.emptyTop, { color: theme.muted }]}>Your favorite places will find their way here.</Text> : null}
    </View>
  );
}

export default function WrappedExperience() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state } = useLocation();
  const { play } = useLocalSearchParams<{ play?: string }>();
  const [storyMode, setStoryMode] = useState<StoryMode | null>(null);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sharePreview, setSharePreview] = useState<ShareCardContent | null>(null);
  const [shareSource, setShareSource] = useState<WrappedCard | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const transition = useRef(new Animated.Value(1)).current;
  const shareCardRef = useRef<WrappedShareCardHandle>(null);
  const shifting = useRef(false);
  const firstPlay = useRef(false);
  const modeRef = useRef<StoryMode | null>(null);
  const indexRef = useRef(0);

  const realCards = useMemo(() => generateWrapped(state.statistics, state.places, state.visits), [state.statistics, state.places, state.visits]);
  const demoCards = useMemo(() => generateDemoWrapped(), []);
  const cards = storyMode === 'demo' ? demoCards : realCards;
  const card = cards[index] ?? cards[0];
  const theme = themes[card.theme];
  const isDemo = storyMode === 'demo';
  const hasVisits = state.visits.length > 0;

  const openSharePreview = useCallback(() => {
    const content = buildShareContent(card, isDemo ? 'demo' : 'real');
    if (!content) return;
    setShareError('');
    setSharePreview(content);
    setShareSource(card);
  }, [card, isDemo]);

  const saveShareImage = useCallback(async () => {
    if (!sharePreview || shareBusy) return;
    setShareBusy(true);
    setShareError('');
    try {
      if (Platform.OS === 'web') {
        downloadWebPng(await renderWebPng(sharePreview), sharePreview.kind);
        return;
      }
      const uri = await shareCardRef.current?.capture();
      if (!uri) throw new Error('The share-card preview is not ready yet. Try again.');
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) throw new Error('Photo access was not allowed. You can enable it in Settings and try again.');
      await MediaLibrary.Asset.create(uri);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'The image could not be saved. Try again.');
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, sharePreview]);

  const shareImage = useCallback(async () => {
    if (!sharePreview || shareBusy) return;
    setShareBusy(true);
    setShareError('');
    try {
      if (Platform.OS === 'web') {
        const png = await renderWebPng(sharePreview);
        const navigatorWithFiles = navigator as Navigator & {
          canShare?: (data: { files: File[] }) => boolean;
          share?: (data: ShareData) => Promise<void>;
        };
        const file = new File([png], `location-wrapped-${sharePreview.kind}.png`, { type: 'image/png' });
        if (navigatorWithFiles.share && navigatorWithFiles.canShare?.({ files: [file] })) {
          await navigatorWithFiles.share({ files: [file], title: sharePreview.title });
        } else {
          downloadWebPng(png, sharePreview.kind);
          setShareError('Image sharing is not available here, so the PNG was downloaded instead.');
        }
        return;
      }
      const uri = await shareCardRef.current?.capture();
      if (!uri) throw new Error('The share-card preview is not ready yet. Try again.');
      const Sharing = await import('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) throw new Error('Image sharing is not available on this device.');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your Wrapped', UTI: 'public.png' });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'The share sheet could not be opened. Try again.');
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, sharePreview]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const start = useCallback((mode: StoryMode) => {
    transition.stopAnimation();
    transition.setValue(0);
    indexRef.current = 0;
    setIndex(0);
    modeRef.current = mode;
    setStoryMode(mode);
    shifting.current = false;
    Animated.timing(transition, { toValue: 1, duration: reduceMotion ? 0 : 430, useNativeDriver: true }).start();
  }, [reduceMotion, transition]);

  useEffect(() => {
    if (play === '1' && state.ready && !firstPlay.current) {
      firstPlay.current = true;
      if (state.mode === 'demo') start('demo');
      else if (hasVisits) start('real');
      // With no visits, leave the entry visible so the optional sample is an explicit choice.
    }
    if (play !== '1') firstPlay.current = false;
  }, [play, state.ready, state.mode, hasVisits, start]);

  useEffect(() => {
    if (!sharePreview) return;
    const previewMode = sharePreview.sample ? 'demo' : 'real';
    if (!shouldKeepSharePreview(previewMode, storyMode, state.mode, hasVisits, shareSource === card)) {
      setSharePreview(null);
      setShareSource(null);
      setShareError('');
    }
  }, [card, hasVisits, sharePreview, shareSource, state.mode, storyMode]);

  const close = useCallback(() => {
    transition.stopAnimation();
    shifting.current = false;
    modeRef.current = null;
    setStoryMode(null);
  }, [transition]);

  const goTo = useCallback((target: number) => {
    if (shifting.current || modeRef.current === null) return;
    const bounded = Math.max(0, Math.min(totalCards - 1, target));
    if (bounded === indexRef.current) return;
    shifting.current = true;
    const direction = bounded > indexRef.current ? -1 : 1;
    Animated.timing(transition, { toValue: 0, duration: reduceMotion ? 0 : 150, useNativeDriver: true }).start(({ finished }) => {
      if (!finished || modeRef.current === null) { shifting.current = false; return; }
      indexRef.current = bounded;
      setIndex(bounded);
      transition.setValue(0);
      Animated.timing(transition, { toValue: 1, duration: reduceMotion ? 0 : 350, useNativeDriver: true }).start(() => { shifting.current = false; });
    });
    // Direction is retained visually by the entering translation below.
    entryDirection.current = direction;
  }, [reduceMotion, transition]);
  const entryDirection = useRef(-1);
  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const previous = useCallback(() => goTo(indexRef.current - 1), [goTo]);
  const replay = useCallback(() => {
    if (modeRef.current) start(modeRef.current);
  }, [start]);

  const navigation = useRef({ next, previous });
  navigation.current = { next, previous };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < -55) navigation.current.next();
      else if (gesture.dx > 55) navigation.current.previous();
    },
  }), []);

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.entryScroll, { paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 67 : 0) + 32, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 120 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.entryMeta}>
          <View style={[styles.smallMark, { borderColor: colors.lime }]}><Feather name="navigation" color={colors.lime} size={17} /></View>
          <Eyebrow color={colors.lime}>LOCATION WRAPPED  /  YOUR ATLAS</Eyebrow>
        </View>
        <Text style={[styles.entryTitle, { color: colors.foreground }]}>A year,{' \n'}<Text style={{ color: colors.lime }}>in places.</Text></Text>
        <Text style={[styles.entryLead, { color: nativePalette.lede }]}>The routes you took. The places you returned to. A private story drawn from your own moments.</Text>
        <View style={[styles.entryFeature, { borderColor: colors.border, backgroundColor: nativePalette.wrappedCard }]}>
          <View style={styles.orbitOuter}><View style={styles.orbitMiddle}><View style={styles.orbitCenter} /></View></View>
          <View style={styles.featureTop}><Eyebrow color={colors.lime}>01 — 10  /  A PERSONAL STORY</Eyebrow><Feather name="arrow-up-right" color={colors.lime} size={22} /></View>
          <View style={styles.featureBottom}>
            <Text style={[styles.featureTitle, { color: colors.foreground }]}>The places that{'\n'}made your story.</Text>
            <Text style={[styles.featureCopy, { color: nativePalette.teaserCopy }]}>{state.mode === 'demo' ? 'Explore an explicitly sample-only atlas. None of these visits are yours.' : hasVisits ? 'Ten chapters made from your observed history. Only you can see them.' : 'Your own story will appear after your first observed visit.'}</Text>
          </View>
        </View>
        {!state.ready ? (
          <View style={styles.loadingBlock}><View style={[styles.skeleton, { backgroundColor: colors.muted }]} /><View style={[styles.skeletonShort, { backgroundColor: colors.muted }]} /></View>
        ) : state.mode === 'demo' ? (
          <Pressable accessibilityRole="button" testID="button-play-wrapped" onPress={() => start('demo')} style={({ pressed }) => [styles.playButton, { backgroundColor: colors.lime, opacity: pressed ? 0.8 : 1 }]}>
            <Text style={[styles.playText, { color: nativePalette.blueInk }]}>Play demo Wrapped</Text><Feather name="arrow-right" size={21} color={nativePalette.blueInk} />
          </Pressable>
        ) : hasVisits ? (
          <Pressable accessibilityRole="button" testID="button-play-wrapped" onPress={() => start('real')} style={({ pressed }) => [styles.playButton, { backgroundColor: colors.lime, opacity: pressed ? 0.8 : 1 }]}>
            <Text style={[styles.playText, { color: nativePalette.blueInk }]}>Play your Wrapped</Text><Feather name="arrow-right" size={21} color={nativePalette.blueInk} />
          </Pressable>
        ) : (
          <View style={[styles.previewPanel, { borderColor: colors.border }]}>
            <Eyebrow color={colors.lime}>OPTIONAL PREVIEW  /  SAMPLE DATA</Eyebrow>
            <Text style={[styles.previewHeading, { color: colors.foreground }]}>Your atlas is still unfolding.</Text>
            <Text style={[styles.previewText, { color: nativePalette.lede }]}>No observed visits yet. You can preview a demo story without changing your tracking or saved history.</Text>
            <Pressable accessibilityRole="button" testID="button-play-wrapped" onPress={() => start('demo')} style={({ pressed }) => [styles.previewButton, { borderColor: colors.lime, opacity: pressed ? 0.65 : 1 }]}>
              <Text style={[styles.previewButtonText, { color: colors.lime }]}>Play demo preview</Text><Feather name="arrow-right" color={colors.lime} size={18} />
            </Pressable>
          </View>
        )}
        <Text style={[styles.entryFootnote, { color: nativePalette.foregroundQuiet }]}>PRIVATE BY DESIGN  ·  YOUR HISTORY STAYS YOURS</Text>
      </ScrollView>

      <Modal visible={storyMode !== null} animationType="none" presentationStyle="fullScreen" onRequestClose={close} statusBarTranslucent>
        <StatusBar barStyle={theme.foreground === nativePalette.white ? 'light-content' : 'dark-content'} backgroundColor={theme.gradient[0]} />
        <LinearGradient colors={theme.gradient} start={{ x: 0.05, y: 0 }} end={{ x: 0.95, y: 1 }} style={styles.story}>
          <SafeAreaView edges={['top', 'bottom']} style={styles.storySafe}>
            <View style={styles.progressRow}>
              {cards.map((item, number) => (
                <Pressable key={`${item.kind}-${number}`} accessibilityRole="button" accessibilityLabel={`Go to card ${number + 1}`} testID={`button-story-progress-${number}`} onPress={() => goTo(number)} style={[styles.progressTrack, { backgroundColor: `${theme.foreground}55` }]}>
                  <View style={[styles.progressFill, { backgroundColor: theme.foreground, width: number <= index ? '100%' : '0%' }]} />
                </Pressable>
              ))}
            </View>
            <View style={styles.storyHeader}>
              <Eyebrow color={theme.foreground}>{isDemo ? 'LOCATION WRAPPED  /  DEMO STORY' : 'LOCATION WRAPPED  /  YOUR STORY'}</Eyebrow>
              <View style={styles.headerActions}>
                {card.kind === 'summary' || card.kind === 'top' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${card.kind === 'summary' ? 'year summary' : 'top places'} share card`} testID={`button-preview-share-${card.kind}`} hitSlop={10} onPress={openSharePreview} style={styles.shareStoryButton}>
                    <Feather name="share" size={18} color={theme.foreground} />
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Close Wrapped" testID="button-close-wrapped" hitSlop={14} onPress={close} style={styles.closeButton}><Feather name="x" size={24} color={theme.foreground} /></Pressable>
              </View>
            </View>
            <View style={styles.storyMain} {...pan.panHandlers}>
              <Animated.View pointerEvents="none" style={[styles.storyContent, {
                opacity: transition,
                transform: [{ translateX: transition.interpolate({ inputRange: [0, 1], outputRange: [entryDirection.current * -24, 0] }) }, { translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              }]}>
                <View>
                  <Eyebrow color={theme.accent}>{card.kicker}</Eyebrow>
                  <Text testID="text-story-title" style={[styles.storyTitle, { color: theme.foreground }]}>{card.title}</Text>
                </View>
                <View style={styles.storyCenter}>
                  {card.kind === 'heatmap' ? <Heatmap card={card} theme={theme} /> : card.kind === 'top' ? <TopPlaces card={card} theme={theme} /> : (
                    <View style={styles.metricBlock}>
                      <View style={[styles.metricRule, { backgroundColor: theme.accent }]} />
                      <Text adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={3} testID="text-story-metric" style={[styles.storyMetric, { color: theme.foreground }]}>{card.metric}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.storyBottom}>
                  <Text style={[styles.storyCaption, { color: theme.muted }]}>{card.caption}</Text>
                  <Text style={[styles.storyOrdinal, { color: theme.foreground }]}>{String(index + 1).padStart(2, '0')} <Text style={{ opacity: 0.55 }}>/ {String(cards.length).padStart(2, '0')}</Text></Text>
                </View>
              </Animated.View>
              <View style={styles.tapZones}>
                <Pressable accessibilityLabel="Previous card" onPress={previous} style={styles.tapHalf} />
                <Pressable accessibilityLabel="Next card" onPress={next} style={styles.tapHalf} />
              </View>
            </View>
            <View style={[styles.storyFooter, { borderTopColor: `${theme.foreground}40` }]}>
              <Pressable accessibilityRole="button" disabled={index === 0} testID="button-previous-card" onPress={previous} style={[styles.storyNav, { opacity: index === 0 ? 0.4 : 1 }]}><Feather name="arrow-left" size={19} color={theme.foreground} /><Text style={[styles.navText, { color: theme.foreground }]}>Previous</Text></Pressable>
              {index === cards.length - 1 ?
                <Pressable accessibilityRole="button" testID="button-replay-wrapped" onPress={replay} style={styles.storyNav}><Text style={[styles.navText, { color: theme.foreground }]}>Replay</Text><Feather name="rotate-ccw" size={19} color={theme.foreground} /></Pressable> :
                <Pressable accessibilityRole="button" testID="button-next-card" onPress={next} style={styles.storyNav}><Text style={[styles.navText, { color: theme.foreground }]}>Next</Text><Feather name="arrow-right" size={19} color={theme.foreground} /></Pressable>}
            </View>
          </SafeAreaView>
          <View pointerEvents="none" style={[styles.decorCircle, { borderColor: `${theme.accent}55` }]} />
        </LinearGradient>
      </Modal>
      <Modal
        visible={sharePreview !== null}
        animationType={reduceMotion ? 'none' : 'slide'}
        presentationStyle="fullScreen"
        onRequestClose={() => { setSharePreview(null); setShareSource(null); setShareError(''); }}
        statusBarTranslucent
      >
        <View style={[styles.sharePage, { backgroundColor: colors.background }]}>
          <SafeAreaView edges={['top']} style={styles.shareTopSafe}>
            <View style={[styles.shareHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.shareHeading}>
                <Eyebrow color={colors.lime}>WRAPPED  /  SHARE PREVIEW</Eyebrow>
                <Text style={[styles.shareTitle, { color: colors.foreground }]}>{sharePreview?.kind === 'summary' ? 'Year summary' : 'Top places'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" testID="button-close-share-preview" hitSlop={14} onPress={() => { setSharePreview(null); setShareSource(null); setShareError(''); }} style={styles.shareClose}>
                <Feather name="x" size={23} color={colors.foreground} />
              </Pressable>
            </View>
          </SafeAreaView>
          {sharePreview ? (
            <ScrollView contentContainerStyle={[styles.shareContent, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 18) + 24 }]} showsVerticalScrollIndicator={false}>
              <Text style={[styles.sharePrivacyNote, { color: colors.mutedForeground }]}>{sharePreview.sample ? 'Review the image before sharing. This sample card uses fictional demo place names.' : 'Review before sharing: personal place names are hidden as Place 1, Place 2, etc. The card contains no coordinates or addresses.'}</Text>
              <WrappedShareCard ref={shareCardRef} content={sharePreview} />
              <View style={styles.shareActions}>
                <Pressable accessibilityRole="button" testID="button-save-share-image" disabled={shareBusy} onPress={saveShareImage} style={({ pressed }) => [styles.shareActionPrimary, { backgroundColor: colors.lime, opacity: shareBusy ? 0.55 : pressed ? 0.82 : 1 }]}>
                  <Feather name="download" size={18} color={nativePalette.blueInk} />
                  <Text style={styles.shareActionPrimaryText}>{shareBusy ? 'Preparing image…' : Platform.OS === 'web' ? 'Download PNG' : 'Save image to Photos'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID="button-share-image" disabled={shareBusy} onPress={shareImage} style={({ pressed }) => [styles.shareActionSecondary, { borderColor: colors.border, opacity: shareBusy ? 0.55 : pressed ? 0.72 : 1 }]}>
                  <Feather name="share" size={17} color={colors.foreground} />
                  <Text style={[styles.shareActionSecondaryText, { color: colors.foreground }]}>{shareBusy ? 'Preparing image…' : 'Share image'}</Text>
                </Pressable>
              </View>
              {shareError ? <Text accessibilityRole="alert" testID="status-share-error" style={[styles.shareError, { color: colors.pink }]}>{shareError}</Text> : null}
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  entryScroll: { paddingHorizontal: 25, minHeight: '100%' },
  entryMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 },
  smallMark: { width: 34, height: 34, borderWidth: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.7, lineHeight: 15 },
  entryTitle: { fontSize: 54, lineHeight: 56, letterSpacing: -2.8, fontWeight: '800', marginBottom: 17 },
  entryLead: { fontSize: 16, lineHeight: 25, maxWidth: 330, marginBottom: 33 },
  entryFeature: { height: 300, borderRadius: 23, borderWidth: 1, overflow: 'hidden', padding: 25, justifyContent: 'space-between', marginBottom: 18 },
  featureTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  featureBottom: { zIndex: 2 },
  featureTitle: { fontSize: 29, lineHeight: 32, fontWeight: '800', letterSpacing: -1.15, marginBottom: 11 },
  featureCopy: { fontSize: 13, lineHeight: 20, maxWidth: 290 },
  orbitOuter: { position: 'absolute', width: 280, height: 280, borderRadius: 140, borderWidth: 1, borderColor: nativePalette.purple, right: -74, top: -53, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-26deg' }] },
  orbitMiddle: { width: 206, height: 206, borderRadius: 103, borderWidth: 1, borderColor: nativePalette.pink, alignItems: 'center', justifyContent: 'center' },
  orbitCenter: { width: 119, height: 119, borderRadius: 60, backgroundColor: nativePalette.purple, opacity: 0.52 },
  playButton: { minHeight: 63, borderRadius: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  previewPanel: { padding: 22, borderWidth: 1, borderRadius: 18, marginTop: 2 },
  previewHeading: { fontSize: 21, fontWeight: '800', marginTop: 10, marginBottom: 7, letterSpacing: -0.5 },
  previewText: { fontSize: 13, lineHeight: 20, marginBottom: 20 },
  previewButton: { minHeight: 47, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewButtonText: { fontSize: 14, fontWeight: '800' },
  entryFootnote: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', marginTop: 24 },
  loadingBlock: { gap: 8 }, skeleton: { width: '100%', height: 55, borderRadius: 14 }, skeletonShort: { width: '45%', height: 11, borderRadius: 6 },
  story: { flex: 1, overflow: 'hidden' },
  storySafe: { flex: 1, zIndex: 2, paddingTop: Platform.OS === 'web' ? 67 : 0, paddingBottom: Platform.OS === 'web' ? 34 : 0 },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 18, paddingTop: 10, height: 21 },
  progressTrack: { flex: 1, height: 3, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 3 },
  storyHeader: { minHeight: 62, paddingHorizontal: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareStoryButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  closeButton: { width: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center' },
  storyMain: { flex: 1, minHeight: 0 },
  storyContent: { flex: 1, paddingHorizontal: 30, paddingTop: 25, paddingBottom: 25, justifyContent: 'space-between' },
  storyTitle: { fontSize: 43, lineHeight: 46, fontWeight: '800', letterSpacing: -2, marginTop: 16, maxWidth: 350 },
  storyCenter: { flex: 1, justifyContent: 'center', minHeight: 0 },
  metricBlock: { paddingVertical: 20 },
  metricRule: { width: 43, height: 5, marginBottom: 25, borderRadius: 3 },
  storyMetric: { fontSize: 62, lineHeight: 65, fontWeight: '900', letterSpacing: -3.5 },
  storyBottom: { gap: 23 },
  storyCaption: { fontSize: 16, lineHeight: 24, maxWidth: 310, fontWeight: '500' },
  storyOrdinal: { fontSize: 12, letterSpacing: 2, fontWeight: '800' },
  tapZones: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  tapHalf: { flex: 1 },
  storyFooter: { height: 70, marginHorizontal: 25, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  storyNav: { flexDirection: 'row', gap: 9, alignItems: 'center', minHeight: 48, minWidth: 90 },
  navText: { fontSize: 13, fontWeight: '800' },
  decorCircle: { position: 'absolute', right: -170, top: '28%', width: 340, height: 340, borderWidth: 1, borderRadius: 170 },
  heatFrame: { height: '77%', minHeight: 180, justifyContent: 'center' },
  heatGrid: { flex: 1, borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  gridVertical: { position: 'absolute', width: 1, height: '100%' },
  gridHorizontal: { position: 'absolute', height: 1, width: '100%' },
  heatHalo: { position: 'absolute', width: 48, height: 48, borderRadius: 24, marginLeft: -24, marginTop: -24, alignItems: 'center', justifyContent: 'center' },
  heatCore: { width: 11, height: 11, borderRadius: 6 },
  heatEmpty: { textAlign: 'center', marginTop: '40%', fontSize: 10, letterSpacing: 2, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 14 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, letterSpacing: 0.2 },
  topList: { paddingTop: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 43, borderBottomWidth: 1 },
  topRank: { width: 28, fontSize: 16, fontWeight: '900' },
  topNameBox: { flex: 1 },
  topName: { fontSize: 15, fontWeight: '800' },
  topDetail: { fontSize: 11, marginTop: 3 },
  emptyTop: { fontSize: 15, lineHeight: 23 },
  sharePage: { flex: 1, paddingTop: Platform.OS === 'web' ? 67 : 0, paddingBottom: Platform.OS === 'web' ? 34 : 0 },
  shareTopSafe: { backgroundColor: nativePalette.ink },
  shareHeader: { minHeight: 68, paddingHorizontal: 22, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shareHeading: { gap: 2 },
  shareTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.4 },
  shareClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  shareContent: { paddingHorizontal: 20, paddingTop: 16, gap: 15 },
  sharePrivacyNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  shareActions: { gap: 9, marginTop: 2 },
  shareActionPrimary: { minHeight: 52, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  shareActionPrimaryText: { color: nativePalette.blueInk, fontFamily: 'Inter_700Bold', fontSize: 14 },
  shareActionSecondary: { minHeight: 50, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  shareActionSecondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  shareError: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});