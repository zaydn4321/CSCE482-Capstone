import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { filterLocationPoint, processPlaces, processVisits, type RawLocation } from './visitProcessor';
import type { GoogleTimelineFormat } from './googleTimeline';
import { reconcilePlaceNamesAfterImportRemoval } from './placeNameReconciliation';
import { isTimelinePickerCacheJsonUri } from './timelinePickerCache';

export type TrackingPreferences = {
  mode: 'new' | 'demo' | 'real';
  wantedActive: boolean;
  backgroundEnabled: boolean;
};

const previousStorageKey = 'location-wrapped-native:v1';
const initialPreferences: TrackingPreferences = { mode: 'new', wantedActive: false, backgroundEnabled: false };
type PointRow = { latitude: number; longitude: number; timestamp: number; accuracy: number };
type PreferenceRow = { mode: string; wanted_active: number; background_enabled: number };
type PendingFileRow = { uri: string };
const pendingTimelineFilesTable = 'pending_timeline_files';
const activeTimelinePickersTable = 'active_timeline_picker_sessions';
export type TimelineImportMetadata = {
  id: string;
  filename: string;
  importedAt: number;
  pointCount: number;
  format: GoogleTimelineFormat;
};
type ImportRow = { id: string; filename: string; imported_at: number; point_count: number; format: string };

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let historyClearReserved = false;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('location-wrapped.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS raw_points (
          timestamp INTEGER PRIMARY KEY NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tracking_preferences (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          mode TEXT NOT NULL,
          wanted_active INTEGER NOT NULL,
          background_enabled INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS place_names (
          place_id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS timeline_imports (
          id TEXT PRIMARY KEY NOT NULL,
          filename TEXT NOT NULL,
          imported_at INTEGER NOT NULL,
          point_count INTEGER NOT NULL,
          format TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS imported_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_id TEXT NOT NULL REFERENCES timeline_imports(id) ON DELETE CASCADE,
          timestamp INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy REAL NOT NULL,
          UNIQUE (import_id, timestamp, latitude, longitude)
        );
        CREATE TABLE IF NOT EXISTS ${pendingTimelineFilesTable} (
          uri TEXT PRIMARY KEY NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${activeTimelinePickersTable} (
          id TEXT PRIMARY KEY NOT NULL
        );
      `);
      // A picker session remaining after a process restart is stale; its cache copy is swept on clear.
      await db.runAsync(`DELETE FROM ${activeTimelinePickersTable}`);
      return db;
    })().catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function validPoint(item: unknown): item is RawLocation {
  if (!item || typeof item !== 'object') return false;
  const point = item as Partial<RawLocation>;
  return typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lng === 'number' && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
    && typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)
    && typeof point.accuracy === 'number' && Number.isFinite(point.accuracy);
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.catch(() => {}).then(operation);
  writeQueue = next;
  return next;
}

function isAppOwnedTimelineCopy(uri: string): boolean {
  return isTimelinePickerCacheJsonUri(uri, new Directory(Paths.cache, 'DocumentPicker').uri);
}

function removeAppOwnedCacheCopy(uri: string): void {
  if (!isAppOwnedTimelineCopy(uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

async function sweepTimelinePickerJsonCache(): Promise<void> {
  const directory = new Directory(Paths.cache, 'DocumentPicker');
  if (!directory.exists) return;
  const failures: string[] = [];
  try {
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || !entry.name.toLowerCase().endsWith('.json')) continue;
      try {
        if (entry.exists) entry.delete();
      } catch {
        failures.push(entry.name);
      }
    }
  } catch (error) {
    throw new Error(`Google Timeline cache cleanup failed; location history was not cleared. ${error instanceof Error ? error.message : ''}`);
  }
  if (failures.length) {
    throw new Error(`Could not remove temporary Timeline JSON file${failures.length === 1 ? '' : 's'} (${failures.join(', ')}); location history was not cleared.`);
  }
}

/** Reserve the write queue for clear-history. Active document picker flows make clearing fail safely. */
export function reserveHistoryClear(): Promise<void> {
  return serialize(async () => {
    if (historyClearReserved) throw new Error('Location history is already being cleared.');
    const db = await database();
    const active = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ${activeTimelinePickersTable} LIMIT 1`,
    );
    if (active) throw new Error('A Timeline file is being selected or imported. Wait for it to finish, then clear history.');
    historyClearReserved = true;
  });
}

export function releaseHistoryClear(): Promise<void> {
  return serialize(async () => { historyClearReserved = false; });
}

export function beginTimelinePicker(id: string): Promise<void> {
  return serialize(async () => {
    if (historyClearReserved) throw new Error('Location history is being cleared. Try again after it finishes.');
    const db = await database();
    await db.runAsync(`INSERT INTO ${activeTimelinePickersTable} (id) VALUES (?)`, id);
  });
}

export function endTimelinePicker(id: string): Promise<void> {
  return serialize(async () => {
    const db = await database();
    await db.runAsync(`DELETE FROM ${activeTimelinePickersTable} WHERE id = ?`, id);
  });
}

/** Registers a picker-created cache copy so clear-history can clean it after an interrupted import. */
export function trackPendingTimelineFile(uri: string): Promise<void> {
  if (!isAppOwnedTimelineCopy(uri)) return Promise.resolve();
  return serialize(async () => {
    if (historyClearReserved) throw new Error('Location history is being cleared. Try the import again afterward.');
    const db = await database();
    await db.runAsync(`INSERT OR IGNORE INTO ${pendingTimelineFilesTable} (uri) VALUES (?)`, uri);
  });
}

/** Deletes only picker-created cache copies; provider URIs and original user files are never removed. */
export function releasePendingTimelineFile(uri: string): Promise<void> {
  try {
    removeAppOwnedCacheCopy(uri);
  } catch (error) {
    return Promise.reject(new Error(`The temporary Timeline copy could not be removed. ${error instanceof Error ? error.message : ''}`));
  }
  if (!isAppOwnedTimelineCopy(uri)) return Promise.resolve();
  return serialize(async () => {
    const db = await database();
    await db.runAsync(`DELETE FROM ${pendingTimelineFilesTable} WHERE uri = ?`, uri);
  });
}

async function migrateEarlierStorage(db: SQLite.SQLiteDatabase): Promise<void> {
  const existing = await db.getFirstAsync<PreferenceRow>('SELECT mode, wanted_active, background_enabled FROM tracking_preferences WHERE id = 1');
  if (existing) return;
  const old = await AsyncStorage.getItem(previousStorageKey);
  let preferences = initialPreferences;
  let points: RawLocation[] = [];
  if (old) {
    try {
      const parsed = JSON.parse(old) as { mode?: string; status?: string; records?: unknown };
      preferences = {
        mode: parsed.mode === 'real' || parsed.mode === 'demo' ? parsed.mode : 'new',
        wantedActive: parsed.mode === 'real' && parsed.status === 'active',
        backgroundEnabled: false,
      };
      points = Array.isArray(parsed.records) ? parsed.records.filter(validPoint) : [];
    } catch {
      // Malformed old preferences cannot be trusted; the new database remains intact.
    }
  }
  await db.withExclusiveTransactionAsync(async transaction => {
    for (const point of points) {
      await transaction.runAsync(
        'INSERT OR IGNORE INTO raw_points (latitude, longitude, timestamp, accuracy) VALUES (?, ?, ?, ?)',
        point.lat, point.lng, point.timestamp, point.accuracy,
      );
    }
    await transaction.runAsync(
      'INSERT OR IGNORE INTO tracking_preferences (id, mode, wanted_active, background_enabled) VALUES (1, ?, ?, ?)',
      preferences.mode, Number(preferences.wantedActive), Number(preferences.backgroundEnabled),
    );
  });
  if (old) await AsyncStorage.removeItem(previousStorageKey);
}

export async function loadHistory(): Promise<{ preferences: TrackingPreferences; records: RawLocation[]; placeNames: Record<string, string>; imports: TimelineImportMetadata[] }> {
  await writeQueue.catch(() => {});
  const db = await database();
  await migrateEarlierStorage(db);
  const [row, points, importedPoints, names, importRows] = await Promise.all([
    db.getFirstAsync<PreferenceRow>('SELECT mode, wanted_active, background_enabled FROM tracking_preferences WHERE id = 1'),
    db.getAllAsync<PointRow>('SELECT latitude, longitude, timestamp, accuracy FROM raw_points ORDER BY timestamp ASC'),
    db.getAllAsync<PointRow>('SELECT latitude, longitude, timestamp, accuracy FROM imported_points ORDER BY timestamp ASC'),
    db.getAllAsync<{ place_id: string; name: string }>('SELECT place_id, name FROM place_names'),
    db.getAllAsync<ImportRow>('SELECT id, filename, imported_at, point_count, format FROM timeline_imports ORDER BY imported_at DESC'),
  ]);
  const uniquePoints = new Map<string, RawLocation>();
  for (const point of [...points, ...importedPoints]) {
    const record = { lat: point.latitude, lng: point.longitude, timestamp: point.timestamp, accuracy: point.accuracy };
    const key = `${record.timestamp}:${record.lat.toFixed(6)}:${record.lng.toFixed(6)}`;
    if (!uniquePoints.has(key)) uniquePoints.set(key, record);
  }
  return {
    preferences: {
      mode: row?.mode === 'real' || row?.mode === 'demo' ? row.mode : 'new',
      wantedActive: row?.wanted_active === 1,
      backgroundEnabled: row?.background_enabled === 1,
    },
    records: [...uniquePoints.values()].sort((a, b) => a.timestamp - b.timestamp),
    placeNames: Object.fromEntries(names.map(row => [row.place_id, row.name])),
    imports: importRows.map(item => ({
      id: item.id,
      filename: item.filename,
      importedAt: item.imported_at,
      pointCount: item.point_count,
      format: item.format as GoogleTimelineFormat,
    })),
  };
}

/** Saves one file and all of its points as a single transaction. Native GPS rows and labels are untouched. */
export function saveTimelineImport(
  importItem: TimelineImportMetadata,
  points: RawLocation[],
  preferences?: TrackingPreferences,
  canCommit?: () => boolean,
): Promise<void> {
  if (!importItem.id || !importItem.filename.trim() || points.length === 0) {
    return Promise.reject(new Error('The import is missing a filename, ID, or usable location points.'));
  }
  if (points.some(point => !validPoint(point))) {
    return Promise.reject(new Error('The import contains an invalid location point.'));
  }
  return serialize(async () => {
    const assertCommitAllowed = () => {
      if (historyClearReserved || (canCommit && !canCommit())) {
        throw new Error('The import was cancelled because location history was cleared or is being cleared.');
      }
    };
    assertCommitAllowed();
    const db = await database();
    assertCommitAllowed();
    try {
      await db.withExclusiveTransactionAsync(async transaction => {
        assertCommitAllowed();
        await transaction.runAsync(
          'INSERT INTO timeline_imports (id, filename, imported_at, point_count, format) VALUES (?, ?, ?, 0, ?)',
          importItem.id, importItem.filename, importItem.importedAt, importItem.format,
        );
        let insertedCount = 0;
        const batchSize = 100;
        for (let offset = 0; offset < points.length; offset += batchSize) {
          assertCommitAllowed();
          const batch = points.slice(offset, offset + batchSize);
          const values = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
          const parameters = batch.flatMap(point => [
            importItem.id, point.timestamp, point.lat, point.lng, point.accuracy,
          ]);
          const result = await transaction.runAsync(
            `INSERT OR IGNORE INTO imported_points (import_id, timestamp, latitude, longitude, accuracy) VALUES ${values}`,
            ...parameters,
          );
          insertedCount += result.changes;
        }
        assertCommitAllowed();
        await transaction.runAsync(
          'UPDATE timeline_imports SET point_count = ? WHERE id = ?',
          insertedCount, importItem.id,
        );
        if (preferences) {
          await transaction.runAsync(
            `INSERT INTO tracking_preferences (id, mode, wanted_active, background_enabled)
             VALUES (1, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, wanted_active=excluded.wanted_active, background_enabled=excluded.background_enabled`,
            preferences.mode, Number(preferences.wantedActive), Number(preferences.backgroundEnabled),
          );
        }
        assertCommitAllowed();
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('cancelled because location history was cleared')) throw error;
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error('This import could not be saved because its ID already exists.');
      }
      throw error;
    }
  });
}

export function removeTimelineImport(id: string): Promise<boolean> {
  return serialize(async () => {
    const db = await database();
    const activePicker = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ${activeTimelinePickersTable} LIMIT 1`,
    );
    if (activePicker) {
      throw new Error('Wait for the current Timeline file to finish importing before removing another file.');
    }
    const exists = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM timeline_imports WHERE id = ?',
      id,
    );
    if (!exists) return false;
    // A process can stop after committing an import but before deleting its picker copy.
    // Only this app's JSON picker uses this private directory.
    await sweepTimelinePickerJsonCache();
    await db.runAsync(`DELETE FROM ${pendingTimelineFilesTable}`);
    let removed = false;
    await db.withExclusiveTransactionAsync(async transaction => {
      const importRow = await transaction.getFirstAsync<{ id: string }>(
        'SELECT id FROM timeline_imports WHERE id = ?',
        id,
      );
      if (!importRow) return;
      const nativePointsBefore = await transaction.getAllAsync<PointRow>(
        'SELECT latitude, longitude, timestamp, accuracy FROM raw_points ORDER BY timestamp ASC',
      );
      const importedPointsBefore = await transaction.getAllAsync<PointRow>(
        'SELECT latitude, longitude, timestamp, accuracy FROM imported_points ORDER BY timestamp ASC',
      );
      const existingLabels = await transaction.getAllAsync<{ place_id: string; name: string }>(
        'SELECT place_id, name FROM place_names',
      );
      const oldUniquePoints = new Map<string, RawLocation>();
      for (const point of [...nativePointsBefore, ...importedPointsBefore]) {
        const record = { lat: point.latitude, lng: point.longitude, timestamp: point.timestamp, accuracy: point.accuracy };
        const key = `${record.timestamp}:${record.lat.toFixed(6)}:${record.lng.toFixed(6)}`;
        if (!oldUniquePoints.has(key)) oldUniquePoints.set(key, record);
      }
      const oldPlaces = processPlaces(processVisits([...oldUniquePoints.values()]));

      await transaction.runAsync('DELETE FROM imported_points WHERE import_id = ?', id);
      const result = await transaction.runAsync('DELETE FROM timeline_imports WHERE id = ?', id);
      removed = result.changes > 0;
      if (!removed) return;

      const nativePoints = await transaction.getAllAsync<PointRow>(
        'SELECT latitude, longitude, timestamp, accuracy FROM raw_points ORDER BY timestamp ASC',
      );
      const remainingImports = await transaction.getAllAsync<PointRow>(
        'SELECT latitude, longitude, timestamp, accuracy FROM imported_points ORDER BY timestamp ASC',
      );
      const uniquePoints = new Map<string, RawLocation>();
      for (const point of [...nativePoints, ...remainingImports]) {
        const record = { lat: point.latitude, lng: point.longitude, timestamp: point.timestamp, accuracy: point.accuracy };
        const key = `${record.timestamp}:${record.lat.toFixed(6)}:${record.lng.toFixed(6)}`;
        if (!uniquePoints.has(key)) uniquePoints.set(key, record);
      }
      const survivingPlaces = processPlaces(processVisits([...uniquePoints.values()]));
      const currentNames = Object.fromEntries(existingLabels.map(row => [row.place_id, row.name]));
      const reconciledNames = reconcilePlaceNamesAfterImportRemoval(currentNames, oldPlaces, survivingPlaces);
      for (const { place_id: placeId, name } of existingLabels) {
        if (reconciledNames[placeId] !== name) {
          await transaction.runAsync('DELETE FROM place_names WHERE place_id = ?', placeId);
        }
      }
      const existingLabelIds = new Set(existingLabels.map(row => row.place_id));
      for (const [placeId, name] of Object.entries(reconciledNames)) {
        if (!existingLabelIds.has(placeId)) {
          await transaction.runAsync('INSERT INTO place_names (place_id, name) VALUES (?, ?)', placeId, name);
        }
      }
    });
    return removed;
  });
}

/** Names are device-only metadata; a null value removes a saved name. */
export function savePlaceName(placeId: string, value: string | null): Promise<void> {
  if (!placeId.startsWith('place-')) return Promise.reject(new Error('Invalid place.'));
  const name = value?.trim().replace(/\s+/g, ' ') ?? null;
  if (name !== null && (!name || name.length > 48 || /[\u0000-\u001f\u007f-\u009f]/.test(name))) {
    return Promise.reject(new Error('Enter a place name of up to 48 characters.'));
  }
  return serialize(async () => {
    const db = await database();
    if (name === null) {
      await db.runAsync('DELETE FROM place_names WHERE place_id = ?', placeId);
    } else {
      await db.runAsync(
        'INSERT INTO place_names (place_id, name) VALUES (?, ?) ON CONFLICT(place_id) DO UPDATE SET name=excluded.name',
        placeId, name,
      );
    }
  });
}

export function savePreferences(preferences: TrackingPreferences, allowDuringHistoryClear = false): Promise<void> {
  return serialize(async () => {
    if (historyClearReserved && !allowDuringHistoryClear) {
      throw new Error('Tracking preferences cannot be changed while location history is being cleared.');
    }
    const db = await database();
    await db.runAsync(
      `INSERT INTO tracking_preferences (id, mode, wanted_active, background_enabled)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, wanted_active=excluded.wanted_active, background_enabled=excluded.background_enabled`,
      preferences.mode, Number(preferences.wantedActive), Number(preferences.backgroundEnabled),
    );
  });
}

export function insertLocation(point: RawLocation): Promise<boolean> {
  return serialize(async () => {
    const db = await database();
    let inserted = false;
    await db.withExclusiveTransactionAsync(async transaction => {
      const tracking = await transaction.getFirstAsync<PreferenceRow>(
        'SELECT mode, wanted_active, background_enabled FROM tracking_preferences WHERE id = 1',
      );
      if (tracking?.mode !== 'real' || tracking.wanted_active !== 1) return;
      const row = await transaction.getFirstAsync<PointRow>(
        'SELECT latitude, longitude, timestamp, accuracy FROM raw_points ORDER BY timestamp DESC LIMIT 1',
      );
      const previous = row ? { lat: row.latitude, lng: row.longitude, timestamp: row.timestamp, accuracy: row.accuracy } : null;
      if (!filterLocationPoint(previous, point)) return;
      const result = await transaction.runAsync(
        'INSERT OR IGNORE INTO raw_points (latitude, longitude, timestamp, accuracy) VALUES (?, ?, ?, ?)',
        point.lat, point.lng, point.timestamp, point.accuracy,
      );
      inserted = result.changes > 0;
    });
    return inserted;
  });
}

export function deleteHistory(): Promise<void> {
  return serialize(async () => {
    if (!historyClearReserved) throw new Error('Location history clear was not reserved safely. Try again.');
    const db = await database();
    const activePicker = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ${activeTimelinePickersTable} LIMIT 1`,
    );
    if (activePicker) {
      throw new Error('A Timeline file is being selected or imported. Wait for it to finish, then clear history.');
    }
    const pendingFiles = await db.getAllAsync<PendingFileRow>(
      `SELECT uri FROM ${pendingTimelineFilesTable}`,
    );
    await sweepTimelinePickerJsonCache();
    let cleanupFailed = false;
    for (const { uri } of pendingFiles) {
      try {
        removeAppOwnedCacheCopy(uri);
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      throw new Error('A temporary Timeline file could not be removed. Location history was not deleted; try again.');
    }
    await AsyncStorage.removeItem(previousStorageKey);
    await db.withExclusiveTransactionAsync(async transaction => {
      await transaction.runAsync('DELETE FROM raw_points');
      await transaction.runAsync('DELETE FROM imported_points');
      await transaction.runAsync('DELETE FROM timeline_imports');
      await transaction.runAsync('DELETE FROM tracking_preferences');
      await transaction.runAsync('DELETE FROM place_names');
      await transaction.runAsync(`DELETE FROM ${pendingTimelineFilesTable}`);
    });
  });
}