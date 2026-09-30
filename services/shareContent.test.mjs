import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareContent, buildShareSvg, safePlaceName, shouldKeepSharePreview } from './shareContent.ts';

const topCard = (spots) => ({
  kind: 'top', kicker: 'YOUR TOP FIVE', title: 'The places that stayed with you.',
  metric: `${spots.length} places`, caption: 'Ranked by observed visit count.',
  theme: 'purple', spots,
});

test('coordinates, home labels, street addresses, and coordinate-like names become generic ranks', () => {
  assert.equal(safePlaceName('41.881832, -87.623177', 1), 'Place 1');
  assert.equal(safePlaceName('123 North Maple Street', 2), 'Place 2');
  assert.equal(safePlaceName('My Home', 3), 'Place 3');
  assert.equal(safePlaceName('Home', 4), 'Place 4');
  assert.equal(safePlaceName('Favorite coffee shop', 5), 'Favorite coffee shop');
});

test('top-five output is allow-listed, sanitized, limited, and excludes precise geography', () => {
  const payload = buildShareContent(topCard([
    { id: 'secret-id', name: '<script>41.881832, -87.623177</script>', visits: 9, duration: '23h 10m' },
    { id: 'two', name: '123 Oak Ave 2026-07-04', visits: 4, duration: '2h' },
    { id: 'three', name: 'Museum & Gallery', visits: 2, duration: '40m' },
    { id: 'four', name: 'Home', visits: 1, duration: '1h' },
    { id: 'five', name: 'Park', visits: 1, duration: '20m' },
    { id: 'six', name: 'Hidden sixth', visits: 1, duration: '1m' },
  ]), 'real');
  assert.equal(payload.places.length, 5);
  assert.deepEqual(payload.places.map(place => place.name), ['Place 1', 'Place 2', 'Place 3', 'Place 4', 'Place 5']);
  assert.equal(payload.label, 'LOCATION WRAPPED');
  const exported = JSON.stringify(payload) + buildShareSvg(payload);
  assert.doesNotMatch(exported, /-87\.623177|41\.881832|123 Oak|2026-07-04|secret-id|Museum|Park|Hidden sixth|<script>/i);
  assert.match(payload.caption, /personal place names are hidden/i);
});

test('demo cards retain safe sample names and replace names that look sensitive', () => {
  const payload = buildShareContent(topCard([
    { id: 'sample-1', name: 'Lakefront Trail', visits: 18, duration: '23h 40m' },
    { id: 'sample-2', name: '41.881832, -87.623177', visits: 8, duration: '4h' },
  ]), 'demo');
  assert.equal(payload.label, 'DEMO / SAMPLE');
  assert.deepEqual(payload.places.map(place => place.name), ['Lakefront Trail', 'Place 2']);
  assert.match(payload.caption, /sample/i);
  assert.doesNotMatch(JSON.stringify(payload), /41\.881832|-87\.623177/);
});

test('summary output contains only coarse aggregate metrics and mode label', () => {
  const card = {
    kind: 'summary', kicker: 'YOUR SUMMARY', title: 'Every place means something.',
    metric: '120 days · 7 places', caption: 'GPS 41.881832, -87.623177',
    theme: 'lime',
    places: [{ name: '123 Oak Street', lat: 41.8, lng: -87.6 }],
  };
  const real = buildShareContent(card, 'real');
  const sample = buildShareContent(card, 'demo');
  assert.equal(real.metric, '120 days  ·  7 places');
  assert.equal(real.label, 'LOCATION WRAPPED');
  assert.equal(sample.label, 'DEMO / SAMPLE');
  assert.equal(sample.metric, '86 days  ·  23 places');
  assert.match(sample.caption, /not your personal/i);
  assert.doesNotMatch(JSON.stringify({ real, sample }) + buildShareSvg(real), /41\.881832|-87\.623177|123 Oak|<script>/i);
});

test('other story cards cannot be exported through the sharing model', () => {
  assert.equal(buildShareContent({ kind: 'favorite', metric: 'My house at 123 Oak Street' }, 'real'), null);
});

test('selected demo story keeps its preview when persisted tracking mode is real', () => {
  assert.equal(shouldKeepSharePreview('demo', 'demo', 'real', false, true), true);
  assert.equal(shouldKeepSharePreview('demo', 'real', 'real', false, true), false);
  assert.equal(shouldKeepSharePreview('real', 'real', 'real', false, true), false);
  assert.equal(shouldKeepSharePreview('real', 'real', 'real', true, false), false);
});