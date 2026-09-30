import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertLocation, loadHistory } from './locationStore';

export const BACKGROUND_LOCATION_TASK = 'location-wrapped-background-points';

// Must be registered at module scope so Expo can run it without mounting React.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    if (!locations?.length) return;
    const { preferences } = await loadHistory();
    if (preferences.mode !== 'real' || !preferences.wantedActive || !preferences.backgroundEnabled) return;
    for (const position of locations) {
      await insertLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? Infinity,
        timestamp: position.timestamp,
      });
    }
  });
}