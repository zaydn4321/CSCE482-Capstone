import React, { useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nativePalette } from '@/constants/colors';
import { useLocation } from '@/context/LocationContext';
import type { Visit } from '@/services/visitProcessor';

type VisitDay = { key: string; title: string; data: Visit[] };

function formatDuration(durationMs: number) {
  const minutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TimelineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state } = useLocation();
  const demo = state.mode === 'demo';
  const placeNames = useMemo(() => new Map(state.places.map((place, index) => [
    place.id,
    place.name?.trim() || `Place ${index + 1}`,
  ])), [state.places]);
  const days = useMemo<VisitDay[]>(() => {
    if (demo) return [];
    const sorted = [...state.visits]
      .filter(visit => Number.isFinite(visit.arrivedAt) && !Number.isNaN(new Date(visit.arrivedAt).getTime()))
      .sort((first, second) => second.arrivedAt - first.arrivedAt || second.id.localeCompare(first.id));
    const grouped = new Map<string, VisitDay>();
    sorted.forEach(visit => {
      const key = dayKey(visit.arrivedAt);
      const group = grouped.get(key);
      if (group) group.data.push(visit);
      else grouped.set(key, { key, title: dayLabel(visit.arrivedAt), data: [visit] });
    });
    return [...grouped.values()];
  }, [demo, state.visits]);

  const header = (
    <View style={styles.intro}>
      <Text style={[styles.eyebrow, { color: colors.lime }]}>{demo ? 'DEMO / SAMPLE TIMELINE' : 'YOUR HISTORY / VISITS'}</Text>
      <Text style={styles.pageTitle}>Your timeline.</Text>
      <Text style={styles.introCopy}>
        {demo
          ? 'Sample places are separate from your personal history. This sample has no dated visit events to show.'
          : 'Every recorded visit, in the order your days unfolded.'}
      </Text>
    </View>
  );

  let emptyState = null;
  if (!state.ready && !demo) {
    emptyState = (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="timeline-loading">
        <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="clock" size={19} color={colors.lime} /></View>
        <Text style={styles.emptyTitle}>Loading your timeline…</Text>
        <Text style={styles.emptyCopy}>Checking your saved visit history.</Text>
      </View>
    );
  } else if (state.error && state.status === 'unavailable' && !demo) {
    emptyState = (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="timeline-unavailable">
        <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="alert-circle" size={19} color={colors.lime} /></View>
        <Text style={styles.emptyTitle}>Your timeline is unavailable.</Text>
        <Text style={styles.emptyCopy}>{state.error}</Text>
      </View>
    );
  } else if (demo) {
    emptyState = (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="timeline-sample-empty">
        <View style={[styles.sampleBadge, { borderColor: `${colors.lime}66` }]}><Text style={[styles.sampleBadgeText, { color: colors.lime }]}>SAMPLE ONLY</Text></View>
        <Text style={styles.emptyTitle}>No sample visits to list.</Text>
        <Text style={styles.emptyCopy}>The demo includes place summaries, but not visit-by-visit dates or durations. No personal visits are shown here.</Text>
      </View>
    );
  } else if (!days.length) {
    emptyState = (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="timeline-empty">
        <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="clock" size={19} color={colors.lime} /></View>
        <Text style={styles.emptyTitle}>No visits yet.</Text>
        <Text style={styles.emptyCopy}>
          {state.records.length
            ? 'Your recorded location points have not formed a visit yet. Visits appear here once they are processed into places.'
            : 'Your recorded visits will appear here, grouped by day, when your history includes a visit.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        <View style={[styles.topbar, { borderBottomColor: colors.border }]}>
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { borderColor: colors.lime }]}>
              <Ionicons name="navigate" size={17} color={colors.lime} />
            </View>
            <Text style={styles.brandName}>location wrapped<Text style={{ color: colors.lime }}>.</Text></Text>
          </View>
          {demo ? <Text style={[styles.demoBadge, { color: colors.lime, borderColor: `${colors.lime}66` }]}>DEMO MODE</Text> : null}
        </View>
      </SafeAreaView>
      <SectionList<Visit, VisitDay>
        sections={days}
        keyExtractor={visit => visit.id}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeading} testID={`timeline-day-${section.key}`}>
            <View style={[styles.dayDot, { backgroundColor: colors.lime }]} />
            <Text style={styles.dayTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item: visit, index, section }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${placeNames.get(visit.placeId) ?? 'Place'}, visited at ${new Date(visit.arrivedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
            testID={`button-timeline-visit-${visit.id}`}
            onPress={() => router.push({ pathname: '/(tabs)/map', params: { place: visit.placeId, visit: visit.id } })}
            style={({ pressed }) => [
              styles.visitRow,
              { backgroundColor: colors.card, borderLeftColor: colors.border, borderRightColor: colors.border },
              index === 0 && [styles.firstVisit, { borderTopColor: colors.border }],
              index === section.data.length - 1 && [styles.lastVisit, { borderBottomColor: colors.border }],
              index < section.data.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.timeRail, { borderColor: colors.border }]}>
              <View style={[styles.visitDot, { backgroundColor: colors.lime }]} />
            </View>
            <View style={styles.visitMain}>
              <Text style={styles.visitTime}>{new Date(visit.arrivedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
              <Text style={styles.placeName}>{placeNames.get(visit.placeId) ?? 'Place'}</Text>
              <Text style={styles.visitDuration}>{formatDuration(visit.durationMs)} · visit</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 94, flexGrow: 1 }]}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
        testID="timeline-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topSafe: { backgroundColor: nativePalette.ink },
  topbar: { minHeight: 57, paddingHorizontal: 19, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { height: 29, width: 29, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 16, letterSpacing: -0.5 },
  demoBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  content: { paddingHorizontal: 18, paddingTop: 23 },
  intro: { marginBottom: 22 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.55 },
  pageTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 40, letterSpacing: -2.2, marginTop: 7 },
  introCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 360 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 21, marginBottom: 10, paddingLeft: 2 },
  sectionSeparator: { height: 1 },
  dayDot: { width: 7, height: 7, borderRadius: 4 },
  dayTitle: { color: nativePalette.foregroundNote, fontFamily: 'Inter_600SemiBold', fontSize: 14, letterSpacing: 0.1 },
  visitRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, borderLeftWidth: 1, borderRightWidth: 1 },
  firstVisit: { borderTopWidth: 1, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  lastVisit: { borderBottomWidth: 1, borderBottomLeftRadius: 15, borderBottomRightRadius: 15 },
  timeRail: { width: 18, height: 49, borderLeftWidth: 1, justifyContent: 'center', marginRight: 13 },
  visitDot: { width: 8, height: 8, borderRadius: 4, marginLeft: -4.5 },
  visitMain: { flex: 1 },
  visitTime: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_500Medium', fontSize: 11, marginBottom: 3 },
  placeName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 16, letterSpacing: -0.35 },
  visitDuration: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 9 },
  emptyIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 17, letterSpacing: -0.3 },
  emptyCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  sampleBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, marginBottom: 2 },
  sampleBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1 },
  pressed: { opacity: 0.76 },
});