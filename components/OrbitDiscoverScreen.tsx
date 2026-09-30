import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nativePalette } from '@/constants/colors';
import { useCloud } from '@/context/CloudContext';
import { CloudApiError, type CloudInterest, type CloudJob, type CloudNextPlaces, type CloudProfile, type CloudRecommendation, type CloudRecommendations, type EnqueuedCloudJob } from '@/services/cloudApi';

type DiscoverAction = 'profile' | 'recommendations' | 'nextPlace';
type BusyAction = DiscoverAction | 'recomputeVisits' | 'job' | 'refresh' | 'interest' | 'refetchRecommendations';
type InterestFeedback = { kind: 'saved' | 'dismissed'; message: string };

function generatedAt(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function unavailableMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : 'The server request failed.';
  if (error instanceof CloudApiError && error.status === 503) {
    return /model|predict|recommend|unavailable/i.test(detail)
      ? 'The server’s prediction or recommendation model is currently unavailable. Try again later.'
      : 'The Discover service is temporarily unavailable (503). Try again later.';
  }
  if (/model|prediction.*unavailable|recommendation.*unavailable/i.test(detail)) {
    return 'The server’s prediction or recommendation model is currently unavailable. Try again later.';
  }
  return detail;
}

export function OrbitDiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cloud = useCloud();
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [recommendations, setRecommendations] = useState<CloudRecommendations | null>(null);
  const [nextPlaces, setNextPlaces] = useState<CloudNextPlaces | null>(null);
  const [loading, setLoading] = useState<BusyAction | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DiscoverAction, string>>>({});
  const [loaded, setLoaded] = useState<Partial<Record<DiscoverAction, boolean>>>({});
  const initialJobId = cloud.lastAnalysisJob?.job_id ?? cloud.lastBackup?.analysisJobId ?? '';
  const initialJobStatus = cloud.lastAnalysisJob?.status ?? (initialJobId ? 'queued' : 'idle');
  const [jobId, setJobId] = useState(initialJobId);
  const [jobStatus, setJobStatus] = useState<CloudJob['status'] | 'idle'>(initialJobStatus);
  const [jobError, setJobError] = useState('');
  const [jobRequestError, setJobRequestError] = useState('');
  const [refreshedAfterJob, setRefreshedAfterJob] = useState(false);
  const [interestPending, setInterestPending] = useState<string | null>(null);
  const [interestError, setInterestError] = useState('');
  const [feedbackPending, setFeedbackPending] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackAck, setFeedbackAck] = useState<Record<number, InterestFeedback>>({});
  const [recentlyDismissed, setRecentlyDismissed] = useState<Record<number, CloudRecommendation>>({});
  const mutationLock = useRef(false);

  const request = async (action: DiscoverAction) => {
    if (loading || !cloud.user) return;
    cloud.clearError();
    setLoading(action);
    setErrors(current => ({ ...current, [action]: undefined }));
    if (action === 'recommendations') {
      setRecommendations(null);
      setLoaded(current => ({ ...current, recommendations: false }));
    }
    try {
      const result = await cloud.requestDiscover(action);
      if (action === 'profile') setProfile(result as CloudProfile);
      if (action === 'recommendations') setRecommendations(result as CloudRecommendations);
      if (action === 'nextPlace') setNextPlaces(result as CloudNextPlaces);
      setLoaded(current => ({ ...current, [action]: true }));
    } catch (error) {
      setErrors(current => ({ ...current, [action]: unavailableMessage(error) }));
    } finally {
      setLoading(null);
    }
  };

  const refetchRecommendations = async () => {
    cloud.clearError();
    setRecommendations(null);
    setLoaded(current => ({ ...current, recommendations: false }));
    setErrors(current => ({ ...current, recommendations: undefined }));
    setLoading('refetchRecommendations');
    try {
      const result = await cloud.requestDiscover('recommendations') as CloudRecommendations;
      setRecommendations(result);
      setLoaded(current => ({ ...current, recommendations: true }));
      return true;
    } catch (error) {
      setErrors(current => ({
        ...current,
        recommendations: `${unavailableMessage(error)} Previous recommendations were cleared because they may no longer reflect your account.`,
      }));
      return false;
    } finally {
      setLoading(null);
    }
  };

  const refreshAfterAnalysis = async () => {
    setLoading('refresh');
    let complete = true;
    const reload = async <T,>(action: DiscoverAction, save: (result: T) => void) => {
      cloud.clearError();
      try {
        const result = await cloud.requestDiscover(action);
        save(result as T);
        setLoaded(current => ({ ...current, [action]: true }));
        setErrors(current => ({ ...current, [action]: undefined }));
      } catch (error) {
        complete = false;
        setErrors(current => ({ ...current, [action]: unavailableMessage(error) }));
      }
    };
    await reload<CloudProfile>('profile', result => setProfile(result));
    await reload<CloudRecommendations>('recommendations', result => setRecommendations(result));
    await reload<CloudNextPlaces>('nextPlace', result => setNextPlaces(result));
    setRefreshedAfterJob(complete);
    setLoading(null);
  };

  const startVisitAnalysis = async () => {
    if (loading || !cloud.user) return;
    cloud.clearError();
    setJobRequestError('');
    setJobError('');
    setRefreshedAfterJob(false);
    setLoading('recomputeVisits');
    try {
      const result = await cloud.requestDiscover('recomputeVisits') as EnqueuedCloudJob;
      setJobId(result.job_id);
      setJobStatus(result.status);
    } catch (error) {
      setJobRequestError(unavailableMessage(error));
    } finally {
      setLoading(null);
    }
  };

  const refreshJob = async () => {
    if (loading || !cloud.user || !jobId) return;
    cloud.clearError();
    setJobRequestError('');
    setLoading('job');
    try {
      const result = await cloud.requestDiscover('job', jobId) as CloudJob;
      setJobStatus(result.status);
      setJobError(result.error ?? '');
      if (result.status === 'done') await refreshAfterAnalysis();
    } catch (error) {
      setJobRequestError(unavailableMessage(error));
    } finally {
      setLoading(null);
    }
  };

  const updateInterest = async (interest: CloudInterest) => {
    if (mutationLock.current || loading || interestPending || cloud.status === 'busy' || !cloud.user) return;
    mutationLock.current = true;
    setInterestPending(interest.category);
    setInterestError('');
    cloud.clearError();
    try {
      const updated = await cloud.updateInterest(interest.category, !interest.hidden);
      setProfile(updated);
      await refetchRecommendations();
    } catch (error) {
      setInterestError(error instanceof Error ? error.message : 'Could not update this interest.');
    } finally {
      mutationLock.current = false;
      setInterestPending(null);
    }
  };

  const sendFeedback = async (placeId: number, action: 'saved' | 'dismissed') => {
    if (mutationLock.current || loading || feedbackPending !== null || cloud.status === 'busy' || !cloud.user) return;
    mutationLock.current = true;
    setFeedbackPending(placeId);
    setFeedbackError('');
    cloud.clearError();
    try {
      await cloud.sendRecommendationFeedback(placeId, action);
      setFeedbackAck(current => ({
        ...current,
        [placeId]: { kind: action, message: action === 'saved' ? 'Save feedback acknowledged by Orbit. No saved-items list is available here.' : 'Dismiss feedback acknowledged by Orbit.' },
      }));
      if (action === 'dismissed') {
        const dismissed = recommendations?.items.find(item => item.place.id === placeId);
        if (dismissed) setRecentlyDismissed(current => ({ ...current, [placeId]: dismissed }));
        await refetchRecommendations();
      } else if (recentlyDismissed[placeId]) {
        setRecentlyDismissed(current => {
          const next = { ...current };
          delete next[placeId];
          return next;
        });
        await refetchRecommendations();
      }
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : 'Could not send recommendation feedback.');
    } finally {
      mutationLock.current = false;
      setFeedbackPending(null);
    }
  };

  const isBusy = !!loading || interestPending !== null || feedbackPending !== null || cloud.status === 'busy';
  const actionButton = (action: DiscoverAction, title: string, testID: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isBusy || !cloud.user, busy: loading === action }}
      testID={testID}
      disabled={isBusy || !cloud.user}
      onPress={() => void request(action)}
      style={({ pressed }) => [styles.action, { borderColor: colors.border }, isBusy && styles.disabled, pressed && !isBusy && styles.pressed]}
    >
      {loading === action ? <ActivityIndicator size="small" color={colors.lime} /> : <Feather name="refresh-cw" size={15} color={colors.lime} />}
      <Text style={[styles.actionText, { color: colors.foreground }]}>{loading === action ? 'Loading…' : title}</Text>
    </Pressable>
  );

  const interests: CloudInterest[] = profile?.interests ?? [];
  const visibleRecommendations = recommendations?.items.filter(item => !recentlyDismissed[item.place.id]) ?? [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" testID="button-discover-back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={21} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.kicker, { color: colors.lime }]}>ORBIT / SERVER DISCOVER</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Discover</Text>
        </View>
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
      >
        <View style={[styles.info, { backgroundColor: colors.card }]}>
          <Ionicons name="cloud-outline" size={20} color={colors.lime} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            These are server-generated profile insights, recommendations, and predictions from your Orbit account data. This screen does not request nearby results or use live device coordinates. No demo results are shown.
          </Text>
        </View>
        {cloud.status === 'disabled' ? (
          <View style={[styles.card, { backgroundColor: colors.card }]} testID="status-discover-unavailable">
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Orbit Discover unavailable</Text>
            <Text style={styles.body}>Cloud features are not configured or enabled for this build. No sign-in form or server request is available; your local history remains on this device.</Text>
          </View>
        ) : cloud.status === 'checking' ? (
          <View style={[styles.card, styles.loadingCard, { backgroundColor: colors.card }]} testID="status-discover-checking">
            <ActivityIndicator color={colors.lime} />
            <Text style={styles.body}>Checking your Orbit account…</Text>
          </View>
        ) : !cloud.user ? (
          <View style={[styles.card, { backgroundColor: colors.card }]} testID="status-discover-signed-out">
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Sign in to use Discover</Text>
            <Text style={styles.body}>Server Discover is available only for an Orbit account. It does not display sample results as personal data.</Text>
            <Pressable accessibilityRole="button" testID="button-discover-profile" onPress={() => router.replace('/(tabs)/profile')} style={styles.link}>
              <Text style={{ color: colors.lime, fontFamily: 'Inter_600SemiBold' }}>Go to Profile</Text><Feather name="arrow-right" size={16} color={colors.lime} />
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card }]} testID="card-discover-analysis">
              <View style={styles.cardTop}>
                <View style={styles.cardHeading}>
                  <Text style={[styles.eyebrow, { color: colors.lime }]}>VISIT ANALYSIS</Text>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Prepare Discover</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  testID="button-discover-recompute"
                  disabled={isBusy}
                  onPress={() => void startVisitAnalysis()}
                  style={({ pressed }) => [styles.action, { borderColor: colors.border }, isBusy && styles.disabled, pressed && !isBusy && styles.pressed]}
                >
                  {loading === 'recomputeVisits' ? <ActivityIndicator size="small" color={colors.lime} /> : <Feather name="refresh-cw" size={15} color={colors.lime} />}
                  <Text style={[styles.actionText, { color: colors.foreground }]}>
                    {loading === 'recomputeVisits' ? 'Starting…' : jobStatus === 'failed' ? 'Retry analysis' : 'Recompute visits'}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.body}>Visit analysis runs on the server. Recommendations and predictions may not be ready until processing finishes. This never sends new device coordinates.</Text>
              {jobId ? (
                <View style={[styles.jobStatus, { borderTopColor: colors.border }]} testID="status-discover-job">
                  <View style={styles.jobStatusCopy}>
                    <Text style={styles.rowTitle}>Job {jobId}</Text>
                    <Text style={styles.meta}>Status: {jobStatus}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    testID="button-discover-refresh-job"
                    disabled={isBusy}
                    onPress={() => void refreshJob()}
                    style={({ pressed }) => [styles.action, { borderColor: colors.border }, isBusy && styles.disabled, pressed && !isBusy && styles.pressed]}
                  >
                    {loading === 'job' ? <ActivityIndicator size="small" color={colors.lime} /> : <Feather name="rotate-cw" size={15} color={colors.lime} />}
                    <Text style={[styles.actionText, { color: colors.foreground }]}>{loading === 'job' ? 'Checking…' : 'Refresh job'}</Text>
                  </Pressable>
                </View>
              ) : null}
              {jobStatus === 'queued' ? <Text style={styles.notice} testID="status-discover-queued">Queued. If no worker is available, the job may remain queued. Use Refresh job to check again; status is not polled automatically.</Text> : null}
              {jobStatus === 'running' ? <Text style={styles.notice} testID="status-discover-running">The server worker is processing visits. Use Refresh job to check again; status is not polled automatically.</Text> : null}
              {loading === 'refresh' ? <View style={styles.refreshing} accessibilityRole="summary" accessibilityLabel="Refreshing server profile, recommendations, and predictions" testID="status-discover-refreshing"><ActivityIndicator size="small" color={colors.lime} /><Text style={styles.notice}>Refreshing profile, recommendations, and predictions from the server…</Text></View> : null}
              {jobStatus === 'done' && refreshedAfterJob ? <Text style={styles.notice} testID="status-discover-done">Visit analysis finished. Profile, recommendations, and predictions were refreshed from the server.</Text> : null}
              {jobStatus === 'done' && !refreshedAfterJob ? <Text style={styles.notice} testID="status-discover-done-not-refreshed">Visit analysis is complete. Refresh the job to fetch the latest profile, recommendations, and predictions.</Text> : null}
              {jobStatus === 'failed' ? <Text accessibilityRole="alert" style={styles.error} testID="status-discover-job-failed">Server visit analysis failed{jobError ? `: ${jobError}` : '.'} You can retry analysis.</Text> : null}
              {cloud.lastBackup?.analysisError ? <Text accessibilityRole="alert" style={styles.error} testID="status-discover-backup-analysis-error">The latest backup could not start server analysis: {cloud.lastBackup.analysisError} Retry analysis above. Recommendations may not yet reflect the latest uploaded points.</Text> : null}
              {jobRequestError ? <Text accessibilityRole="alert" style={styles.error} testID="status-discover-job-error">{jobRequestError}</Text> : null}
              {interestError ? <Text accessibilityRole="alert" style={styles.error} testID="status-discover-interest-error">{interestError}</Text> : null}
              {feedbackError ? <Text accessibilityRole="alert" style={styles.error} testID="status-discover-feedback-error">{feedbackError}</Text> : null}
            </View>
            <View style={[styles.card, { backgroundColor: colors.card }]} testID="card-discover-profile">
              <View style={styles.cardTop}>
                <View style={styles.cardHeading}>
                  <Text style={[styles.eyebrow, { color: colors.lime }]}>YOUR ORBIT HISTORY</Text>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Profile insights</Text>
                </View>
                {actionButton('profile', 'Load profile', 'button-discover-profile-load')}
              </View>
              {errors.profile ? <Text accessibilityRole="alert" testID="status-discover-profile-error" style={styles.error}>{errors.profile}</Text> : null}
              {profile ? (
                <View testID="content-discover-profile">
                  <Text style={styles.body}>Based on {profile.total_visits} server-recorded visits · {profile.resolved_visits} resolved.</Text>
                  {profile.total_visits === 0 ? <Text style={styles.notice} testID="status-discover-no-history">No server visits are available yet. If you have uploaded points, run visit analysis above; if not, restore or manually back up local history first. Analysis only works from points already in Orbit.</Text> : null}
                  {generatedAt(profile.generated_at) ? <Text style={styles.meta}>Generated {generatedAt(profile.generated_at)}</Text> : null}
                  {interests.length ? interests.map((interest, index) => (
                    <View key={`${interest.category}-${index}`} style={[styles.dataRow, { borderTopColor: colors.border }]}>
                      <Text style={styles.rowTitle}>{interest.category}{interest.hidden ? ' · hidden' : ''}</Text>
                      <Text style={styles.meta}>{interest.visits} visits · {interest.dwell_minutes} min · weight {interest.weight.toFixed(2)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${interest.hidden ? 'Show' : 'Hide'} ${interest.category} interest`}
                        testID={`button-discover-interest-${index}`}
                        disabled={isBusy || interestPending !== null}
                        onPress={() => void updateInterest(interest)}
                        style={({ pressed }) => [styles.feedbackButton, { borderColor: colors.border }, (isBusy || interestPending !== null) && styles.disabled, pressed && !isBusy && styles.pressed]}
                      >
                        <Text style={[styles.feedbackButtonText, { color: colors.lime }]}>
                          {interestPending === interest.category ? 'Updating…' : interest.hidden ? 'Unhide interest' : 'Hide interest'}
                        </Text>
                      </Pressable>
                    </View>
                  )) : <Text style={styles.empty} testID="empty-discover-interests">No server interest profile is available yet.</Text>}
                  {profile.top_places.length ? (
                    <View style={styles.subsection}>
                      <Text style={styles.subheading}>Top places in your account</Text>
                      {profile.top_places.map(place => <Text key={place.place_id} style={styles.body}>{place.name ?? place.category} · {place.visits} visits</Text>)}
                    </View>
                  ) : null}
                </View>
              ) : loaded.profile ? <Text style={styles.empty} testID="empty-discover-profile">No server profile data is available yet.</Text> : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card }]} testID="card-discover-recommendations">
              <View style={styles.cardTop}>
                <View style={styles.cardHeading}>
                  <Text style={[styles.eyebrow, { color: colors.lime }]}>BASED ON SERVER HISTORY</Text>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Recommendations</Text>
                </View>
                {actionButton('recommendations', 'Get ideas', 'button-discover-recommendations')}
              </View>
              <Text style={styles.body}>Recommendations depend on server visit analysis and may be empty or unavailable until the server has processed your history.</Text>
              {errors.recommendations ? <Text accessibilityRole="alert" testID="status-discover-recommendations-error" style={styles.error}>{errors.recommendations}</Text> : null}
              {visibleRecommendations.length ? visibleRecommendations.map((item, index) => (
                <View key={`${item.place.id}-${index}`} style={[styles.dataRow, { borderTopColor: colors.border }]} testID={`row-discover-recommendation-${index}`}>
                  <Text style={styles.rowTitle}>{item.place.name ?? item.place.category}</Text>
                  <Text style={styles.body}>{item.reason}</Text>
                  <Text style={styles.meta}>Server score {item.score.toFixed(2)}</Text>
                  {feedbackAck[item.place.id]?.kind === 'saved' ? <Text accessibilityLiveRegion="polite" style={styles.notice} testID={`status-discover-feedback-${item.place.id}`}>Save feedback acknowledged by Orbit. This is not a saved-items list.</Text> : null}
                  <View style={styles.feedbackActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send save feedback for ${item.place.name ?? item.place.category}`}
                      testID={`button-discover-save-${item.place.id}`}
                      disabled={isBusy || feedbackPending !== null || feedbackAck[item.place.id]?.kind === 'saved'}
                      onPress={() => void sendFeedback(item.place.id, 'saved')}
                      style={({ pressed }) => [styles.feedbackButton, { borderColor: colors.border }, (isBusy || feedbackPending !== null || feedbackAck[item.place.id]?.kind === 'saved') && styles.disabled, pressed && !isBusy && styles.pressed]}
                    >
                      <Text style={[styles.feedbackButtonText, { color: colors.lime }]}>{feedbackPending === item.place.id ? 'Sending…' : feedbackAck[item.place.id]?.kind === 'saved' ? 'Save feedback sent' : 'Send save feedback'}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send dismiss feedback for ${item.place.name ?? item.place.category}`}
                      testID={`button-discover-dismiss-${item.place.id}`}
                      disabled={isBusy || feedbackPending !== null}
                      onPress={() => void sendFeedback(item.place.id, 'dismissed')}
                      style={({ pressed }) => [styles.feedbackButton, { borderColor: colors.border }, (isBusy || feedbackPending !== null) && styles.disabled, pressed && !isBusy && styles.pressed]}
                    >
                      <Text style={[styles.feedbackButtonText, { color: colors.foreground }]}>{feedbackPending === item.place.id ? 'Sending…' : 'Send dismiss feedback'}</Text>
                    </Pressable>
                  </View>
                </View>
              )) : null}
              {loaded.recommendations && !visibleRecommendations.length && !Object.keys(recentlyDismissed).length ? <Text style={styles.empty} testID="empty-discover-recommendations">No server recommendations are available yet.</Text> : null}
              {loaded.recommendations && !visibleRecommendations.length && Object.keys(recentlyDismissed).length > 0 ? <Text style={styles.empty} testID="empty-discover-recommendations">No active server recommendations remain. You can still reverse a recent dismissal below.</Text> : null}
              {Object.values(recentlyDismissed).map(item => (
                <View key={`recent-dismissed-${item.place.id}`} style={[styles.recentDismissed, { borderColor: colors.border }]} testID={`card-recently-dismissed-${item.place.id}`}>
                  <View style={styles.recentDismissedCopy}>
                    <Text style={styles.rowTitle}>Recently dismissed: {item.place.name ?? item.place.category}</Text>
                    <Text style={styles.meta}>{feedbackAck[item.place.id]?.message ?? 'Dismiss feedback acknowledged by Orbit.'} The recently dismissed item is kept on this screen so you can send save feedback to show it again.</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${item.place.name ?? item.place.category} again and send save feedback`}
                    testID={`button-discover-show-again-${item.place.id}`}
                    disabled={isBusy}
                    onPress={() => void sendFeedback(item.place.id, 'saved')}
                    style={({ pressed }) => [styles.feedbackButton, { borderColor: colors.border }, isBusy && styles.disabled, pressed && !isBusy && styles.pressed]}
                  >
                    <Text style={[styles.feedbackButtonText, { color: colors.lime }]}>{feedbackPending === item.place.id ? 'Sending…' : 'Show again & save'}</Text>
                  </Pressable>
                </View>
              ))}
              {recommendations && generatedAt(recommendations.generated_at) ? <Text style={styles.meta}>Generated {generatedAt(recommendations.generated_at)}</Text> : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card }]} testID="card-discover-predictions">
              <View style={styles.cardTop}>
                <View style={styles.cardHeading}>
                  <Text style={[styles.eyebrow, { color: colors.lime }]}>SERVER PREDICTIONS</Text>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Possible next places</Text>
                </View>
                {actionButton('nextPlace', 'Load predictions', 'button-discover-predictions')}
              </View>
              {errors.nextPlace ? <Text accessibilityRole="alert" testID="status-discover-predictions-error" style={styles.error}>{errors.nextPlace}</Text> : null}
              {nextPlaces?.predictions.length ? nextPlaces.predictions.map((item, index) => (
                <View key={`${item.place.id}-${index}`} style={[styles.dataRow, { borderTopColor: colors.border }]} testID={`row-discover-prediction-${index}`}>
                  <Text style={styles.rowTitle}>{item.place.name ?? item.place.category}</Text>
                  <Text style={styles.meta}>Rank {item.rank} · {Math.round(item.probability * 100)}% server-estimated probability</Text>
                </View>
              )) : null}
              {loaded.nextPlace && !nextPlaces?.predictions.length ? <Text style={styles.empty} testID="empty-discover-predictions">No server predictions are available yet.</Text> : null}
              {nextPlaces && generatedAt(nextPlaces.generated_at) ? <Text style={styles.meta}>Generated {generatedAt(nextPlaces.generated_at)}</Text> : null}
            </View>
            {cloud.error ? <Text accessibilityRole="alert" testID="status-discover-error" style={styles.error}>{cloud.error}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 74, paddingHorizontal: 17, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 39, height: 44, justifyContent: 'center' },
  headerCopy: { flex: 1 },
  kicker: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 1.5 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -1, marginTop: 3 },
  content: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 17, paddingTop: 17, gap: 14 },
  info: { borderRadius: 13, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  infoText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  card: { borderRadius: 16, padding: 17, gap: 12 },
  loadingCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardHeading: { flex: 1, gap: 5 },
  eyebrow: { fontFamily: 'Inter_500Medium', fontSize: 8, letterSpacing: 1.3 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.7 },
  action: { minHeight: 40, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
  body: { color: nativePalette.foregroundSoft, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  meta: { color: nativePalette.foregroundQuiet, fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 16, marginTop: 3 },
  dataRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11, marginTop: 3 },
  jobStatus: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  jobStatusCopy: { flex: 1 },
  refreshing: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: { color: nativePalette.foregroundSoft, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17 },
  feedbackActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  feedbackButton: { minHeight: 37, justifyContent: 'center', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  feedbackButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  recentDismissed: { borderWidth: 1, borderRadius: 11, padding: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  recentDismissedCopy: { flex: 1, gap: 2 },
  rowTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  empty: { color: nativePalette.foregroundSoft, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19 },
  subsection: { marginTop: 9, gap: 7 },
  subheading: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 2 },
  error: { color: nativePalette.foregroundError, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 19 },
  link: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
});