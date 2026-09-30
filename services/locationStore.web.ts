import type { RawLocation } from './visitProcessor';
import type { TimelineImportMetadata, TrackingPreferences } from './locationStore';

// The browser preview is not a tracking target. Native history is never stored here.
export async function loadHistory(): Promise<{ preferences: TrackingPreferences; records: RawLocation[]; placeNames: Record<string, string>; imports: TimelineImportMetadata[] }> {
  return { preferences: { mode: 'new', wantedActive: false, backgroundEnabled: false }, records: [], placeNames: {}, imports: [] };
}
export function getHistoryGeneration(): number { return 0; }
export async function loadCloudBackupPoints(): Promise<never> {
  throw new Error('Cloud backup is only available in the iOS or Android app.');
}
export async function mergeCloudRestorePoints(_points: Array<{
  timestamp: number; lat: number; lng: number; accuracy: number; source: 'device' | 'import'; importId: string | null;
}>, _canContinue?: () => boolean): Promise<never> {
  throw new Error('Cloud restore is only available in the iOS or Android app.');
}
export async function savePreferences(_preferences: TrackingPreferences, _allowDuringHistoryClear = false): Promise<void> {}
export async function insertLocation(_point: RawLocation): Promise<boolean> { return false; }
export async function saveTimelineImport(
  _importItem: TimelineImportMetadata,
  _points: RawLocation[],
  _preferences?: TrackingPreferences,
  _canCommit?: () => boolean,
): Promise<void> {
  throw new Error('Google Timeline import is only available in the iOS or Android app. Your data is not sent to a server.');
}
export async function removeTimelineImport(_id: string): Promise<boolean> {
  throw new Error('Google Timeline imports can only be removed in the iOS or Android app.');
}
export async function reserveHistoryClear(): Promise<void> {
  return;
}
export async function releaseHistoryClear(): Promise<void> {}
export async function beginTimelinePicker(_id: string): Promise<void> {
  throw new Error('Timeline file imports are only available in the iOS or Android app.');
}
export async function endTimelinePicker(_id: string): Promise<void> {}
export async function trackPendingTimelineFile(_uri: string): Promise<void> {
  throw new Error('Timeline file imports are only available in the iOS or Android app.');
}
export async function releasePendingTimelineFile(_uri: string): Promise<void> {}
export async function savePlaceName(_placeId: string, _name: string | null): Promise<void> {
  throw new Error('Naming tracked places is only available in the iOS or Android app.');
}
export async function deleteHistory(): Promise<void> {}