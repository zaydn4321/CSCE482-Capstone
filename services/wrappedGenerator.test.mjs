import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoWrapped, generateWrapped } from './wrappedGenerator.ts';
import { calculateStatistics } from './statisticsService.ts';
import { processPlaces, processVisits } from './visitProcessor.ts';

const minute = 60_000;
const track = (lat, lng, start) => Array.from({ length: 6 }, (_, index) => ({
  lat, lng, timestamp: start + index * 2 * minute, accuracy: 5,
}));

function story(records) {
  const visits = processVisits(records);
  const places = processPlaces(visits);
  return generateWrapped(calculateStatistics(records, visits, places), places, visits);
}

test('no history stays empty and never substitutes demo statistics', () => {
  const cards = story([]);
  assert.equal(cards.length, 10);
  assert.equal(cards.find(card => card.kind === 'distance')?.metric, '0.0 km');
  assert.equal(cards.find(card => card.kind === 'favorite')?.metric, 'No observed place yet');
  assert.equal(cards.find(card => card.kind === 'month')?.metric, 'Not enough history yet');
  assert.deepEqual(cards.find(card => card.kind === 'heatmap')?.heat, []);
});

test('one unnamed stationary place produces truthful cards and valid heat coordinates', () => {
  const cards = story(track(41.88, -87.63, Date.UTC(2026, 8, 1)));
  assert.equal(cards.find(card => card.kind === 'places')?.metric, '1 place');
  assert.equal(cards.find(card => card.kind === 'month')?.metric, 'September 2026');
  assert.match(cards.find(card => card.kind === 'favorite')?.metric ?? '', /41\.880, -87\.630/);
  assert.equal(cards.find(card => card.kind === 'personality')?.metric, 'Local');
  assert.deepEqual(cards.find(card => card.kind === 'heatmap')?.heat?.map(spot => [spot.x, spot.y]), [[0.5, 0.5]]);
  assert.equal(cards.find(card => card.kind === 'top')?.spots?.length, 1);
});

test('normal history drives top five, weighted heat, and repeated favorite', () => {
  const base = Date.UTC(2026, 3, 2);
  const records = [
    ...track(41.88, -87.63, base),
    ...track(41.9, -87.61, base + 40 * minute),
    ...track(41.88, -87.63, base + 80 * minute),
    ...track(41.92, -87.59, base + 120 * minute),
  ];
  const cards = story(records);
  assert.equal(cards.find(card => card.kind === 'places')?.metric, '3 places');
  assert.match(cards.find(card => card.kind === 'favorite')?.caption ?? '', /2 visits/);
  assert.equal(cards.find(card => card.kind === 'top')?.spots?.length, 3);
  const heat = cards.find(card => card.kind === 'heatmap')?.heat ?? [];
  assert.equal(heat.length, 3);
  assert.equal(Math.max(...heat.map(spot => spot.intensity)), 1);
  assert.ok(heat.every(spot => spot.x >= 0 && spot.x <= 1 && spot.y >= 0 && spot.y <= 1));
});

test('demo mode has a distinct ten-card sample flow', () => {
  const cards = generateDemoWrapped();
  assert.deepEqual(cards.map(card => card.kind), ['intro', 'distance', 'places', 'favorite', 'time', 'month', 'personality', 'heatmap', 'top', 'summary']);
  assert.match(cards[0].kicker, /DEMO/);
  assert.equal(cards.find(card => card.kind === 'top')?.spots?.length, 5);
});