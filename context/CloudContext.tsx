import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useLocation } from '@/context/LocationContext';
import { cloudApi, CloudApiError, isCloudConfigured, type CloudExport, type CloudJob, type EnqueuedCloudJob, type CloudNextPlaces, type CloudProfile, type CloudRecommendations, type CloudUser } from '@/services/cloudApi';
import { enqueueAnalysisAfterBackup, fromCloudPoint, mayUploadBackup, splitIntoChunks, toCloudPoint } from '@/services/cloudData.mjs';
import { cloudSession, cloudSessionAvailable } from '@/services/cloudSession';
import { getHistoryGeneration, loadCloudBackupPoints, loadHistory, mergeCloudRestorePoints } from '@/services/locationStore';

export type CloudStatus = 'checking' | 'signedOut' | 'ready' | 'busy' | 'disabled';
export type DiscoverRequest = 'profile' | 'recommendations' | 'nextPlace' | 'recomputeVisits' | 'job';
export type DiscoverResult = CloudProfile | CloudRecommendations | CloudNextPlaces | CloudJob | EnqueuedCloudJob;
export type CloudBackupResult = {
  uploaded: number;
  inserted: number;
  duplicates: number;
  analysisJobId: string | null;
  analysisError: string | null;
};
export type CloudAnalysisJobState = { job_id: string; status: CloudJob['status'] } | null;

export type CloudContextValue = {
  status: CloudStatus;
  user: CloudUser | null;
  consentEnabled: boolean;
  error: string | null;
  lastBackup: CloudBackupResult | null;
  lastRestore: { received: number; inserted: number } | null;
  lastAnalysisJob: CloudAnalysisJobState;
  register: (email: string, password: string) => Promise<CloudUser>;
  login: (email: string, password: string) => Promise<CloudUser>;
  logout: () => Promise<void>;
  enableConsent: () => Promise<void>;
  disableConsent: () => Promise<void>;
  backup: () => Promise<CloudBackupResult>;
  restore: () => Promise<{ received: number; inserted: number }>;
  deleteCloudAccount: () => Promise<void>;
  requestDiscover: (request: DiscoverRequest, jobId?: string) => Promise<DiscoverResult>;
  updateInterest: (category: string, hidden: boolean) => Promise<CloudProfile>;
  sendRecommendationFeedback: (placeId: number, action: 'saved' | 'dismissed') => Promise<void>;
  clearError: () => void;
};

const CloudContext = createContext<CloudContextValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const { state: tracking, activateRestoredHistory } = useLocation();
  const configured = isCloudConfigured();
  const cloudAvailable = cloudSessionAvailable && configured && Platform.OS !== 'web';
  const [status, setStatus] = useState<CloudStatus>(cloudAvailable ? 'checking' : 'disabled');
  const [user, setUser] = useState<CloudUser | null>(null);
  const [consentEnabled, setConsentEnabled] = useState(false);
  const consentRef = useRef(false);
  const consentVersion = useRef(0);
  const [error, setError] = useState<string | null>(() => !configured
    ? 'Cloud backup is disabled because this build has no valid cloud API URL.'
    : Platform.OS === 'web' ? 'Cloud account features are disabled in the browser.' : null);
  const [lastBackup, setLastBackup] = useState<CloudContextValue['lastBackup']>(null);
  const [lastRestore, setLastRestore] = useState<CloudContextValue['lastRestore']>(null);
  const [lastAnalysisJob, setLastAnalysisJob] = useState<CloudAnalysisJobState>(null);
  const backupRunning = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const sessionCheck = useRef<AbortController | null>(null);
  const deletingAccount = useRef(false);
  const activeOperations = useRef(new Set<{ controller: AbortController; done: Promise<void>; finish: () => void }>());
  const epoch = useRef(0);

  const cancelOperations = useCallback(() => {
    epoch.current++;
    for (const active of activeOperations.current) active.controller.abort();
    operation.current?.abort();
    sessionCheck.current?.abort();
    sessionCheck.current = null;
    operation.current = null;
  }, []);
  const beginOperation = useCallback(() => {
    cancelOperations();
    const controller = new AbortController();
    operation.current = controller;
    const currentEpoch = epoch.current;
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const active = { controller, done, finish: () => resolveDone() };
    activeOperations.current.add(active);
    setStatus('busy');
    setError(null);
    return {
      controller,
      isCurrent: () => epoch.current === currentEpoch && !controller.signal.aborted,
      finish: () => {
        activeOperations.current.delete(active);
        active.finish();
        if (epoch.current === currentEpoch) operation.current = null;
      },
    };
  }, [cancelOperations, user]);

  const getCurrentToken = useCallback(async (): Promise<string> => {
    if (!user || !cloudAvailable) throw new Error('Sign in to a verified cloud account first.');
    const token = await cloudSession.getToken();
    const storedAccount = await cloudSession.getAccountId();
    if (!token || storedAccount !== user.id) throw new Error('Your cloud session is no longer available. Sign in again.');
    return token;
  }, [cloudAvailable, user]);

  const handleCloudFailure = useCallback(async (cause: unknown, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    const message = cause instanceof Error ? cause.message : 'Cloud request failed.';
    if (cause instanceof CloudApiError && cause.code === 'unauthorized') {
      if (!isCurrent()) return;
      setUser(null);
      consentVersion.current++;
      consentRef.current = false;
      setConsentEnabled(false);
      setStatus('signedOut');
      try {
        await cloudSession.clearSession();
        setError(message);
      } catch (clearError) {
        setError(`${message} ${clearError instanceof Error ? clearError.message : 'Local credential cleanup failed.'}`);
      }
      return;
    }
    setError(message);
    setStatus(user ? 'ready' : 'signedOut');
  }, [user]);

  useEffect(() => {
    if (!cloudAvailable) return;
    let alive = true;
    const checkController = new AbortController();
    const checkEpoch = epoch.current;
    sessionCheck.current = checkController;
    void (async () => {
      try {
        const token = await cloudSession.getToken();
        const accountId = await cloudSession.getAccountId();
        if (!alive || checkEpoch !== epoch.current) return;
        if (!token || accountId === null) {
          if (alive) setStatus('signedOut');
          return;
        }
        const verified = await cloudApi.me(token, checkController.signal);
        if (!alive || checkEpoch !== epoch.current) return;
        if (verified.id !== accountId) throw new Error('Saved cloud account did not match the verified account.');
        const consent = await cloudSession.hasConsent(verified.id);
        if (alive && checkEpoch === epoch.current) {
          setUser(verified);
          consentRef.current = consent;
          setConsentEnabled(consent);
          setStatus('ready');
        }
      } catch (cause) {
        const invalidSession = (cause instanceof CloudApiError && cause.code === 'unauthorized') ||
          (cause instanceof Error && cause.message.includes('did not match'));
        let clearFailure: unknown = null;
        if (invalidSession && alive && checkEpoch === epoch.current) {
          try { await cloudSession.clearSession(); }
          catch (error) { clearFailure = error; }
        }
        if (alive && checkEpoch === epoch.current) {
          setUser(null);
          consentRef.current = false;
          setConsentEnabled(false);
          setStatus('signedOut');
          const detail = invalidSession
            ? 'Your saved cloud session is no longer valid. Please sign in again.'
            : cause instanceof Error ? cause.message : 'Your saved cloud session could not be verified.';
          setError(clearFailure instanceof Error ? `${detail} ${clearFailure.message}` : detail);
        }
      } finally {
        if (sessionCheck.current === checkController) sessionCheck.current = null;
      }
    })();
    return () => { alive = false; checkController.abort(); cancelOperations(); };
  }, [cancelOperations, cloudAvailable]);

  const authenticate = useCallback(async (kind: 'register' | 'login', email: string, password: string) => {
    if (!cloudAvailable) throw new Error('Cloud account features are disabled or the cloud API URL is not configured.');
    const op = beginOperation();
    try {
      const auth = kind === 'register'
        ? await cloudApi.register(email.trim(), password, op.controller.signal)
        : await cloudApi.login(email.trim(), password, op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud sign-in was cancelled.');
      const verified = await cloudApi.me(auth.access_token, op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud sign-in was cancelled.');
      await cloudSession.saveSession(auth.access_token, verified.id);
      if (!op.isCurrent()) throw new Error('Cloud sign-in was cancelled.');
      const hasConsent = await cloudSession.hasConsent(verified.id);
      if (!op.isCurrent()) throw new Error('Cloud sign-in was cancelled.');
      setUser(verified);
      consentVersion.current++;
      consentRef.current = hasConsent;
      setConsentEnabled(hasConsent);
      setLastBackup(null);
      setLastRestore(null);
      setLastAnalysisJob(null);
      setStatus('ready');
      return verified;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not sign in to cloud backup.';
      if (op.isCurrent()) {
        setError(message);
        setStatus(user ? 'ready' : 'signedOut');
      }
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      op.finish();
    }
  }, [beginOperation, cloudAvailable, user]);

  const register = useCallback((email: string, password: string) => authenticate('register', email, password), [authenticate]);
  const login = useCallback((email: string, password: string) => authenticate('login', email, password), [authenticate]);

  const logout = useCallback(async () => {
    cancelOperations();
    consentVersion.current++;
    consentRef.current = false;
    try {
      await cloudSession.clearSession();
    } finally {
      setUser(null);
      setConsentEnabled(false);
      setLastBackup(null);
      setLastRestore(null);
      setLastAnalysisJob(null);
      setError(null);
      setStatus(cloudAvailable ? 'signedOut' : 'disabled');
    }
  }, [cancelOperations, cloudAvailable]);

  const enableConsent = useCallback(async () => {
    if (!user || status === 'disabled') throw new Error('Sign in before enabling optional cloud backup.');
    await cloudSession.setConsent(user.id, true);
    consentVersion.current++;
    consentRef.current = true;
    setConsentEnabled(true);
    setError(null);
  }, [status, user]);

  const disableConsent = useCallback(async () => {
    consentVersion.current++;
    consentRef.current = false;
    cancelOperations();
    setConsentEnabled(false);
    setStatus(user ? 'ready' : 'signedOut');
    setError(backupRunning.current
      ? 'Cloud backup was stopped. Completed batches may already be stored in the cloud and cannot be recalled by cancelling.'
      : null);
    if (user) await cloudSession.setConsent(user.id, false);
  }, [cancelOperations, user]);

  const backup = useCallback(async () => {
    if (!mayUploadBackup({ authenticated: !!user, consentEnabled: consentRef.current && consentEnabled, trackingMode: tracking.mode })) {
      throw new Error('Enable cloud backup consent for this account and use recorded local history. Demo data is never uploaded.');
    }
    if (!tracking.ready) throw new Error('Local history is not ready to back up yet.');
    const backupConsentVersion = consentVersion.current;
    const backupHistoryGeneration = getHistoryGeneration();
    const op = beginOperation();
    backupRunning.current = true;
    let uploaded = 0;
    let inserted = 0;
    let duplicates = 0;
    let analysisJobId: string | null = null;
    let analysisError: string | null = null;
    const currentAndConsented = () => op.isCurrent() && consentRef.current &&
      consentVersion.current === backupConsentVersion && getHistoryGeneration() === backupHistoryGeneration;
    try {
      if (!currentAndConsented()) throw new Error('Cloud backup was cancelled because consent or local history changed.');
      const token = await getCurrentToken();
      const local = await loadHistory();
      if (!currentAndConsented()) throw new Error('Cloud backup was cancelled because consent or local history changed.');
      if (local.preferences.mode !== 'real') throw new Error('Demo data is never uploaded. Switch to recorded local history before backing up.');
      const points = (await loadCloudBackupPoints()).map(toCloudPoint);
      if (!currentAndConsented()) throw new Error('Cloud backup was cancelled because consent or local history changed.');
      setLastBackup({ uploaded, inserted, duplicates, analysisJobId: null, analysisError: null });
      for (const batch of splitIntoChunks(points, 1000)) {
        if (!currentAndConsented()) throw new Error('Cloud backup stopped because consent or local history changed.');
        const freshPreferences = await loadHistory();
        if (!currentAndConsented()) throw new Error('Cloud backup stopped because consent or local history changed.');
        if (freshPreferences.preferences.mode !== 'real') {
          throw new Error('Demo data is never uploaded. Switch to recorded local history before backing up.');
        }
        const result = await cloudApi.uploadPoints(token, batch, op.controller.signal);
        inserted += result.inserted;
        duplicates += result.duplicates;
        uploaded += batch.length;
        if (op.isCurrent()) setLastBackup({ uploaded, inserted, duplicates, analysisJobId: null, analysisError: null });
      }
      if (!currentAndConsented()) throw new Error('Cloud backup stopped because consent or local history changed.');
      setLastAnalysisJob(null);
      if (uploaded > 0) {
        const analysis = await enqueueAnalysisAfterBackup(uploaded, () => cloudApi.recomputeVisits(token, op.controller.signal));
        analysisJobId = analysis.analysisJobId;
        analysisError = analysis.analysisError;
        if (analysis.cause && op.isCurrent()) {
          await handleCloudFailure(analysis.cause, op.isCurrent);
          setError(`Points were backed up, but visit analysis could not be queued: ${analysisError}`);
        }
      }
      const result = { uploaded, inserted, duplicates, analysisJobId, analysisError };
      if (op.isCurrent()) {
        setLastBackup(result);
        if (analysisJobId) setLastAnalysisJob({ job_id: analysisJobId, status: 'queued' });
        if (!analysisError) setStatus('ready');
      }
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Cloud backup failed.';
      await handleCloudFailure(cause, op.isCurrent);
      if (op.isCurrent() && uploaded > 0) {
        setError(`${message} Partial backup: the server acknowledged ${uploaded} points in completed batches. Those batches cannot be recalled by cancelling.`);
      }
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      backupRunning.current = false;
      op.finish();
    }
  }, [beginOperation, consentEnabled, getCurrentToken, handleCloudFailure, tracking.mode, tracking.ready, user]);

  const restore = useCallback(async () => {
    if (!user || !consentEnabled) throw new Error('Enable cloud backup consent for this account before restoring.');
    const op = beginOperation();
    try {
      const token = await getCurrentToken();
      const exported: CloudExport = await cloudApi.exportAll(token, op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud restore was cancelled.');
      if (exported.user.id !== user.id) throw new Error('The cloud export belongs to a different account.');
      const incoming = exported.points.map(point => fromCloudPoint(point));
      const inserted = await mergeCloudRestorePoints(incoming, op.isCurrent);
      if (!op.isCurrent()) throw new Error('Cloud restore was cancelled.');
      if (incoming.length > 0) {
        await activateRestoredHistory();
        if (!op.isCurrent()) throw new Error('Cloud restore was cancelled.');
      }
      const result = { received: incoming.length, inserted };
      setLastRestore(result);
      setStatus('ready');
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Cloud restore failed.';
      await handleCloudFailure(cause, op.isCurrent);
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      op.finish();
    }
  }, [activateRestoredHistory, beginOperation, consentEnabled, getCurrentToken, handleCloudFailure, user]);

  const deleteCloudAccount = useCallback(async () => {
    if (!user) throw new Error('Sign in before deleting the cloud account.');
    if (deletingAccount.current) throw new Error('Cloud account deletion is already in progress.');
    deletingAccount.current = true;
    const pendingOperations = [...activeOperations.current].map(active => active.done);
    cancelOperations();
    await Promise.all(pendingOperations);
    const controller = new AbortController();
    operation.current = controller;
    const deletionEpoch = epoch.current;
    setStatus('busy');
    setError(null);
    let cloudAccountDeleted = false;
    try {
      const token = await cloudSession.getToken();
      if (!token || await cloudSession.getAccountId() !== user.id) throw new Error('Your cloud session is no longer available.');
      await cloudApi.deleteAccount(token, controller.signal);
      if (epoch.current !== deletionEpoch || controller.signal.aborted) throw new Error('Cloud account deletion was cancelled.');
      cloudAccountDeleted = true;
      setUser(null);
      consentVersion.current++;
      consentRef.current = false;
      setConsentEnabled(false);
      setLastBackup(null);
      setLastRestore(null);
      setLastAnalysisJob(null);
      setStatus('signedOut');
      await cloudSession.clearSession();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Cloud account deletion failed.';
      if (epoch.current === deletionEpoch) {
        if (cloudAccountDeleted) {
          setUser(null);
          consentVersion.current++;
          consentRef.current = false;
          setConsentEnabled(false);
          setStatus('signedOut');
          setError(`Cloud account was deleted, but local credential cleanup needs attention. ${message}`);
        } else if (cause instanceof CloudApiError && cause.code === 'unauthorized') {
          setUser(null);
          consentVersion.current++;
          consentRef.current = false;
          setConsentEnabled(false);
          setStatus('signedOut');
          try {
            await cloudSession.clearSession();
            setError(message);
          } catch (clearError) {
            setError(`${message} ${clearError instanceof Error ? clearError.message : 'Local credential cleanup failed.'}`);
          }
        } else {
          setError(message);
          setStatus('ready');
        }
      }
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      if (epoch.current === deletionEpoch) operation.current = null;
      deletingAccount.current = false;
    }
  }, [cancelOperations, user]);

  const requestDiscover = useCallback(async (request: DiscoverRequest, jobId?: string): Promise<DiscoverResult> => {
    const op = beginOperation();
    try {
      if (request === 'job' && !jobId?.trim()) throw new Error('A job ID is required to check cloud processing status.');
      const token = await getCurrentToken();
      const result = request === 'profile'
        ? await cloudApi.getProfile(token, op.controller.signal)
        : request === 'recommendations'
          ? await cloudApi.getRecommendations(token, op.controller.signal)
          : request === 'nextPlace'
            ? await cloudApi.getNextPlace(token, op.controller.signal)
            : request === 'recomputeVisits'
              ? await cloudApi.recomputeVisits(token, op.controller.signal)
              : await cloudApi.getJob(token, jobId?.trim() ?? '', op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud request was cancelled.');
      if (request === 'recomputeVisits' && 'job_id' in result) {
        setLastAnalysisJob({ job_id: result.job_id, status: 'queued' });
      } else if (request === 'job' && 'id' in result) {
        setLastAnalysisJob({ job_id: result.id, status: result.status });
      }
      setStatus('ready');
      return result;
    } catch (cause) {
      await handleCloudFailure(cause, op.isCurrent);
      throw cause instanceof Error ? cause : new Error('Cloud request failed.');
    } finally {
      op.finish();
    }
  }, [beginOperation, getCurrentToken, handleCloudFailure]);

  const updateInterest = useCallback(async (category: string, hidden: boolean): Promise<CloudProfile> => {
    const op = beginOperation();
    try {
      const token = await getCurrentToken();
      const profile = await cloudApi.updateInterest(token, category, hidden, op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud request was cancelled.');
      setStatus('ready');
      return profile;
    } catch (cause) {
      await handleCloudFailure(cause, op.isCurrent);
      throw cause instanceof Error ? cause : new Error('Cloud interest update failed.');
    } finally {
      op.finish();
    }
  }, [beginOperation, getCurrentToken, handleCloudFailure]);

  const sendRecommendationFeedback = useCallback(async (
    placeId: number,
    action: 'saved' | 'dismissed',
  ): Promise<void> => {
    const op = beginOperation();
    try {
      const token = await getCurrentToken();
      await cloudApi.sendRecommendationFeedback(token, placeId, action, op.controller.signal);
      if (!op.isCurrent()) throw new Error('Cloud request was cancelled.');
      setStatus('ready');
    } catch (cause) {
      await handleCloudFailure(cause, op.isCurrent);
      throw cause instanceof Error ? cause : new Error('Recommendation feedback failed.');
    } finally {
      op.finish();
    }
  }, [beginOperation, getCurrentToken, handleCloudFailure]);

  const clearError = useCallback(() => setError(null), []);
  const value = useMemo<CloudContextValue>(() => ({
    status, user, consentEnabled, error, lastBackup, lastRestore, lastAnalysisJob,
    register, login, logout, enableConsent, disableConsent, backup, restore,
    deleteCloudAccount, requestDiscover, updateInterest, sendRecommendationFeedback, clearError,
  }), [status, user, consentEnabled, error, lastBackup, lastRestore, lastAnalysisJob, register, login, logout, enableConsent, disableConsent, backup, restore, deleteCloudAccount, requestDiscover, updateInterest, sendRecommendationFeedback, clearError]);
  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudContextValue {
  const context = useContext(CloudContext);
  if (!context) throw new Error('useCloud must be used within CloudProvider.');
  return context;
}