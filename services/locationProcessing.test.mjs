import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLocationPoint, processPlaces, processVisits } from './visitProcessor.ts';
import { calculateStatistics } from './statisticsService.ts';

const minute = 60_000;
const point = (lat, lng, minuteOffset, accuracy = 5) => ({
  lat, lng, timestamp: minuteOffset * minute, accuracy,
});
const stationary = (lat, lng, startMinute, count = 6) =>
  Array.from({ length: count }, (_, index) => point(lat, lng, startMinute + index * 2));

test('filters duplicates, non-increasing timestamps, invalid coordinates, and poor accuracy', () => {
  const first = point(37, -122, 0);
  assert.equal(filterLocationPoint(null, first), true);
  assert.equal(filterLocationPoint(first, point(37, -122, 0)), false);
  assert.equal(filterLocationPoint(first, point(37, -122, 1, 101)), false);
  assert.equal(filterLocationPoint(first, point(91, -122, 2)), false);
  assert.equal(filterLocationPoint(first, { ...point(37, -122, 2), timestamp: Number.NaN }), false);
  assert.equal(filterLocationPoint(first, { ...point(37, -122, 2), accuracy: Number.POSITIVE_INFINITY }), false);
  assert.equal(filterLocationPoint(first, point(37, -122, 1)), false);
  assert.equal(filterLocationPoint(first, point(37, -122, 2)), true);
  assert.equal(filterLocationPoint(first, point(37, -121.999, 1)), true);
});

test('recognizes a stationary visit from periodic samples', () => {
  const visits = processVisits(stationary(37, -122, 0));
  assert.equal(visits.length, 1);
  assert.equal(visits[0].arrivedAt, 0);
  assert.equal(visits[0].departedAt, 10 * minute);
  assert.equal(visits[0].durationMs, 10 * minute);
  assert.equal(visits[0].pointCount, 6);
});

test('keeps place and visit IDs stable as an ongoing stay gains more readings', () => {
  const initial = stationary(37, -122, 0);
  const before = processVisits(initial)[0];
  const after = processVisits([...initial, point(37.0001, -122, 12)])[0];
  assert.ok(before && after);
  assert.equal(after.placeId, before.placeId);
  assert.equal(after.id, before.id);
  assert.notEqual(after.lat, before.lat);
});

test('separates moving between places and matches a repeat visit', () => {
  const records = [
    ...stationary(37, -122, 0),
    ...stationary(37, -121.99, 15),
    ...stationary(37, -122, 60),
  ];
  const visits = processVisits(records);
  assert.equal(visits.length, 3);
  assert.notEqual(visits[0].placeId, visits[1].placeId);
  assert.equal(visits[0].placeId, visits[2].placeId);
  assert.equal(visits[0].id, processVisits(records)[0].id);

  const places = processPlaces(visits);
  assert.equal(places.length, 2);
  assert.equal(places.find(place => place.id === visits[0].placeId)?.visitCount, 2);
});

test('does not bridge long observation gaps or count invalid samples as dwell', () => {
  const gapRecords = [point(37, -122, 0), point(37, -122, 40)];
  assert.deepEqual(processVisits(gapRecords), []);
  assert.deepEqual(processVisits([
    point(37, -122, 0),
    point(37, -122, 2, 150),
    point(37, -122, 6),
  ]), []);
  assert.deepEqual(processVisits([point(91, 0, 0), point(0, 181, 10)]), []);
});

test('calculates statistics from valid records and ordered place summaries', () => {
  const records = [
    { lat: 0, lng: 0, timestamp: Date.UTC(2024, 0, 1), accuracy: 5 },
    { lat: 0, lng: 0.001, timestamp: Date.UTC(2024, 0, 1) + 10_000, accuracy: 5 },
    // Bad fix, implausible jump, and >30 minute gap must not inflate route length.
    { lat: 0, lng: 1, timestamp: Date.UTC(2024, 0, 1) + 20_000, accuracy: 150 },
    { lat: 0, lng: 1, timestamp: Date.UTC(2024, 0, 1) + 30_000, accuracy: 5 },
    { lat: 0, lng: 1.001, timestamp: Date.UTC(2024, 0, 1) + 40 * minute, accuracy: 5 },
    { lat: 0, lng: 1.002, timestamp: Date.UTC(2024, 0, 2), accuracy: 5 },
  ];
  const visits = processVisits([]);
  const places = [
    { id: 'a', lat: 0, lng: 0, visitCount: 2, totalTimeMs: 100, firstVisit: 1, latestVisit: 3 },
    { id: 'b', lat: 0, lng: 1, visitCount: 1, totalTimeMs: 200, firstVisit: 2, latestVisit: 2 },
  ];
  const stats = calculateStatistics(records, visits, places);
  assert.equal(stats.daysTracked, 2);
  assert.equal(stats.uniquePlaces, 2);
  assert.equal(stats.totalVisits, 0);
  assert.ok(stats.distanceKm > 0.1 && stats.distanceKm < 0.12);
  assert.equal(stats.mostVisitedPlace?.id, 'a');
  assert.equal(stats.mostTimePlace?.id, 'b');
  assert.deepEqual(stats.topPlaces.map(place => place.id), ['a', 'b']);
  assert.equal(stats.mostActiveDay, new Date(Date.UTC(2024, 0, 1)).toISOString().slice(0, 10));
  assert.equal(stats.mostActiveMonth, '2024-01');
});

test('empty statistics have null leaders and zero counts', () => {
  assert.deepEqual(calculateStatistics([], [], []), {
    daysTracked: 0,
    uniquePlaces: 0,
    totalVisits: 0,
    distanceKm: 0,
    mostVisitedPlace: null,
    mostTimePlace: null,
    mostActiveDay: null,
    mostActiveMonth: null,
    topPlaces: [],
  });
});