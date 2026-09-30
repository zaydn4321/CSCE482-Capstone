import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAnalysisAfterBackup, fromCloudPoint, isValidCloudApiUrl, isValidCloudExport, mayUploadBackup, mergeCloudPoints, restoredTrackingPreferences, selectBackupSources, splitIntoChunks, toCloudPoint } from './cloudData.mjs';

test('login state and demo mode alone never opt into upload', () => {
  assert.equal(mayUploadBackup({ authenticated: true, consentEnabled: false, trackingMode: 'real' }), false);
  assert.equal(mayUploadBackup({ authenticated: true, consentEnabled: true, trackingMode: 'demo' }), false);
  assert.equal(mayUploadBackup({ authenticated: false, consentEnabled: true, trackingMode: 'real' }), false);
  assert.equal(mayUploadBackup({ authenticated: true, consentEnabled: true, trackingMode: 'real' }), true);
});

test('backup mapping preserves timestamps, coordinates, accuracy, source, and import provenance', () => {
  const original = { timestamp: 1700000000123, lat: 40.7, lng: -73.9, accuracy: 8, source: 'import', importId: 'timeline-abc' };
  const cloud = toCloudPoint(original);
  assert.deepEqual(cloud, { ts: 1700000000123, lat: 40.7, lon: -73.9, accuracy: 8, source: 'import', import_id: 'timeline-abc' });
  assert.deepEqual(fromCloudPoint(cloud), original);
  assert.deepEqual(toCloudPoint({ ...original, source: 'device', importId: null }), {
    ts: 1700000000123, lat: 40.7, lon: -73.9, accuracy: 8, source: 'device',
  });
});

test('batch chunks stay within API limit and restore merge is idempotent by provenance', () => {
  const points = Array.from({ length: 2101 }, (_, index) => ({
    timestamp: index, lat: 1, lng: 2, accuracy: 0, source: 'device', importId: null,
  }));
  const chunks = splitIntoChunks(points, 1000);
  assert.deepEqual(chunks.map(chunk => chunk.length), [1000, 1000, 101]);
  const existing = [points[0]];
  const merged = mergeCloudPoints(existing, [points[0], { ...points[0], source: 'import', importId: 'import-x' }]);
  assert.equal(merged.length, 2);
  assert.equal(mergeCloudPoints(merged, [points[0]]).length, 2);
});

test('restored points stay local and are excluded from every account backup', () => {
  const device = { timestamp: 1, lat: 1, lng: 2, accuracy: 3, source: 'device', importId: null, origin: 'device' };
  const imported = { timestamp: 2, lat: 1, lng: 2, accuracy: 3, source: 'import', importId: 'import-a', origin: 'timeline_import' };
  const restored = { timestamp: 3, lat: 1, lng: 2, accuracy: 3, source: 'device', importId: null, origin: 'cloud_restore' };
  const unknown = { ...device, timestamp: 4, origin: 'unknown' };
  const backup = selectBackupSources([device, imported, restored, unknown]);
  assert.deepEqual(backup.map(point => point.timestamp), [1, 2]);
  assert.equal(backup.some(point => point.timestamp === restored.timestamp), false);
});

test('export envelope validator rejects malformed points before restore mapping', () => {
  const valid = {
    user: { id: 9, email: 'person@example.com', created_at: '2024-01-01T00:00:00Z' },
    exported_at: 1700000000000,
    points: [{ id: 1, ts: 1700000000000, lat: 40, lon: -73, accuracy: null, source: 'device', import_id: null }],
    visits: [],
    interest_overrides: [],
  };
  assert.equal(isValidCloudExport(valid), true);
  for (const malformedPoint of [
    { ...valid.points[0], ts: Infinity },
    { ...valid.points[0], lat: 91 },
    { ...valid.points[0], lon: NaN },
    { ...valid.points[0], source: 'other' },
    { ...valid.points[0], accuracy: -1 },
    { ...valid.points[0], import_id: 'x'.repeat(65) },
  ]) {
    assert.equal(isValidCloudExport({ ...valid, points: [malformedPoint] }), false);
  }
  assert.equal(isValidCloudExport({ ...valid, points: {} }), false);
  assert.equal(isValidCloudExport({ ...valid, user: { ...valid.user, id: 0 } }), false);
  assert.equal(isValidCloudExport({ ...valid, exported_at: -1 }), false);
  assert.equal(isValidCloudExport({ ...valid, visits: null }), false);
  assert.equal(isValidCloudExport({ ...valid, interest_overrides: [{ category: 'food', hidden: 'yes' }] }), false);
});

test('restored mode is real but remains paused without enabling tracking', () => {
  assert.deepEqual(restoredTrackingPreferences(), {
    mode: 'real', wantedActive: false, backgroundEnabled: false,
  });
});

test('cloud configuration rejects missing, invalid, and production HTTP URLs', () => {
  assert.equal(isValidCloudApiUrl(undefined, false), false);
  assert.equal(isValidCloudApiUrl('not a URL', false), false);
  assert.equal(isValidCloudApiUrl('http://api.example.test', false), false);
  assert.equal(isValidCloudApiUrl('http://localhost:8000', true), true);
  assert.equal(isValidCloudApiUrl('https://api.example.test', false), true);
  assert.equal(isValidCloudApiUrl('https://user:secret@example.test', false), false);
});

test('analysis enqueue is attempted once and failure does not become backup failure', async () => {
  let calls = 0;
  const job = await enqueueAnalysisAfterBackup(4, async () => {
    calls++;
    return { job_id: 'job-1' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(job, { analysisJobId: 'job-1', analysisError: null, cause: null });

  const failed = await enqueueAnalysisAfterBackup(4, async () => {
    calls++;
    throw new Error('queue unavailable');
  });
  assert.equal(calls, 2);
  assert.equal(failed.analysisJobId, null);
  assert.equal(failed.analysisError, 'queue unavailable');
  assert.equal(failed.cause.message, 'queue unavailable');

  const empty = await enqueueAnalysisAfterBackup(0, async () => {
    throw new Error('must not enqueue for empty backup');
  });
  assert.deepEqual(empty, { analysisJobId: null, analysisError: null, cause: null });
});