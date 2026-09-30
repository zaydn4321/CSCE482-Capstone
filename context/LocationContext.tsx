import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Linking, Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BACKGROUND_LOCATION_TASK } from '@/services/backgroundLocationTask';
import { deleteHistory, insertLocation, loadHistory, releaseHistoryClear, removeTimelineImport, reserveHistoryClear, savePlaceName, savePreferences, saveTimelineImport, type TimelineImportMetadata } from '@/services/locationStore';
import { processPlaces, processVisits, type ProcessedPlace, type RawLocation, type Visit } from '@/services/visitProcessor';
import { calculateStatistics, type Statistics } from '@/services/statisticsService';
import { parseGoogleTimelineText } from '@/services/googleTimeline';

export type LocationRecord = RawLocation;
type Mode = 'new' | 'demo' | 'real';
type Status = 'inactive' | 'requesting' | 'active' | 'paused' | 'denied' | 'unavailable';
export type TrackingState = {
  mode: Mode;
  status: Status;
  records: RawLocation[];
  visits: Visit[];
  places: ProcessedPlace[];
  statistics: Statistics;
  lastUpdate: number | null;
  error: string | null;
  canAskAgain: boolean;
  ready: boolean;
  backgroundEnabled: boolean;
  backgroundAvailable: boolean;
  imports: TimelineImportMetadata[];
};

type LocationContextValue = {
  state: TrackingState;
  requestAccess: () => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<boolean>;
  clearHistory: () => Promise<void>;
  startDemo: () => void;
  openSettings: () => Promise<void>;
  enableBackground: () => Promise<boolean>;
  disableBackground: () => Promise<void>;
  renamePlace: (placeId: string, name: string | null) => Promise<void>;
  importTimeline: (text: string, filename: string) => Promise<TimelineImportMetadata>;
  removeImport: (id: string) => Promise<void>;
};

function derive(records: RawLocation[], placeNames: Record<string, string> = {}) {
  const visits = processVisits(records);
  const places = processPlaces(visits).map(place => ({
    ...place,
    ...(placeNames[place.id] ? { name: placeNames[place.id] } : {}),
  }));
  return { records, visits, places, statistics: calculateStatistics(records, visits, places), lastUpdate: records.at(-1)?.timestamp ?? null };
}

const emptyData = derive([]);
const initialState: TrackingState = {
  mode: 'new', status: 'inactive', ...emptyData, error: null,
  canAskAgain: true, ready: false, backgroundEnabled: false, backgroundAvailable: false,
  imports: [],
};
const LocationContext = createContext<LocationContextValue | null>(null);

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('service') || message.includes('disabled')) return 'Location services are off. Turn them on in device Settings and try again.';
  return 'Location tracking could not start. Check device Settings and try again.';
}

const taskOptions: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 120_000,
  distanceInterval: 50,
  deferredUpdatesInterval: 120_000,
  deferredUpdatesDistance: 100,
  pausesUpdatesAutomatically: true,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Location Wrapped is tracking',
    notificationBody: 'Tracking your places in the background. Pause anytime in Profile.',
  },
};

export function LocationProvider({ children }: { children: ReactNode }) {
  const [, requestForeground] = Location.useForegroundPermissions();
  const [state, setState] = useState<TrackingState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const watch = useRef<Location.LocationSubscription | null>(null);
  const generation = useRef(0);
  const clearingHistory = useRef(false);
  const deletionEpoch = useRef(0);
  const appState = useRef(AppState.currentState);

  const stopForeground = useCallback(() => {
    generation.current++;
    watch.current?.remove();
    watch.current = null;
  }, []);

  const stopBackground = useCallback(async () => {
    if (Platform.OS === 'web' || !(await TaskManager.isAvailableAsync())) return;
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  }, []);

  const refreshRecords = useCallback(async (expectedDeletionEpoch?: number) => {
    const current = generation.current;
    const { records, placeNames, imports } = await loadHistory();
    if (expectedDeletionEpoch !== undefined &&
      (clearingHistory.current || expectedDeletionEpoch !== deletionEpoch.current)) {
      throw new Error('Location history was cleared before the imported data could be refreshed.');
    }
    if (!clearingHistory.current && current === generation.current) {
      setState(previous => ({ ...previous, ...derive(records, placeNames), imports }));
    } else if (expectedDeletionEpoch !== undefined) {
      setState(previous => ({ ...previous, ...derive(records, placeNames), imports }));
    }
  }, []);

  const startForeground = useCallback(async (): Promise<boolean> => {
    stopForeground();
    if (Platform.OS === 'web' || appState.current !== 'active') return false;
    const current = generation.current;
    const epoch = deletionEpoch.current;
    try {
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 35 },
        position => {
          if (generation.current !== current) return;
          const point = {
            lat: position.coords.latitude, lng: position.coords.longitude,
            timestamp: position.timestamp, accuracy: position.coords.accuracy ?? Infinity,
          };
          void insertLocation(point).then(inserted => {
            if (inserted) return refreshRecords();
          }).catch(error => {
            stopForeground();
            void savePreferences({ mode: 'real', wantedActive: false, backgroundEnabled: false });
            setState(previous => ({ ...previous, status: 'inactive', error: `Location history could not be saved. ${readableError(error)}` }));
          });
        },
        error => {
          if (generation.current !== current) return;
          stopForeground();
          setState(previous => ({ ...previous, status: 'inactive', error: readableError(error) }));
        },
      );
      if (generation.current !== current || deletionEpoch.current !== epoch || clearingHistory.current) { subscription.remove(); return false; }
      watch.current = subscription;
      setState(previous => ({ ...previous, status: 'active', error: null }));
      return true;
    } catch (error) {
      if (generation.current === current) setState(previous => ({ ...previous, status: 'inactive', error: readableError(error) }));
      return false;
    }
  }, [refreshRecords, stopForeground]);

  const startBackground = useCallback(async (): Promise<boolean> => {
    const epoch = deletionEpoch.current;
    if (Platform.OS === 'web' || !(await TaskManager.isAvailableAsync())) return false;
    if (clearingHistory.current || deletionEpoch.current !== epoch) return false;
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, taskOptions);
      }
      if (clearingHistory.current || deletionEpoch.current !== epoch) {
        await stopBackground();
        return false;
      }
      stopForeground();
      setState(previous => ({ ...previous, status: 'active', error: null, backgroundEnabled: true }));
      return true;
    } catch (error) {
      setState(previous => ({ ...previous, backgroundAvailable: false, error: `Background tracking could not start on this build. ${readableError(error)}` }));
      return false;
    }
  }, [stopBackground, stopForeground]);

  const reconcile = useCallback(async () => {
    if (clearingHistory.current) return;
    const epoch = deletionEpoch.current;
    const stillCurrent = () => !clearingHistory.current && deletionEpoch.current === epoch;
    if (Platform.OS === 'web') {
      const stored = await loadHistory();
      if (stillCurrent()) setState(previous => ({ ...previous, ...derive(stored.records, stored.placeNames), imports: stored.imports, mode: stored.preferences.mode, ready: true, backgroundAvailable: false }));
      return;
    }
    const stored = await loadHistory();
    if (!stillCurrent()) return;
    const available = await TaskManager.isAvailableAsync();
    const permission = await Location.getForegroundPermissionsAsync();
    const servicesOn = await Location.hasServicesEnabledAsync();
    if (!stillCurrent()) return;
    const prefs = stored.preferences;
    const common = {
      ...derive(stored.records, stored.placeNames), imports: stored.imports, mode: prefs.mode, ready: true,
      backgroundEnabled: prefs.backgroundEnabled, backgroundAvailable: available,
      canAskAgain: permission.canAskAgain,
    };
    if (!prefs.wantedActive || prefs.mode !== 'real') {
      stopForeground();
      await stopBackground();
      if (!stillCurrent()) return;
      setState(previous => ({ ...previous, ...common, status: prefs.mode === 'real' && previous.status === 'paused' ? 'paused' : prefs.mode === 'real' ? 'paused' : 'inactive', error: null }));
      return;
    }
    if (!permission.granted || !servicesOn) {
      stopForeground();
      await stopBackground();
      if (!stillCurrent()) return;
      await savePreferences({ ...prefs, wantedActive: false, backgroundEnabled: false });
      if (!stillCurrent()) return;
      setState(previous => ({
        ...previous, ...common, backgroundEnabled: false, status: !permission.granted ? 'denied' : 'unavailable',
        error: !permission.granted ? 'Location permission was revoked. Enable it in Settings to resume.' : 'Location services are off. Turn them on in Settings to resume.',
      }));
      return;
    }
    setState(previous => ({ ...previous, ...common, status: 'requesting', error: null }));
    if (prefs.backgroundEnabled) {
      const backgroundPermission = await Location.getBackgroundPermissionsAsync();
      if (!stillCurrent()) return;
      if (available && backgroundPermission.granted && await startBackground()) return;
      if (!stillCurrent()) return;
      await stopBackground();
      if (!stillCurrent()) return;
      await savePreferences({ ...prefs, backgroundEnabled: false });
      if (!stillCurrent()) return;
      setState(previous => ({
        ...previous, backgroundEnabled: false,
        error: 'Background access is unavailable or was revoked. Foreground tracking can continue while the app is open.',
      }));
    }
    if (!stillCurrent()) return;
    await startForeground();
  }, [startBackground, startForeground, stopBackground, stopForeground]);

  useEffect(() => {
    let alive = true;
    void reconcile().catch(() => {
      if (alive) setState(previous => ({ ...previous, ready: true, status: 'unavailable', error: 'Saved location history could not be opened.' }));
    });
    const listener = AppState.addEventListener('change', next => {
      appState.current = next;
      if (next !== 'active') {
        stopForeground();
        if (!stateRef.current.backgroundEnabled && stateRef.current.status === 'active') {
          setState(previous => ({ ...previous, status: 'inactive' }));
        }
      } else {
        void reconcile().catch(() => {
          setState(previous => ({ ...previous, status: 'unavailable', error: 'Location status could not be verified.' }));
        });
      }
    });
    return () => { alive = false; listener.remove(); stopForeground(); };
  }, [reconcile, stopForeground]);

  const requestAccess = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') {
      setState(previous => ({ ...previous, status: 'unavailable', error: 'Tracking is available in the iOS and Android app.' }));
      return false;
    }
    stopForeground();
    setState(previous => ({ ...previous, status: 'requesting', error: null }));
    try {
      const permission = await requestForeground();
      if (!permission.granted) {
        setState(previous => ({
          ...previous, status: 'denied', canAskAgain: permission.canAskAgain,
          error: permission.canAskAgain ? 'Location access was denied. Try again or explore the demo.' : 'Enable location access in Settings to start tracking.',
        }));
        return false;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setState(previous => ({ ...previous, status: 'unavailable', error: 'Location services are off. Turn them on in Settings.' }));
        return false;
      }
      const backgroundEnabled = stateRef.current.backgroundEnabled;
      await savePreferences({ mode: 'real', wantedActive: true, backgroundEnabled });
      setState(previous => ({ ...previous, mode: 'real', canAskAgain: true }));
      if (backgroundEnabled && await startBackground()) return true;
      if (backgroundEnabled) {
        await savePreferences({ mode: 'real', wantedActive: true, backgroundEnabled: false });
        setState(previous => ({ ...previous, backgroundEnabled: false }));
      }
      return startForeground();
    } catch (error) {
      setState(previous => ({ ...previous, status: 'inactive', error: readableError(error) }));
      return false;
    }
  }, [requestForeground, startBackground, startForeground, stopForeground]);

  const pause = useCallback(async () => {
    stopForeground();
    setState(previous => ({ ...previous, status: 'paused', error: null }));
    try {
      await savePreferences({ mode: 'real', wantedActive: false, backgroundEnabled: stateRef.current.backgroundEnabled });
      await stopBackground();
    } catch {
      setState(previous => ({ ...previous, status: 'unavailable', error: 'Tracking could not be paused safely. Check device Settings.' }));
    }
  }, [stopBackground, stopForeground]);

  const resume = useCallback(async () => requestAccess(), [requestAccess]);

  const enableBackground = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web' || !(await TaskManager.isAvailableAsync())) {
      setState(previous => ({ ...previous, backgroundAvailable: false, error: 'Background tracking needs a development build; Expo Go does not support it.' }));
      return false;
    }
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) {
      setState(previous => ({ ...previous, status: 'denied', canAskAgain: foreground.canAskAgain, error: 'Allow location access before enabling background tracking.' }));
      return false;
    }
    try {
      const background = await Location.requestBackgroundPermissionsAsync();
      if (!background.granted) {
        setState(previous => ({ ...previous, error: 'Background access was not allowed. Foreground tracking remains available; enable Always access in Settings to try again.' }));
        return false;
      }
      if (!(await startBackground())) return false;
      await savePreferences({ mode: 'real', wantedActive: true, backgroundEnabled: true });
      setState(previous => ({ ...previous, backgroundEnabled: true, status: 'active', error: null }));
      return true;
    } catch (error) {
      await stopBackground();
      setState(previous => ({ ...previous, backgroundEnabled: false, error: readableError(error) }));
      await startForeground();
      return false;
    }
  }, [startBackground, startForeground, stopBackground]);

  const disableBackground = useCallback(async () => {
    await stopBackground();
    await savePreferences({ mode: 'real', wantedActive: stateRef.current.status === 'active', backgroundEnabled: false });
    setState(previous => ({ ...previous, backgroundEnabled: false, error: null }));
    if (stateRef.current.status === 'active') await startForeground();
  }, [startForeground, stopBackground]);

  const startDemo = useCallback(() => {
    stopForeground();
    void stopBackground().then(() => savePreferences({ mode: 'demo', wantedActive: false, backgroundEnabled: false }))
      .then(() => setState(previous => ({ ...previous, mode: 'demo', status: 'inactive', backgroundEnabled: false, error: null })))
      .catch(() => setState(previous => ({ ...previous, status: 'unavailable', error: 'Demo preferences could not be saved.' })));
  }, [stopBackground, stopForeground]);

  const clearHistory = useCallback(async () => {
    if (clearingHistory.current) return;
    await reserveHistoryClear();
    clearingHistory.current = true;
    deletionEpoch.current++;
    stopForeground();
    setState(previous => ({ ...previous, status: 'paused' }));
    try {
      await savePreferences({ mode: stateRef.current.mode, wantedActive: false, backgroundEnabled: false }, true);
      await stopBackground();
      await deleteHistory();
      setState({ ...initialState, ready: true, backgroundAvailable: Platform.OS !== 'web' && await TaskManager.isAvailableAsync() });
    } finally {
      try {
        await releaseHistoryClear();
      } finally {
        clearingHistory.current = false;
      }
    }
  }, [stopBackground, stopForeground]);

  const openSettings = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try { await Linking.openSettings(); }
      catch { setState(previous => ({ ...previous, error: 'Open device Settings and allow location for Location Wrapped.' })); }
    }
  }, []);

  const renamePlace = useCallback(async (placeId: string, name: string | null) => {
    if (clearingHistory.current || stateRef.current.mode !== 'real' || !stateRef.current.places.some(place => place.id === placeId)) {
      throw new Error('This observed place is no longer available.');
    }
    await savePlaceName(placeId, name);
    await refreshRecords();
  }, [refreshRecords]);

  const importTimeline = useCallback(async (text: string, filename: string): Promise<TimelineImportMetadata> => {
    if (clearingHistory.current) throw new Error('Location history is being cleared. Try the import again in a moment.');
    const importEpoch = deletionEpoch.current;
    const cleanedFilename = filename.trim().split(/[\\/]/).pop()?.slice(0, 240) || 'Google Timeline.json';
    const parsed = parseGoogleTimelineText(text);
    if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
      throw new Error('The import was cancelled because location history was cleared.');
    }
    const importItem: TimelineImportMetadata = {
      id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      filename: cleanedFilename,
      importedAt: Date.now(),
      pointCount: parsed.points.length,
      format: parsed.format,
    };
    const wasAlreadyReal = stateRef.current.mode === 'real';
    try {
      if (!wasAlreadyReal) {
        stopForeground();
        await stopBackground();
      }
      if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
        throw new Error('The import was cancelled because location history was cleared.');
      }
    } catch (error) {
      if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
        throw new Error('The import was cancelled because location history was cleared.');
      }
      const detail = error instanceof Error ? error.message : 'Unknown device storage error.';
      throw new Error(`The Timeline file could not be prepared for saving. ${detail}`);
    }
    try {
      await saveTimelineImport(
        importItem,
        parsed.points,
        wasAlreadyReal ? undefined : { mode: 'real', wantedActive: false, backgroundEnabled: false },
        () => !clearingHistory.current && importEpoch === deletionEpoch.current,
      );
    } catch (error) {
      if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
        throw new Error('The import was cancelled because location history was cleared.');
      }
      const detail = error instanceof Error ? error.message : 'Unknown device storage error.';
      throw new Error(`The Timeline file could not be saved on this device. ${detail}`);
    }
    if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
      throw new Error('The import was cleared before it could be displayed.');
    }
    if (!wasAlreadyReal) {
      setState(previous => ({
        ...previous, mode: 'real', status: 'paused', backgroundEnabled: false, error: null,
      }));
    }
    try {
      await refreshRecords(importEpoch);
    } catch (error) {
      if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
        throw new Error('The import was cleared before it could be displayed.');
      }
      const detail = error instanceof Error ? error.message : 'Unknown refresh error.';
      throw new Error(`The Timeline was saved on this device, but the history view could not be refreshed. ${detail}`);
    }
    if (clearingHistory.current || importEpoch !== deletionEpoch.current) {
      throw new Error('The import was cleared before it could be displayed.');
    }
    return importItem;
  }, [refreshRecords, stopBackground, stopForeground]);

  const removeImport = useCallback(async (id: string): Promise<void> => {
    if (clearingHistory.current) throw new Error('Location history is being cleared. Try again in a moment.');
    try {
      if (!(await removeTimelineImport(id))) throw new Error('This imported file is no longer available.');
      await refreshRecords();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'The imported file could not be removed from this device.');
    }
  }, [refreshRecords]);

  return <LocationContext.Provider value={{ state, requestAccess, pause, resume, clearHistory, startDemo, openSettings, enableBackground, disableBackground, renamePlace, importTimeline, removeImport }}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation must be used within LocationProvider');
  return context;
}