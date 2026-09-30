import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleTimeline, parseGoogleTimelineText, parseTimelineCoordinate } from './googleTimeline.ts';
import { processVisits } from './visitProcessor.ts';

const minute = 60_000;
const t0 = Date.UTC(2025, 0, 1);

test('parses Android semantic path points and raw signals into RawLocation records', () => {
  const result = parseGoogleTimeline({
    semanticSegments: [{
      startTime: new Date(t0).toISOString(),
      timelinePath: [
        { point: '37.4°, -122.1°', time: new Date(t0).toISOString() },
        { point: 'geo:37.41,-122.11', durationMinutesOffsetFromStartTime: 5 },
      ],
    }],
    rawSignals: [{
      position: { LatLng: '37.42°, -122.12°', timestamp: new Date(t0 + 8 * minute).toISOString(), accuracyMeters: 12 },
    }],
  });
  assert.equal(result.format, 'android-semantic');
  assert.equal(result.points.length, 3);
  assert.deepEqual(result.points[0], { lat: 37.4, lng: -122.1, timestamp: t0, accuracy: 25 });
  assert.deepEqual(result.points[1], { lat: 37.41, lng: -122.11, timestamp: t0 + 5 * minute, accuracy: 25 });
  assert.equal(result.points[2].accuracy, 12);
});

test('parses iOS geo coordinates and interpolated visit samples, de-duplicating overlaps', () => {
  const result = parseGoogleTimeline([
    {
      startTime: new Date(t0).toISOString(),
      endTime: new Date(t0 + 20 * minute).toISOString(),
      timelinePath: [{ point: 'geo:37.4,-122.1', time: new Date(t0).toISOString() }],
    },
    {
      startTime: new Date(t0).toISOString(),
      endTime: new Date(t0 + 20 * minute).toISOString(),
      visit: { topCandidate: { placeLocation: { latLng: '37.4°, -122.1°' } } },
    },
  ]);
  assert.equal(result.format, 'ios-semantic');
  assert.equal(result.points.length, 3);
  assert.deepEqual(result.points.map(point => point.timestamp), [t0, t0 + 10 * minute, t0 + 20 * minute]);
  assert.ok(result.points.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.accuracy === 25));
});

test('an empty timelinePath does not hide a valid visit segment', () => {
  const result = parseGoogleTimeline([{
    startTime: new Date(t0).toISOString(),
    endTime: new Date(t0 + minute).toISOString(),
    timelinePath: [],
    visit: { topCandidate: { placeLocation: 'geo:37.4,-122.1' } },
  }]);
  assert.equal(result.points.length, 2);
  assert.deepEqual(result.points.map(point => point.timestamp), [t0, t0 + minute]);
});

test('multi-day visit samples remain within the visit processor gap threshold', () => {
  const end = t0 + 7 * 24 * 60 * minute;
  const result = parseGoogleTimeline([{
    startTime: new Date(t0).toISOString(),
    endTime: new Date(end).toISOString(),
    visit: { topCandidate: { placeLocation: 'geo:37.4,-122.1' } },
  }]);
  const gaps = result.points.slice(1).map((point, index) => point.timestamp - result.points[index].timestamp);
  assert.ok(result.points.length > 300);
  assert.ok(gaps.every(gap => gap <= 30 * minute));
  assert.equal(processVisits(result.points).length, 1);
});

test('parses legacy Takeout E7 records and timestamp variants', () => {
  const result = parseGoogleTimeline({
    locations: [
      { latitudeE7: 374000000, longitudeE7: -1221000000, timestamp: '2024-01-01T00:00:00Z', accuracy: 8 },
      { latitudeE7: 374100000, longitudeE7: -1221100000, timestampMs: t0 },
    ],
  });
  assert.equal(result.format, 'legacy-records');
  assert.deepEqual(result.points, [
    { lat: 37.4, lng: -122.1, timestamp: Date.UTC(2024, 0, 1), accuracy: 8 },
    { lat: 37.41, lng: -122.11, timestamp: t0, accuracy: 25 },
  ]);
});

test('rejects malformed JSON, unsupported shapes, and files without usable records', () => {
  assert.throws(() => parseGoogleTimelineText('{broken'), /not valid JSON/);
  assert.throws(() => parseGoogleTimelineText('{"elsewhere":[]}'), /not a Google Timeline export/);
  assert.throws(() => parseGoogleTimelineText('{"locations":[{"latitudeE7":990000000,"longitudeE7":0,"timestamp":1}]}'), /No usable location points/);
});

test('parses supported coordinate spellings and rejects invalid coordinates', () => {
  assert.deepEqual(parseTimelineCoordinate({ latitudeE7: 374000000, longitudeE7: -1221000000 }), { lat: 37.4, lng: -122.1 });
  assert.equal(parseTimelineCoordinate('90.1,0'), null);
  assert.equal(parseTimelineCoordinate('not a coordinate'), null);
});