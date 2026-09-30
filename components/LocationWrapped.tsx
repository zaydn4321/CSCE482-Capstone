import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  ActivityIndicator,
  type StyleProp,
  type TextStyle,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nativePalette } from '@/constants/colors';
import { useLocation } from '@/context/LocationContext';
import { demoPlaces, demoStatistics, demoWrappedCards } from '@/services/demoData';
import { formatCoordinates } from '@/services/locationProcessing';
import type { ProcessedPlace } from '@/services/visitProcessor';

type Place = (typeof demoPlaces)[number];
type RecordLocation = { lat: number; lng: number; timestamp: number; accuracy?: number };

function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

function Brand({ mode, landing = false }: { mode?: string; landing?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.brandRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Location Wrapped home"
        testID="link-brand"
        onPress={() => router.replace(landing ? '/' : '/(tabs)')}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}
      >
        <View style={[styles.brandMark, { borderColor: colors.lime }]}>
          <Ionicons name="navigate" size={18} color={colors.lime} />
        </View>
        <Text style={styles.brandName}>location wrapped<Text style={{ color: colors.lime }}>.</Text></Text>
      </Pressable>
      {mode === 'demo' ? <Text testID="status-demo-mode" style={[styles.modeBadge, { color: colors.lime, borderColor: `${colors.lime}66` }]}>DEMO MODE</Text> : landing ? <Label style={styles.brandTag}>A LITTLE MORE HERE.</Label> : null}
    </View>
  );
}

function PrimaryButton({
  title,
  onPress,
  testID,
  variant = 'primary',
  disabled,
  icon,
  wide,
}: {
  title: string;
  onPress: () => void;
  testID: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Feather>['name'];
  wide?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        wide && styles.buttonWide,
        variant === 'primary' && { backgroundColor: colors.lime },
        variant === 'secondary' && { backgroundColor: colors.secondary },
        variant === 'outline' && { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 },
        variant === 'danger' && { backgroundColor: colors.pink },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, variant === 'primary' || variant === 'danger' ? { color: colors.background } : { color: colors.foreground }]}>{title}</Text>
      {icon ? <Feather name={icon} size={17} color={variant === 'primary' || variant === 'danger' ? colors.background : colors.foreground} /> : null}
    </Pressable>
  );
}

function Intro({ label, title, description }: { label: string; title: string; description?: string }) {
  const colors = useColors();
  return (
    <View style={styles.intro}>
      <Label style={{ color: colors.lime }}>{label}</Label>
      <Text style={styles.pageTitle}>{title}</Text>
      {description ? <Text style={styles.introCopy}>{description}</Text> : null}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>;
}

function PageFrame({ children, mode }: { children: React.ReactNode; mode: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        <View style={[styles.topbar, { borderBottomColor: colors.border }]}>
          <Brand mode={mode} />
        </View>
      </SafeAreaView>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 18) + 94 }]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function StatusCard() {
  const colors = useColors();
  const { state, openSettings } = useLocation();
  const demo = state.mode === 'demo';
  const active = !demo && state.ready && state.status === 'active';
  const loading = !demo && !state.ready;
  const title = demo ? 'Exploring the demo' : loading ? 'Checking your location history' : active ? 'Tracking is active' : state.status === 'paused' ? 'Tracking is paused' : state.status === 'denied' ? 'Location access denied' : state.status === 'unavailable' ? 'Location is unavailable' : 'Tracking is inactive';
  const subtitle = demo ? 'Sample places, not your location history.' : loading ? 'Loading saved visits and tracking status.' : active ? state.backgroundEnabled ? 'Location updates can continue when the app is in the background.' : 'Your story is taking shape while this app is open.' : state.status === 'paused' ? 'No new locations are being recorded.' : state.status === 'denied' ? 'Location permission is off. You can allow it again in Settings.' : state.status === 'unavailable' ? 'Location services are off. Turn them on in Settings to continue.' : 'Allow location access to begin your story.';
  const last = state.mode === 'real' ? state.records[state.records.length - 1] as RecordLocation | undefined : undefined;
  return (
    <View style={[styles.panel, { backgroundColor: colors.card }]} testID="card-tracking-status">
      <View style={styles.statusTop}>
        <View style={styles.statusLead}>
          {loading ? <ActivityIndicator size="small" color={colors.lime} accessibilityLabel="Loading tracking status" /> : <View accessible={false} style={[styles.statusDot, { backgroundColor: active || demo ? colors.lime : state.status === 'paused' ? colors.orange : colors.mutedForeground }]} />}
          <View style={styles.statusText}>
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.statusTitle} testID="status-tracking">{title}</Text>
            <Text style={styles.bodyMuted}>{subtitle}</Text>
          </View>
        </View>
         <Label style={{ color: demo || active ? colors.lime : colors.mutedForeground }}>{demo ? 'SAMPLE' : state.status === 'active' && !active ? 'CHECKING' : state.status.toUpperCase()}</Label>
      </View>
      <View style={[styles.statusStats, { borderTopColor: colors.border }]}>
        <View style={styles.statusStat}>
          <Text style={styles.smallMuted}>Last location recorded</Text>
          <Text style={styles.statusValue} testID="text-last-location">{demo ? 'Demo only' : last ? 'Recorded' : 'Not yet recorded'}</Text>
        </View>
        <View style={styles.statusStat}>
          <Text style={styles.smallMuted}>Last update</Text>
          <Text style={styles.statusValue} testID="text-last-update">{demo ? 'Not tracking' : prettyTime(state.lastUpdate)}</Text>
        </View>
      </View>
      {!demo && state.error ? <Text accessibilityRole="alert" testID="status-location-error" style={styles.errorText}>{state.error}</Text> : null}
      {!demo && state.ready && state.status === 'paused' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Resume tracking" accessibilityHint="Open tracking controls in Profile." testID="button-resume-from-status" onPress={() => router.push('/(tabs)/profile')} style={styles.textLink}>
          <Text style={{ color: colors.lime, fontWeight: '700' }}>Resume tracking</Text><Feather name="arrow-right" size={16} color={colors.lime} />
        </Pressable>
      ) : !demo && state.ready && state.status === 'denied' && !state.canAskAgain ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open location settings" testID="button-enable-from-status" onPress={() => { void openSettings(); }} style={styles.textLink}>
          <Text style={{ color: colors.lime, fontWeight: '700' }}>Open location Settings</Text><Feather name="arrow-right" size={16} color={colors.lime} />
        </Pressable>
      ) : !demo && state.ready && ['inactive', 'denied', 'unavailable'].includes(state.status) ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Enable location tracking" testID="button-enable-from-status" onPress={() => router.push('/onboarding/3')} style={styles.textLink}>
          <Text style={{ color: colors.lime, fontWeight: '700' }}>Enable location tracking</Text><Feather name="arrow-right" size={16} color={colors.lime} />
        </Pressable>
      ) : null}
    </View>
  );
}

function prettyTime(value: number | null | undefined) {
  if (!value) return 'Not yet recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet recorded' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(value: number) {
  const minutes = Math.max(0, Math.floor(value / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function placeTitle(place: ProcessedPlace, index?: number) {
  return place.name ?? (index === undefined ? formatCoordinates(place.lat, place.lng) : `Place ${index + 1}`);
}

function EmptyCard({ title, children, action }: { title: string; children: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.panel, styles.emptyCard, { backgroundColor: colors.card }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Ionicons name="navigate-outline" size={22} color={colors.lime} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.bodyMuted}>{children}</Text>
      {action}
    </View>
  );
}

function LoadingCard({ title, copy }: { title: string; copy: string }) {
  const colors = useColors();
  return (
    <View style={[styles.panel, styles.loadingCard, { backgroundColor: colors.card }]} accessibilityRole="summary" accessibilityLabel={`${title}. ${copy}`} testID="card-loading">
      <ActivityIndicator color={colors.lime} />
      <View style={styles.loadingCopy}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.bodyMuted}>{copy}</Text>
      </View>
    </View>
  );
}

export function LandingScreen() {
  const colors = useColors();
  const { startDemo } = useLocation();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.landing, { backgroundColor: colors.background }]}>
      <View style={[styles.topbar, { borderBottomColor: colors.border }]}><Brand landing /></View>
      <ScrollView contentContainerStyle={styles.landingScroll} showsVerticalScrollIndicator={false}>
        <Label style={{ color: colors.lime }}>— A PERSONAL ATLAS OF YOUR YEAR</Label>
        <Text style={styles.display}>Your year.{"\n"}Your places.{"\n"}<Text style={{ color: colors.lime }}>Your story.</Text></Text>
        <Text style={styles.lede}>Location Wrapped remembers the places you go and turns your year into a story.</Text>
        <View style={styles.actionStack}>
          <PrimaryButton title="Start My Wrapped" icon="arrow-right" testID="button-start-wrapped" onPress={() => router.push('/onboarding/1')} />
          <PrimaryButton title="Try Demo" icon="chevron-right" variant="secondary" testID="button-try-demo" onPress={() => { startDemo(); router.replace('/(tabs)'); }} />
        </View>
        <View style={styles.artWrap} accessible accessibilityLabel="Every place means something">
          <View style={[styles.orbit, styles.orbitOuter, { borderColor: colors.border }]} />
          <View style={[styles.orbit, styles.orbitMiddle, { borderColor: colors.border }]} />
          <View style={[styles.orbit, styles.orbitInner, { borderColor: colors.border }]} />
          <View style={styles.artDisc}>
            <View style={[styles.artCore, { borderColor: colors.background }]} />
          </View>
          <View style={[styles.artDot, { backgroundColor: colors.lime }]} />
          <View style={[styles.artDot, styles.artDotOrange, { backgroundColor: colors.orange }]} />
          <Label style={styles.artCaption}>EVERY PLACE MEANS SOMETHING</Label>
        </View>
      </ScrollView>
      <View style={[styles.landingFooter, { borderTopColor: colors.border }]}><Label>YOUR PLACES, YOUR PACE.</Label><Label>MADE FOR LOOKING BACK.</Label></View>
    </SafeAreaView>
  );
}

const onboardingCopy = [
  { title: 'Your year starts here', copy: 'Location Wrapped records the places you visit so you can look back on where your year took you.', icon: 'compass-outline' as const },
  { title: 'Built around your privacy', copy: 'Location access is always your choice. Pause tracking whenever you like, or delete your location history in Profile.', icon: 'lock-closed-outline' as const },
  { title: 'Enable Location Tracking', copy: 'Allow foreground location to begin collecting your story from this moment on. After tracking starts, you can optionally opt in to background updates in Profile.', icon: 'location-outline' as const },
];

export function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const step = Math.min(3, Math.max(1, Number(pathname.split('/').filter(Boolean).at(-1)) || 1));
  const content = onboardingCopy[step - 1];
  const nextStepRoute = step === 1 ? '/onboarding/2' : '/onboarding/3';
  const { state, requestAccess, startDemo, openSettings } = useLocation();
  const [pending, setPending] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const denied = state.status === 'denied' || state.status === 'unavailable';
  const mustOpenSettings = state.status === 'denied' && !state.canAskAgain;
  const stepColor = step === 2 ? colors.pink : step === 3 ? colors.primary : colors.lime;

  useEffect(() => {
    if (step === 3 && state.status === 'active' && state.mode === 'real') router.replace('/tracking');
  }, [step, state.status, state.mode]);

  const allow = async () => {
    setPending(true);
    setPermissionError(false);
    try {
      await Promise.resolve(requestAccess());
    } catch {
      setPermissionError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.page, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 24) }]}>
      <View style={[styles.topbar, { borderBottomColor: colors.border }]}><Brand landing /></View>
      <ScrollView contentContainerStyle={styles.onboardScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.onboardVisual}>
          <View style={[styles.visualRing, styles.visualRingOuter, { borderColor: `${stepColor}33` }]} />
          <View style={[styles.visualRing, styles.visualRingInner, { borderColor: `${stepColor}70` }]} />
          <View style={[styles.visualCore, { backgroundColor: stepColor }]}><Ionicons name={content.icon} size={36} color={step === 3 ? colors.foreground : colors.background} /></View>
        </View>
        <Label style={{ color: colors.lime }}>GETTING STARTED / 0{step} OF 03</Label>
        <Text style={styles.onboardTitle}>{content.title}</Text>
        <Text style={styles.onboardCopy}>{content.copy}</Text>
        {step === 2 ? <Text style={styles.note}><Text style={styles.noteStrong}>Good to know: </Text>Foreground location is the default. Background updates are never enabled unless you opt in later, and past trips are not recovered.</Text> : null}
        {step === 3 ? (
          <>
            <Text style={styles.note}><Text style={styles.noteStrong}>Your choice: </Text>Tracking starts with foreground location while the app is open. Afterward, you can separately opt in to background updates in Profile where supported. Past location history is never imported.</Text>
            {!state.ready ? <LoadingCard title="Checking location permission" copy="The permission prompt will be available as soon as your tracking status is loaded." /> : null}
            {state.ready && (denied || permissionError) ? (
              <View style={styles.alert} testID="status-permission-denied">
                <Text accessibilityRole="alert" style={styles.alertText}>{state.status === 'unavailable' ? 'Location is not available on this device. Check that location services are enabled, then try again.' : mustOpenSettings ? 'Location access is off for this app. Open Settings to allow access, then return here.' : 'Location access was not allowed. You can try again, or explore the demo instead.'}</Text>
              </View>
            ) : null}
            {!state.ready ? <View style={styles.loadingCard} testID="status-location-permission-loading"><ActivityIndicator color={colors.lime} /><Text style={styles.bodyMuted}>Checking location permission…</Text></View> : null}
            {mustOpenSettings ? <PrimaryButton title="Open Settings" icon="settings" variant="secondary" testID="button-open-settings" onPress={() => { void openSettings(); }} wide /> : (
              <PrimaryButton title={pending || state.status === 'requesting' ? 'Requesting access…' : denied ? 'Try Location Access Again' : 'Allow Location Access'} icon={pending ? undefined : 'arrow-right'} testID="button-allow-location" disabled={!state.ready || pending || state.status === 'requesting'} onPress={allow} wide />
            )}
            {state.ready && (denied || permissionError) ? <PrimaryButton title="Try Demo" icon="chevron-right" variant="secondary" testID="button-demo-after-denial" onPress={() => { startDemo(); router.replace('/(tabs)'); }} wide /> : null}
          </>
        ) : null}
      </ScrollView>
      <View style={[styles.onboardFooter, { borderTopColor: colors.border }]}>
        <View style={styles.stepBars} accessibilityLabel={`Step ${step} of 3`}>{[1, 2, 3].map(number => <View key={number} style={[styles.stepBar, { backgroundColor: number === step ? colors.lime : colors.border }]} />)}</View>
        {step < 3 ? <PrimaryButton title="Continue" icon="arrow-right" testID="button-onboarding-next" onPress={() => router.push(nextStepRoute)} /> : <PrimaryButton title="Back" icon="arrow-left" variant="outline" testID="button-onboarding-back" onPress={() => router.replace('/onboarding/2')} />}
      </View>
    </SafeAreaView>
  );
}

export function TrackingScreen() {
  const { state } = useLocation();
  return (
    <PageFrame mode={state.mode}>
      <Intro label="A NEW CHAPTER" title="You're tracking" description="Your Location Wrapped starts building from here." />
      <SectionTitle>Your tracking status</SectionTitle>
      <StatusCard />
      <Text style={[styles.note, { marginTop: 24, marginBottom: 20 }]}>{state.backgroundEnabled ? 'Background updates are enabled by your opt-in. You can turn them off any time in Profile.' : 'Foreground tracking records while this app is open. Background updates are optional and can be enabled later in Profile where supported.'}</Text>
      <PrimaryButton title="Go to Home" icon="arrow-right" testID="button-go-home" onPress={() => router.replace('/(tabs)')} />
    </PageFrame>
  );
}

export function HomeScreen() {
  const colors = useColors();
  const { state } = useLocation();
  const demo = state.mode === 'demo';
  return (
    <PageFrame mode={state.mode}>
      <Intro label={demo ? 'DEMO / SAMPLE HISTORY' : 'YOUR STORY / IN PROGRESS'} title={demo ? 'A year in places.' : state.places.length ? 'Your year in places.' : 'Your story starts here.'} description={demo ? 'An example of what your location story could look like.' : state.places.length ? 'The moments you chose to record, told in places.' : 'Every visit starts with a single moment.'} />
      <SectionTitle>Tracking</SectionTitle>
      <StatusCard />
      {!demo && !state.ready ? (
        <LoadingCard title="Loading your history" copy="Checking your saved visits and preparing your dashboard." />
      ) : demo ? (
        <>
          <View style={styles.sectionBlock}>
            <SectionTitle>The little details</SectionTitle>
            <View style={styles.statsCard}>
              <Label style={{ color: colors.lime }}>PLACES IN THIS DEMO</Label>
              <Text style={[styles.heroNumber, { color: colors.lime }]} testID="text-places-visited">{demoStatistics.placesVisited}</Text>
              <Text style={styles.statLabel}>places visited</Text>
              <View style={[styles.statPair, { borderTopColor: colors.border }]}>
                <View style={styles.statHalf}><Label>TIME OUT IN THE WORLD</Label><Text style={styles.statValue} testID="text-days-tracked">{demoStatistics.daysTracked}</Text><Text style={styles.smallMuted}>days tracked</Text></View>
                <View style={styles.statHalf}><Label>DISTANCE COVERED</Label><Text style={styles.statValue} testID="text-distance">{demoStatistics.distanceKm}<Text style={styles.km}> km</Text></Text><Text style={styles.smallMuted}>along the way</Text></View>
              </View>
              <View style={[styles.statLine, { borderBottomColor: colors.border }]}><Label>MOST VISITED</Label><Text style={styles.statLineValue} testID="text-most-visited">{demoStatistics.mostVisitedPlace}</Text></View>
              <View style={[styles.statLine, { borderBottomColor: colors.border }]}><Label>MOST ACTIVE DAY</Label><Text style={styles.statLineValue} testID="text-most-active-day">{demoStatistics.mostActiveDay}</Text></View>
                <View style={styles.statLine}><Label>MOST ACTIVE MONTH</Label><Text style={styles.statLineValue} testID="text-most-active-month">{demoStatistics.mostActiveMonth}</Text></View>
            </View>
          </View>
          <View style={styles.sectionBlock}>
            <SectionTitle>The story so far</SectionTitle>
            <WrappedTeaser demo />
          </View>
        </>
      ) : (
        <>
          <View style={styles.sectionBlock}>
            <SectionTitle>Your year in numbers</SectionTitle>
            <View style={[styles.statsCard, { backgroundColor: colors.card, borderRadius: 18, padding: 20 }]}>
              <Label style={{ color: colors.lime }}>OBSERVED PLACES</Label>
              <Text style={[styles.heroNumber, { color: colors.lime }]} testID="text-places-visited">{state.statistics.uniquePlaces}</Text>
              <Text style={styles.statLabel}>places with recorded visits</Text>
              <View style={[styles.statPair, { borderTopColor: colors.border }]}>
                <View style={styles.statHalf}><Label>DAYS TRACKED</Label><Text style={styles.statValue} testID="text-days-tracked">{state.statistics.daysTracked}</Text><Text style={styles.smallMuted}>days with location points</Text></View>
                <View style={styles.statHalf}><Label>DISTANCE TRAVELED</Label><Text style={styles.statValue} testID="text-distance">{state.statistics.distanceKm.toFixed(1)}<Text style={styles.km}> km</Text></Text><Text style={styles.smallMuted}>observed route</Text></View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={state.statistics.mostVisitedPlace ? `View most visited place, ${placeTitle(state.statistics.mostVisitedPlace)}, ${state.statistics.mostVisitedPlace.visitCount} visits` : 'No visits yet'}
                accessibilityHint={state.statistics.mostVisitedPlace ? 'Opens this place in the map.' : undefined}
                disabled={!state.statistics.mostVisitedPlace}
                testID="button-home-most-visited"
                onPress={() => {
                  const place = state.statistics.mostVisitedPlace;
                  if (place) router.push({ pathname: '/(tabs)/map', params: { place: place.id } });
                }}
                style={[styles.homeFavorite, { backgroundColor: nativePalette.purple }]}
              >
                <Label style={{ color: colors.lime }}>YOUR MOST VISITED PLACE</Label>
                <Text style={styles.homeFavoriteTitle} testID="text-most-visited">{state.statistics.mostVisitedPlace ? placeTitle(state.statistics.mostVisitedPlace) : 'No visits yet'}</Text>
                <Text style={styles.homeFavoriteSub}>{state.statistics.mostVisitedPlace ? `${state.statistics.mostVisitedPlace.visitCount} observed visits · Tap for details` : 'Your first observed visit will appear here.'}</Text>
              </Pressable>
              <View style={[styles.statLine, { borderBottomColor: colors.border }]}><Label>TOTAL VISITS</Label><Text style={styles.statLineValue} testID="text-total-visits">{state.statistics.totalVisits}</Text></View>
              <View style={[styles.statLine, { borderBottomColor: colors.border }]}><Label>MOST TIME</Label><Text style={styles.statLineValue} testID="text-most-time">{state.statistics.mostTimePlace ? placeTitle(state.statistics.mostTimePlace) : 'No visits yet'}</Text></View>
              <View style={[styles.statLine, { borderBottomColor: colors.border }]}><Label>MOST ACTIVE DAY</Label><Text style={styles.statLineValue} testID="text-most-active-day">{state.statistics.mostActiveDay ?? 'No data yet'}</Text></View>
              <View style={styles.statLine}><Label>MOST ACTIVE MONTH</Label><Text style={styles.statLineValue} testID="text-most-active-month">{state.statistics.mostActiveMonth ? new Date(`${state.statistics.mostActiveMonth}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No data yet'}</Text></View>
            </View>
          </View>
          <View style={styles.sectionBlock}>
            <SectionTitle>Your places</SectionTitle>
            {state.places.length ? (
              <View style={[styles.statsCard, { backgroundColor: colors.card, borderRadius: 18, paddingHorizontal: 20 }]}>
                {state.statistics.topPlaces.slice(0, 5).map((place, index) => (
                  <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`View ${placeTitle(place, index)}, ${place.visitCount} visits`} accessibilityHint="Opens this place on the map." testID={`row-top-place-${index}`} onPress={() => router.push({ pathname: '/(tabs)/map', params: { place: place.id } })} style={[styles.placeRow, { borderBottomColor: colors.border }]}>
                    <View style={styles.placeText}>
                      <Text style={styles.placeName}>{placeTitle(place, index)}</Text>
                      <Text style={styles.smallMuted}>{place.visitCount} {place.visitCount === 1 ? 'visit' : 'visits'} · {formatDuration(place.totalTimeMs)} observed</Text>
                    </View>
                    <Feather name="map-pin" size={17} color={colors.lime} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyCard
                title={state.records.length ? 'No places detected yet.' : 'The map begins with your first visit.'}
                action={<PrimaryButton title={state.records.length ? 'Review your map' : 'View your map'} icon="arrow-right" variant="secondary" testID="button-view-map" onPress={() => router.push('/(tabs)/map')} />}
              >
                {state.records.length
                  ? `${state.records.length} recorded location points have not formed a meaningful visit yet. Places appear after location samples meet the visit rules; GPS points never count as places by themselves.`
                  : 'No location history has been recorded yet. Start tracking to collect visits; recorded GPS points are not places by themselves.'}
              </EmptyCard>
            )}
            <View style={[styles.panel, { backgroundColor: colors.card, marginTop: 14 }]} accessibilityRole="summary" accessibilityLabel={`${state.records.length} raw location points`} testID="card-raw-point-count">
              <Label style={{ color: colors.lime }}>RAW LOCATION POINTS</Label>
              <Text style={[styles.statusTitle, { marginTop: 9 }]} testID="text-raw-point-count">{state.records.length}</Text>
              <Text style={styles.bodyMuted}>Recorded coordinates are separate from processed places and visits.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="View recorded GPS points on map" accessibilityHint="Opens the map and raw location history." onPress={() => router.push('/(tabs)/map')} testID="button-view-raw-points" style={styles.textLink}>
                <Text style={{ color: colors.lime, fontWeight: '700' }}>View raw points on map</Text><Feather name="arrow-right" size={16} color={colors.lime} />
              </Pressable>
            </View>
          </View>
          <View style={styles.sectionBlock}>
            <SectionTitle>Your Wrapped</SectionTitle>
            <WrappedTeaser />
          </View>
        </>
      )}
    </PageFrame>
  );
}

function WrappedTeaser({ demo = false }: { demo?: boolean }) {
  const colors = useColors();
  const { state } = useLocation();
  const hasHistory = state.statistics.totalVisits > 0;
  return (
    <View style={[styles.teaser, { backgroundColor: nativePalette.wrappedCard }]}>
      <Label style={{ color: colors.pink }}>{demo ? 'WRAPPED / DEMO STORY' : 'YOUR STORY / LOCATION WRAPPED'}</Label>
      <Text style={styles.teaserTitle}>{demo ? 'A sample story in ten moments.' : hasHistory ? 'Your Wrapped is ready.' : 'Your Wrapped is still building.'}</Text>
      <Text style={styles.teaserCopy}>{demo ? 'See how the places you return to become a story worth keeping.' : hasHistory ? 'See the year told by your real observed places and visits.' : state.records.length ? 'Your recorded moments have not formed a visit yet. You can keep tracking or preview a clearly labeled sample.' : 'Your own story unlocks after your first observed visit. Until then, preview an explicitly labeled sample.'}</Text>
      <View style={[styles.progressTrack, { backgroundColor: nativePalette.progressTrack }]} accessibilityLabel={hasHistory || demo ? 'Wrapped ready' : 'Wrapped is still building'}><View style={[styles.progressFill, { backgroundColor: colors.pink, width: hasHistory || demo ? '100%' : state.records.length ? '12%' : '4%' }]} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel={demo ? 'Explore demo Wrapped' : hasHistory ? 'Explore your Wrapped' : 'Open Wrapped and preview a demo'} accessibilityHint="Opens the Wrapped story screen." onPress={() => router.push('/(tabs)/wrapped')} testID="button-preview-wrapped" style={styles.textLink}><Text style={{ color: colors.lime, fontWeight: '700' }}>{demo ? 'Explore demo Wrapped' : hasHistory ? 'Explore your Wrapped' : 'Open Wrapped'}</Text><Feather name="arrow-right" size={16} color={colors.lime} /></Pressable>
    </View>
  );
}

function positionOf(lat: number, lng: number, points: { lat: number; lng: number }[]) {
  const lats = points.map(point => point.lat);
  const lngs = points.map(point => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const x = maxLng === minLng ? 0.5 : 0.12 + ((lng - minLng) / (maxLng - minLng)) * 0.76;
  const y = maxLat === minLat ? 0.5 : 0.14 + (1 - (lat - minLat) / (maxLat - minLat)) * 0.72;
  return { left: `${x * 100}%` as `${number}%`, top: `${y * 100}%` as `${number}%` };
}

function dateLabel(value: string | number | null) {
  if (!value) return 'Not available';
  if (typeof value === 'string' && !/\b\d{4}\b/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function MapScreen() {
  const colors = useColors();
  const { state } = useLocation();
  const demo = state.mode === 'demo';
  const places: (Place | ProcessedPlace)[] = demo ? demoPlaces : state.places;
  const records = state.mode === 'real' ? (state.records as RecordLocation[]).slice(-12) : [];
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [selectedProcessedPlace, setSelectedProcessedPlace] = useState<ProcessedPlace | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordLocation | null>(null);
  const selected = selectedPlace || selectedProcessedPlace || selectedRecord;
  const closeDetails = () => { setSelectedPlace(null); setSelectedProcessedPlace(null); setSelectedRecord(null); };
  return (
    <PageFrame mode={state.mode}>
      <Intro label={demo ? 'DEMO / SAMPLE MAP' : 'YOUR MAP / OBSERVED PLACES'} title="Your map." description={demo ? 'The places in this sample story. Tap a marker to take a closer look.' : 'Markers represent processed places from your real visit history. Raw GPS points are listed separately below.'} />
      <View style={[styles.mapCanvas, { backgroundColor: colors.map }]} accessibilityLabel={demo ? 'Illustrated demo map with clickable place markers' : 'Illustrated map with real processed place markers'}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <Rect width="400" height="500" fill={colors.map} />
          <Path d="M-40 85 L430 420 M-40 20 L430 355 M-35 180 L420 495 M10 -35 L380 540 M120 -30 L490 545 M250 -30 L620 545" stroke={colors.mapRoad} strokeWidth="4" opacity=".65" />
          <Path d="M155 -25 L282 525" stroke={nativePalette.water} strokeWidth="88" opacity=".9" />
          <Path d="M126 50 L210 32 L246 115 L164 132 Z M280 75 L376 94 L359 172 L267 160 Z M22 324 L119 290 L145 384 L44 420 Z M276 354 L356 330 L393 402 L303 447 Z" fill={colors.mapPark} opacity=".8" />
          <Path d="M-30 272 Q126 218 430 330" stroke={nativePalette.mapRoad} strokeWidth="10" opacity=".58" fill="none" />
          <Path d="M90 130 C150 175 124 254 219 255 C310 257 270 360 346 388" stroke={colors.lime} strokeWidth="2" strokeDasharray="5 8" opacity=".55" fill="none" />
          <Circle cx="200" cy="246" r="85" stroke={nativePalette.white} strokeWidth="1" opacity=".12" fill="none" />
        </Svg>
        <View style={styles.mapKey}><Label style={{ color: colors.foreground }}>{demo ? 'SAMPLE MAP / NOT TO SCALE' : 'OBSERVED PLACES / SCHEMATIC VIEW'}</Label></View>
        <View style={styles.mapLabelOne}><Label style={styles.mapLabelText}>THE NEIGHBORHOOD</Label></View>
        <View style={styles.mapLabelTwo}><Label style={styles.mapLabelText}>A PLACE TO REMEMBER</Label></View>
        {places.map((place, index) => {
          const pos = positionOf(place.lat, place.lng, places);
          return (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`View ${demo ? (place as Place).name : placeTitle(place as ProcessedPlace, index)}`}
              testID={demo ? `button-map-marker-${place.id}` : `button-place-marker-${index}`}
              onPress={() => demo ? setSelectedPlace(place as Place) : setSelectedProcessedPlace(place as ProcessedPlace)}
              style={({ pressed }) => [styles.mapMarker, { left: pos.left, top: pos.top, backgroundColor: selected === place ? colors.pink : colors.lime, borderColor: colors.background }, pressed && styles.pressed]}
            >
              <Ionicons name="location" size={17} color={colors.background} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sectionBlock}>
        <SectionTitle>{demo ? `${places.length} sample places` : `${state.places.length} observed places`}</SectionTitle>
        {demo ? demoPlaces.map(place => (
          <Pressable key={place.id} testID={`button-place-${place.id}`} onPress={() => setSelectedPlace(place)} style={[styles.placeRow, { borderBottomColor: colors.border }]}>
            <View style={styles.placeText}><Text style={styles.placeName}>{place.name}</Text><Text style={styles.smallMuted}>{place.category} · {place.visits} visits</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        )) : state.places.length ? state.places.map((place, index) => (
          <Pressable key={place.id} testID={`button-processed-place-${index}`} onPress={() => setSelectedProcessedPlace(place)} style={[styles.placeRow, { borderBottomColor: colors.border }]}>
            <View style={styles.placeText}><Text style={styles.placeName}>{placeTitle(place, index)}</Text><Text style={styles.smallMuted}>{place.visitCount} {place.visitCount === 1 ? 'visit' : 'visits'} · {formatDuration(place.totalTimeMs)}</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        )) : (
          <EmptyCard title="No observed places yet.">A processed place appears after location points form a visit. Raw GPS points are shown in their own section below; no sample places are mixed into your history.</EmptyCard>
        )}
      </View>
      {!demo ? (
        <View style={styles.sectionBlock}>
          <SectionTitle>{`Raw location points · ${state.records.length}`}</SectionTitle>
          <Text style={[styles.smallMuted, { marginBottom: 8 }]}>Most recent {records.length} recorded GPS coordinates. These are not place markers or visits.</Text>
          {records.length ? records.slice().reverse().map((record, index) => (
            <Pressable key={`${record.timestamp}-${index}`} testID={`button-record-${index}`} onPress={() => setSelectedRecord(record)} style={[styles.placeRow, { borderBottomColor: colors.border }]}>
              <View style={styles.placeText}><Text style={styles.placeName}>{formatCoordinates(record.lat, record.lng)}</Text><Text style={styles.smallMuted}>{prettyTime(record.timestamp)}</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )) : <Text style={styles.bodyMuted}>No raw location points recorded yet.</Text>}
        </View>
      ) : null}
      <Modal visible={Boolean(selected)} animationType="slide" transparent onRequestClose={closeDetails} statusBarTranslucent>
        <View style={styles.modalShade}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDetails} accessibilityLabel="Close details" />
          <SafeAreaView edges={['bottom']} style={[styles.detailSheet, { backgroundColor: nativePalette.sheet }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <View style={styles.sheetHeadingText}>
                <Label style={{ color: colors.lime }}>{selectedPlace ? 'DEMO PLACE' : selectedProcessedPlace ? 'OBSERVED PLACE' : 'RAW LOCATION POINT'}</Label>
                <Text style={styles.sheetTitle} testID="text-place-name">{selectedPlace?.name ?? (selectedProcessedPlace ? placeTitle(selectedProcessedPlace) : selectedRecord ? formatCoordinates(selectedRecord.lat, selectedRecord.lng) : '')}</Text>
              </View>
              <Pressable onPress={closeDetails} accessibilityLabel="Close details" testID="button-close-details" style={[styles.closeButton, { backgroundColor: nativePalette.close }]}><Feather name="x" size={18} color={colors.foreground} /></Pressable>
            </View>
            <View style={[styles.detailGrid, { borderTopColor: colors.border }]}>
              <Detail label="Visits" value={selectedPlace ? String(selectedPlace.visits) : selectedProcessedPlace ? String(selectedProcessedPlace.visitCount) : 'Not available'} testID="text-place-visits" />
              <Detail label="Time spent" value={selectedPlace?.timeSpent ?? (selectedProcessedPlace ? formatDuration(selectedProcessedPlace.totalTimeMs) : 'Not available')} testID="text-place-time" />
              {selectedProcessedPlace ? <Detail label="First visited" value={dateLabel(selectedProcessedPlace.firstVisit)} testID="text-place-first-visited" /> : null}
              <Detail label="Last visited" value={selectedPlace ? dateLabel(selectedPlace.lastVisited) : selectedProcessedPlace ? dateLabel(selectedProcessedPlace.latestVisit) : dateLabel(selectedRecord?.timestamp ?? null)} testID="text-place-last-visited" />
              <Detail label="Location" value={selected ? formatCoordinates(selected.lat, selected.lng) : ''} />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </PageFrame>
  );
}

function Detail({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return <View style={styles.detailItem}><Text style={styles.smallMuted}>{label}</Text><Text style={styles.detailValue} testID={testID}>{value}</Text></View>;
}

const wrappedColors: Record<string, { background: string; foreground: string; spark: string }> = {
  purple: { background: nativePalette.purple, foreground: nativePalette.white, spark: nativePalette.pink },
  orange: { background: nativePalette.orange, foreground: nativePalette.foregroundStory, spark: nativePalette.lime },
  blue: { background: nativePalette.lime, foreground: nativePalette.blueInk, spark: nativePalette.purple },
};

export function WrappedScreen() {
  const colors = useColors();
  const { state } = useLocation();
  const { play } = useLocalSearchParams<{ play?: string }>();
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => { if (play === '1') setIndex(0); }, [play]);
  const cards = demoWrappedCards.slice(0, 3);
  const card = index === null ? null : cards[index];
  const close = () => setIndex(null);
  const next = () => setIndex(current => current === null ? 0 : current >= cards.length - 1 ? 0 : current + 1);
  const previous = () => setIndex(current => current === null ? null : Math.max(0, current - 1));
  const theme = card ? wrappedColors[card.theme] ?? wrappedColors.purple : wrappedColors.purple;
  return (
    <PageFrame mode={state.mode}>
      <Intro label="WRAPPED / PREVIEW" title="A story in the making." description={state.mode === 'demo' ? 'Three moments from a sample year. This is demo data, not your own history.' : 'Your personal Wrapped needs more history. Explore a clearly labeled sample of how it could feel.'} />
      <View style={[styles.wrappedEntry, { backgroundColor: colors.card }]}>
        <Label style={{ color: colors.lime }}>03 CARDS / DEMO STORY</Label>
        <View style={styles.wrappedEntryOrbit} />
        <Text style={styles.wrappedEntryTitle}>Every place leaves a little something behind.</Text>
        <Text style={styles.bodyMuted}>Take a look at a sample Wrapped while your own story begins to grow.</Text>
        <PrimaryButton title="Play demo Wrapped" icon="arrow-right" testID="button-play-wrapped" onPress={() => setIndex(0)} />
      </View>
      <Modal visible={index !== null} animationType="fade" onRequestClose={close} statusBarTranslucent>
        {card ? (
          <View style={[styles.story, { backgroundColor: theme.background }]}>
            <StatusBar barStyle={theme.foreground === nativePalette.white ? 'light-content' : 'dark-content'} />
            <SafeAreaView edges={['top', 'bottom']} style={styles.storySafe}>
              <View style={styles.storyProgress}>{cards.map((item, number) => <Pressable key={item.id} accessibilityLabel={`Go to card ${number + 1}`} testID={`button-story-progress-${number}`} onPress={() => setIndex(number)} style={[styles.storyProgressItem, { backgroundColor: number <= (index ?? 0) ? theme.foreground : `${theme.foreground}47` }]} />)}</View>
              <View style={styles.storyHeader}><Label style={{ color: theme.foreground, opacity: 0.75 }}>LOCATION WRAPPED / DEMO</Label><Pressable onPress={close} accessibilityLabel="Close Wrapped" testID="button-close-wrapped" style={styles.storyClose}><Feather name="x" size={19} color={theme.foreground} /></Pressable></View>
              <View style={styles.storyBody}>
                <Label style={{ color: theme.foreground, marginBottom: 25 }}>{card.kicker}</Label>
                <Text style={[styles.storyTitle, { color: theme.foreground }]} testID="text-story-title">{card.title}</Text>
                <Text style={[styles.storyMetric, { color: theme.foreground }]} testID="text-story-metric">{card.metric}</Text>
                <Text style={[styles.storyCaption, { color: theme.foreground }]}>{card.caption}</Text>
              </View>
              <View style={styles.storyFooter}>
                <Pressable disabled={index === 0} onPress={previous} testID="button-previous-card" style={styles.storyAction}><Feather name="arrow-left" size={18} color={theme.foreground} /><Text style={[styles.storyActionText, { color: theme.foreground, opacity: index === 0 ? 0.45 : 1 }]}>Previous</Text></Pressable>
                <Label style={{ color: theme.foreground, opacity: 0.8 }}>0{(index ?? 0) + 1} / 0{cards.length}</Label>
                {index === cards.length - 1 ? <Pressable onPress={() => setIndex(0)} testID="button-replay-wrapped" style={styles.storyAction}><Text style={[styles.storyActionText, { color: theme.foreground }]}>Replay</Text><Feather name="rotate-ccw" size={18} color={theme.foreground} /></Pressable> : <Pressable onPress={next} testID="button-next-card" style={styles.storyAction}><Text style={[styles.storyActionText, { color: theme.foreground }]}>Next</Text><Feather name="arrow-right" size={18} color={theme.foreground} /></Pressable>}
              </View>
            </SafeAreaView>
            <View pointerEvents="none" style={[styles.storyRing, { borderColor: theme.foreground }]} />
          </View>
        ) : null}
      </Modal>
    </PageFrame>
  );
}

export function ProfileScreen() {
  const colors = useColors();
  const { state, requestAccess, pause, resume, clearHistory, openSettings, enableBackground, disableBackground } = useLocation();
  const demo = state.mode === 'demo';
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [controlMessage, setControlMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [backgroundMessage, setBackgroundMessage] = useState('');
  const [updatingTracking, setUpdatingTracking] = useState(false);
  const [startingTracking, setStartingTracking] = useState(false);
  const hasWrappedHistory = state.statistics.totalVisits > 0;
  const realCanToggle = state.mode === 'real' && (state.status === 'active' || state.status === 'paused');
  const toggle = async () => {
    setControlMessage('');
    setUpdatingTracking(true);
    try { if (state.status === 'active') await pause(); else await resume(); }
    catch { setControlMessage('Could not update tracking. Please try again.'); }
    finally { setUpdatingTracking(false); }
  };
  const toggleBackground = async () => {
    setBackgroundMessage('');
    try {
      if (state.backgroundEnabled) {
        await disableBackground();
        setBackgroundMessage('Background location updates are off.');
      } else if (await enableBackground()) {
        setBackgroundMessage('Background location updates are on.');
      } else if (!state.backgroundAvailable) {
        setBackgroundMessage('Background location requires a development build; it is not available in Expo Go.');
      } else {
        setBackgroundMessage('Background access was not enabled. Check your location permissions in Settings and try again.');
      }
    } catch {
      setBackgroundMessage('Could not update background location access. Please try again.');
    }
  };
  const startTracking = async () => {
    setStartingTracking(true);
    setControlMessage('');
    try { await requestAccess(); }
    catch { setControlMessage('Could not start tracking. Check your location permissions and try again.'); }
    finally { setStartingTracking(false); }
  };
  const openLocationSettings = async () => {
    setControlMessage('');
    try { await openSettings(); }
    catch { setControlMessage('Could not open Settings. Open your device Settings and allow location for Location Wrapped.'); }
  };
  const erase = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await clearHistory();
      setConfirm(false);
      setMessage('Your location history has been deleted from this device.');
    } catch (error) {
      setDeleteFailed(true);
      setMessage(error instanceof Error && error.message.includes('temporary Timeline file')
        ? error.message
        : 'Could not delete saved history. Please try again.');
    } finally {
      setDeleting(false);
    }
  };
  return (
    <PageFrame mode={state.mode}>
      <Intro label="YOUR SPACE / SETTINGS" title="Your space." description="Your location story belongs to you. You're always in control." />
      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" testID={deleteFailed ? 'status-delete-error' : 'status-delete-success'} style={deleteFailed ? styles.errorText : styles.success}>{message}</Text> : null}
      <SectionTitle>Tracking</SectionTitle>
      <StatusCard />
      <View style={styles.sectionBlock}>
        <SectionTitle>Your controls</SectionTitle>
        <View style={[styles.settingsList, { borderTopColor: colors.border }]}>
          {demo ? <SettingRow title="Start your own story" copy="Enable location access and leave the sample behind." icon="arrow-right" testID="button-start-real-tracking" onPress={() => router.push('/onboarding/1')} /> : (
            realCanToggle ? (
              <SettingRow title={updatingTracking ? 'Updating tracking…' : state.status === 'active' ? 'Pause tracking' : 'Resume tracking'} copy={state.status === 'active' ? 'Stop recording new locations for now.' : 'Start recording again while this app is open.'} icon={state.status === 'active' ? 'pause' : 'play'} testID="button-toggle-tracking" disabled={updatingTracking} onPress={toggle} />
            ) : (
              <SettingRow title={startingTracking ? 'Requesting location access…' : 'Start tracking'} copy={state.status === 'denied' ? 'Request location access again to begin recording.' : state.status === 'unavailable' ? 'Check device location services, then try again.' : 'Allow foreground location to begin recording your own history.'} icon="navigation" testID="button-start-tracking" disabled={startingTracking} onPress={() => { void startTracking(); }} />
            )
          )}
          {!demo && state.status === 'denied' && !state.canAskAgain ? <SettingRow title="Open location Settings" copy="Location access is denied. Enable it in your device settings to continue." icon="settings" testID="button-profile-open-settings" onPress={() => { void openLocationSettings(); }} /> : null}
          {!demo && realCanToggle ? (
            <SettingRow
              title={state.backgroundEnabled ? 'Turn off background updates' : 'Opt in to background updates'}
              copy={state.backgroundAvailable ? state.backgroundEnabled ? state.status === 'paused' ? 'Background updates are paused. Resume tracking to collect new locations.' : 'Allow location updates when the app is not open. You can turn this off at any time.' : state.status === 'paused' ? 'Resume tracking before enabling background updates.' : 'Optional: allow updates when the app is not open. This requires background location permission.' : 'Background location is unavailable in Expo Go. Use a development build to enable this optional feature.'}
              icon={state.backgroundEnabled ? 'check-circle' : 'clock'}
              testID="button-toggle-background-tracking"
              disabled={(!state.backgroundAvailable || state.status !== 'active') && !state.backgroundEnabled}
              onPress={() => { void toggleBackground(); }}
            />
          ) : null}
          <SettingRow
            title="Import Google Timeline"
            copy="Add past visits from a file you choose. Imported locations stay on this device."
            icon="upload-cloud"
            testID="button-import-timeline"
            onPress={() => router.push('/import')}
          />
          <SettingRow
            title={demo ? 'Replay demo Wrapped' : hasWrappedHistory ? 'Replay your Wrapped' : 'Preview demo Wrapped'}
            copy={demo ? 'Replay this clearly labeled sample story.' : hasWrappedHistory ? 'Replay your story made from observed visits.' : 'Explore a sample story while your observed history is still building.'}
            icon="rotate-ccw"
            testID="button-replay-demo"
            onPress={() => router.push('/(tabs)/wrapped?play=1')}
          />
          <SettingRow title={demo ? 'Leave demo & clear history' : 'Delete My Location History'} copy={demo ? 'Remove the demo and any stored location records.' : 'Permanently remove recorded and imported locations and saved place names from this device.'} icon="trash-2" danger testID="button-delete-history" onPress={() => { setMessage(''); setConfirm(true); }} />
        </View>
        {!demo && controlMessage ? <Text accessibilityRole="alert" testID="status-tracking-control" style={[styles.bodyMuted, { marginTop: 12 }]}>{controlMessage}</Text> : null}
        {!demo && backgroundMessage ? <Text accessibilityRole="alert" testID="status-background-tracking" style={[styles.bodyMuted, { marginTop: 12 }]}>{backgroundMessage}</Text> : null}
      </View>
      <View style={[styles.aboutCard, { backgroundColor: colors.card }]} accessibilityRole="summary" accessibilityLabel="About Location Wrapped">
        <Label style={{ color: colors.lime }}>ABOUT THE APP</Label>
        <Text style={styles.aboutTitle}>About Location Wrapped</Text>
        <Text style={styles.bodyMuted}>Location Wrapped turns observed visits into a story of your year. Foreground tracking begins only when you grant permission. Background updates are a separate, optional opt-in when supported; Expo Go requires a development build for this feature. Past trips are imported only when you choose a Google Timeline file. Place names are never inferred from coordinates. Demo content is always labeled and kept separate from your history.</Text>
      </View>
      <Modal visible={confirm} animationType="slide" transparent onRequestClose={() => setConfirm(false)} statusBarTranslucent>
        <View style={styles.modalShade} accessibilityViewIsModal>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel deletion and close confirmation" style={StyleSheet.absoluteFill} onPress={() => setConfirm(false)} />
          <SafeAreaView edges={['bottom']} style={[styles.detailSheet, { backgroundColor: nativePalette.sheet }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <View style={styles.sheetHeadingText}><Label style={{ color: colors.pink }}>THIS CAN’T BE UNDONE</Label><Text style={styles.sheetTitle}>Delete your history?</Text></View>
              <Pressable onPress={() => setConfirm(false)} accessibilityLabel="Close confirmation" testID="button-close-confirmation" style={[styles.closeButton, { backgroundColor: nativePalette.close }]}><Feather name="x" size={18} color={colors.foreground} /></Pressable>
            </View>
            <Text style={[styles.bodyMuted, { marginBottom: 22 }]}>This removes your recorded and imported locations, import history, and saved place names from this device. Your demo preview can always be opened again.</Text>
            <View style={styles.confirmActions}>
              <View style={styles.confirmAction}><PrimaryButton title="Keep history" variant="outline" testID="button-cancel-delete" onPress={() => setConfirm(false)} wide /></View>
              <View style={styles.confirmAction}><PrimaryButton title={deleting ? 'Deleting…' : 'Delete history'} variant="danger" disabled={deleting} testID="button-confirm-delete" onPress={erase} wide /></View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </PageFrame>
  );
}

function SettingRow({ title, copy, icon, testID, onPress, disabled, danger }: { title: string; copy: string; icon: React.ComponentProps<typeof Feather>['name']; testID: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${copy}`} accessibilityHint={danger ? 'Opens a confirmation before deleting saved history.' : undefined} disabled={disabled} testID={testID} onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.border }, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <View style={styles.settingCopy}><Text style={[styles.settingTitle, danger && { color: colors.pink }]}>{title}</Text><Text style={styles.smallMuted}>{copy}</Text></View>
      <Feather name={icon} size={19} color={danger ? colors.pink : colors.lime} />
    </Pressable>
  );
}

export function NotFoundScreen() {
  const colors = useColors();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.notFound, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}><Brand landing /></View>
      <View style={styles.notFoundContent}>
        <Label style={{ color: colors.lime }}>AN UNMAPPED TURN / 404</Label>
        <Text style={styles.pageTitle}>This place isn't on the map.</Text>
        <Text style={styles.introCopy}>Let's get you back to somewhere familiar.</Text>
        <PrimaryButton title="Back to the beginning" icon="arrow-left" testID="link-return-home" onPress={() => router.replace('/')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topSafe: { backgroundColor: 'transparent' },
  topbar: { minHeight: 68, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { height: 31, width: 31, borderWidth: 2, borderRadius: 17, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-24deg' }] },
  brandName: { color: nativePalette.white, fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: -0.9 },
  brandTag: { fontSize: 8, letterSpacing: 1 },
  modeBadge: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 1.2, borderWidth: 1, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 7 },
  eyebrow: { color: nativePalette.label, fontFamily: 'Inter_500Medium', fontSize: 9, lineHeight: 14, letterSpacing: 1.5 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 104 },
  intro: { paddingTop: 31, paddingBottom: 26 },
  pageTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 43, lineHeight: 47, letterSpacing: -3, marginTop: 8 },
  introCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 11, maxWidth: 400 },
  sectionTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 20, letterSpacing: -0.8, marginBottom: 14, marginTop: 4 },
  panel: { borderRadius: 18, padding: 20 },
  statusTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  statusLead: { flexDirection: 'row', gap: 13, flex: 1 },
  statusDot: { width: 8, height: 8, marginTop: 7, borderRadius: 4 },
  statusText: { flex: 1 },
  statusTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 21, letterSpacing: -1, marginBottom: 4 },
  bodyMuted: { color: nativePalette.foregroundSoft, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  statusStats: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 22, paddingTop: 16, flexDirection: 'row', gap: 12 },
  statusStat: { flex: 1 },
  smallMuted: { color: nativePalette.foregroundQuiet, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  statusValue: { color: nativePalette.white, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 6 },
  errorText: { color: nativePalette.foregroundError, marginTop: 16, fontSize: 13, lineHeight: 19 },
  textLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, alignSelf: 'flex-start' },
  button: { minHeight: 50, borderRadius: 9, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, alignSelf: 'flex-start' },
  buttonWide: { alignSelf: 'stretch' },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 14, letterSpacing: -0.25 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  emptyCard: { padding: 24 },
  emptyIcon: { height: 46, width: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -1, marginBottom: 8 },
  loadingCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 15, marginTop: 12 },
  loadingCopy: { flex: 1 },
  sectionBlock: { marginTop: 28 },
  statsCard: { paddingTop: 22 },
  heroNumber: { fontFamily: 'Inter_700Bold', fontSize: 112, lineHeight: 112, letterSpacing: -11, marginLeft: -5, marginTop: 17 },
  statLabel: { color: nativePalette.white, fontFamily: 'Inter_500Medium', fontSize: 15, marginTop: 4, paddingBottom: 23 },
  statPair: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 20, gap: 15 },
  homeFavorite: { borderRadius: 16, padding: 19, marginTop: 21, marginBottom: 3 },
  homeFavoriteTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 31, letterSpacing: -1.2, marginTop: 10 },
  homeFavoriteSub: { color: nativePalette.white, opacity: 0.8, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 8 },
  statHalf: { flex: 1 },
  statValue: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 39, letterSpacing: -2, marginTop: 7, marginBottom: 2 },
  km: { color: nativePalette.white, fontSize: 17 },
  statLine: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statLineValue: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 13, flexShrink: 1, textAlign: 'right' },
  teaser: { borderRadius: 18, padding: 23, overflow: 'hidden' },
  teaserTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 27, lineHeight: 30, letterSpacing: -1.5, marginTop: 15, marginBottom: 10, maxWidth: 300 },
  teaserCopy: { color: nativePalette.teaserCopy, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  progressTrack: { height: 3, borderRadius: 3, marginTop: 24, marginBottom: 2 },
  progressFill: { height: 3, width: '28%', borderRadius: 3 },
  landing: { flex: 1, paddingHorizontal: 16 },
  landingScroll: { paddingTop: 33, paddingBottom: 24 },
  display: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 57, lineHeight: 54, letterSpacing: -5.6, marginTop: 22 },
  lede: { color: nativePalette.lede, fontFamily: 'Inter_400Regular', fontSize: 17, lineHeight: 25, marginTop: 21, maxWidth: 355 },
  actionStack: { gap: 10, alignItems: 'stretch', marginTop: 22 },
  artWrap: { width: '89%', aspectRatio: 1, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 10 },
  orbit: { position: 'absolute', borderWidth: 1, borderRadius: 999 },
  orbitOuter: { width: '100%', height: '100%', transform: [{ rotate: '-18deg' }, { scaleX: 0.85 }] },
  orbitMiddle: { width: '75%', height: '75%', transform: [{ rotate: '28deg' }, { scaleX: 0.92 }] },
  orbitInner: { width: '52%', height: '52%', transform: [{ rotate: '-35deg' }, { scaleX: 0.9 }] },
  artDisc: { width: '57%', aspectRatio: 1, borderRadius: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: nativePalette.art, borderWidth: 1, borderColor: nativePalette.pink, transform: [{ rotate: '-17deg' }] },
  artCore: { width: '36%', aspectRatio: 1, borderWidth: 12, borderRadius: 100, backgroundColor: nativePalette.purple },
  artDot: { position: 'absolute', top: '14%', left: '20%', width: 15, height: 15, borderRadius: 9 },
  artDotOrange: { top: '75%', left: '78%', width: 10, height: 10 },
  artCaption: { position: 'absolute', bottom: '5%', right: 0, fontSize: 8, letterSpacing: 1 },
  landingFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, paddingBottom: 7, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  onboardScroll: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 20 },
  onboardVisual: { width: '100%', aspectRatio: 1.28, maxHeight: 265, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  visualRing: { position: 'absolute', aspectRatio: 1, borderWidth: 1, borderRadius: 200 },
  visualRingOuter: { width: '83%' },
  visualRingInner: { width: '59%' },
  visualCore: { width: '35%', aspectRatio: 1, borderRadius: 200, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-12deg' }] },
  onboardTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 38, lineHeight: 40, letterSpacing: -2.7, marginTop: 12 },
  onboardCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 25, marginTop: 14, marginBottom: 19 },
  note: { color: nativePalette.foregroundSubtle, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19, marginBottom: 18 },
  noteStrong: { color: nativePalette.foregroundNote, fontFamily: 'Inter_600SemiBold' },
  alert: { backgroundColor: nativePalette.alert, borderRadius: 10, padding: 14, marginBottom: 16, gap: 13 },
  alertText: { color: nativePalette.foregroundError, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  onboardFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  stepBars: { flexDirection: 'row', gap: 6 },
  stepBar: { width: 24, height: 3, borderRadius: 3 },
  mapCanvas: { height: 400, borderRadius: 18, overflow: 'hidden', position: 'relative' },
  mapKey: { position: 'absolute', left: 12, top: 13, borderRadius: 6, backgroundColor: nativePalette.ink, paddingHorizontal: 9, paddingVertical: 7 },
  mapLabelOne: { position: 'absolute', top: '39%', left: '8%' },
  mapLabelTwo: { position: 'absolute', bottom: '22%', right: '8%' },
  mapLabelText: { color: nativePalette.foregroundMap, fontSize: 8, opacity: 0.75, letterSpacing: 1.2 },
  mapMarker: { position: 'absolute', width: 36, height: 36, marginLeft: -18, marginTop: -18, borderRadius: 18, borderWidth: 3, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  placeRow: { minHeight: 67, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15 },
  placeText: { flex: 1 },
  placeName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: nativePalette.overlay },
  detailSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 22, paddingBottom: 18 },
  sheetHandle: { width: 38, height: 4, backgroundColor: nativePalette.sheetHandle, borderRadius: 3, alignSelf: 'center', marginBottom: 23 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  sheetHeadingText: { flex: 1 },
  sheetTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 29, lineHeight: 34, letterSpacing: -1.8, marginTop: 6, marginBottom: 20 },
  closeButton: { height: 34, width: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  detailGrid: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18, paddingBottom: 18, flexDirection: 'row', flexWrap: 'wrap', rowGap: 20 },
  detailItem: { width: '50%', paddingRight: 9 },
  detailValue: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21, letterSpacing: -0.4, marginTop: 6 },
  wrappedEntry: { minHeight: 350, padding: 24, borderRadius: 18, justifyContent: 'space-between', overflow: 'hidden', gap: 14 },
  wrappedEntryOrbit: { position: 'absolute', width: 230, height: 230, borderWidth: 45, borderColor: nativePalette.purple, borderRadius: 120, right: -88, top: -92, opacity: 0.52 },
  wrappedEntryTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 39, lineHeight: 41, letterSpacing: -2.7, maxWidth: 340, marginTop: 30 },
  story: { flex: 1, overflow: 'hidden' },
  storySafe: { flex: 1, paddingHorizontal: 16 },
  storyProgress: { flexDirection: 'row', gap: 5, paddingTop: 9 },
  storyProgressItem: { height: 3, borderRadius: 3, flex: 1 },
  storyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 11 },
  storyClose: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: nativePalette.storyClose },
  storyBody: { flex: 1, justifyContent: 'center', paddingVertical: 26 },
  storyTitle: { fontFamily: 'Inter_700Bold', fontSize: 58, lineHeight: 58, letterSpacing: -5, maxWidth: 375 },
  storyMetric: { fontFamily: 'Inter_700Bold', fontSize: 48, lineHeight: 54, letterSpacing: -4, marginTop: 26 },
  storyCaption: { fontFamily: 'Inter_500Medium', fontSize: 17, lineHeight: 25, maxWidth: 350, marginTop: 21 },
  storyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingBottom: 6 },
  storyAction: { minHeight: 45, flexDirection: 'row', alignItems: 'center', gap: 7 },
  storyActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  storyRing: { position: 'absolute', pointerEvents: 'none', width: 320, height: 320, borderWidth: 42, borderRadius: 180, opacity: 0.1, right: -200, top: '12%' },
  settingsList: { borderTopWidth: StyleSheet.hairlineWidth },
  settingRow: { minHeight: 73, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  settingCopy: { flex: 1 },
  settingTitle: { color: nativePalette.white, fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: 4 },
  aboutCard: { borderRadius: 18, padding: 21, marginTop: 28 },
  aboutTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 21, letterSpacing: -0.9, marginTop: 13, marginBottom: 8 },
  success: { backgroundColor: nativePalette.success, borderRadius: 10, padding: 14, color: nativePalette.successText, marginBottom: 18, fontSize: 13, lineHeight: 19 },
  confirmActions: { flexDirection: 'row', gap: 9 },
  confirmAction: { flex: 1 },
  notFound: { flex: 1, paddingHorizontal: 16 },
  notFoundContent: { flex: 1, justifyContent: 'center', gap: 15 },
});