import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceDetailModel,
  clusterPlaces,
  fitMap,
  projectPlace,
} from './placesMapModel.ts';

const onePlace = {
  id: 'place-a',
  lat: 41.88,
  lng: -87.63,
  title: 'Corner café',
  category: 'Coffee',
  visitCount: 2,
  totalTimeMs: 3_600_000,
  firstVisit: 1_700_000_000_000,
  latestVisit: 1_710_000_000_000,
  demo: false,
};

const places = [
  onePlace,
  { ...onePlace, id: 'place-b', lat: 41.8805, lng: -87.6295, title: 'Bookshop', visitCount: 1 },
  { ...onePlace, id: 'place-c', lat: 41.91, lng: -87.6, title: 'Park', visitCount: 4 },
];

const visits = [
  { id: 'visit-a-old', placeId: 'place-a', arrivedAt: 100, departedAt: 200, durationMs: 100 },
  { id: 'visit-b', placeId: 'place-b', arrivedAt: 300, departedAt: 500, durationMs: 200 },
  { id: 'visit-a-new', placeId: 'place-a', arrivedAt: 600, departedAt: 900, durationMs: 300 },
];

test('projection anchors a one-place dataset and follows geographic direction', () => {
  const center = { lat: onePlace.lat, lng: onePlace.lng };
  const screenCenter = projectPlace(onePlace, center, 14, 400, 360);
  assert.deepEqual(screenCenter, { x: 200, y: 180 });
  assert.ok(projectPlace({ lat: 0, lng: 1 }, { lat: 0, lng: 0 }, 3, 400, 360).x > 200);
  assert.ok(projectPlace({ lat: 1, lng: 0 }, { lat: 0, lng: 0 }, 3, 400, 360).y < 180);
});

test('fit handles one-place, empty, and normal multi-place datasets', () => {
  assert.deepEqual(fitMap([onePlace], 400, 360), {
    center: { lat: onePlace.lat, lng: onePlace.lng },
    zoom: 14,
  });
  assert.equal(fitMap([], 400, 360), null);

  const fit = fitMap(places, 400, 360);
  assert.ok(fit);
  assert.ok(Math.abs(fit.center.lat - (onePlace.lat + places[2].lat) / 2) < 1e-9);
  assert.ok(Math.abs(fit.center.lng - (onePlace.lng + places[2].lng) / 2) < 1e-9);
  assert.ok(fit.zoom >= 3 && fit.zoom <= 15);
  const projected = places.map(place => projectPlace(place, fit.center, fit.zoom, 400, 360));
  assert.ok(projected.every(point => point.x >= 45 && point.x <= 355 && point.y >= 45 && point.y <= 315));
});

test('clustering preserves a single marker and groups overlapping nearby places', () => {
  const singleFit = fitMap([onePlace], 400, 360);
  assert.ok(singleFit);
  const singleGroups = clusterPlaces([onePlace], singleFit.center, singleFit.zoom, 400, 360);
  assert.equal(singleGroups.length, 1);
  assert.deepEqual(singleGroups[0].places.map(place => place.id), ['place-a']);

  const center = { lat: 41.895, lng: -87.615 };
  const groups = clusterPlaces(places, center, 12, 400, 360);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.places.map(place => place.id).sort()).sort(), [
    ['place-a', 'place-b'],
    ['place-c'],
  ]);
  assert.equal(groups.find(group => group.places.length === 2)?.visits, 3);
});

test('detail model retains a single place summary and its ordered visits', () => {
  const detail = buildPlaceDetailModel(onePlace, visits);
  assert.equal(detail.id, onePlace.id);
  assert.equal(detail.title, onePlace.title);
  assert.equal(detail.category, onePlace.category);
  assert.equal(detail.visitCount, 2);
  assert.equal(detail.totalTimeMs, 3_600_000);
  assert.equal(detail.firstVisit, onePlace.firstVisit);
  assert.equal(detail.latestVisit, onePlace.latestVisit);
  assert.deepEqual(detail.visits.map(visit => visit.id), ['visit-a-new', 'visit-a-old']);
});

test('detail models remain isolated across a normal multi-place dataset', () => {
  const details = places.map(place => buildPlaceDetailModel(place, visits));
  assert.deepEqual(details.map(detail => detail.id), ['place-a', 'place-b', 'place-c']);
  assert.deepEqual(details.map(detail => detail.visits.map(visit => visit.id)), [
    ['visit-a-new', 'visit-a-old'],
    ['visit-b'],
    [],
  ]);

  const demoDetail = buildPlaceDetailModel({ ...onePlace, demo: true }, visits);
  assert.deepEqual(demoDetail.visits, []);
});