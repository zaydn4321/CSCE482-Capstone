import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePlaceNamesAfterImportRemoval } from './placeNameReconciliation.ts';

test('moves an older imported-place label to its later surviving native visit', () => {
  const oldPlaces = [{ id: 'place-imported-old', lat: 37, lng: -122 }];
  const survivingPlaces = [{ id: 'place-native-later', lat: 37.0004, lng: -122.0002 }];
  assert.deepEqual(
    reconcilePlaceNamesAfterImportRemoval(
      { 'place-imported-old': 'Home' },
      oldPlaces,
      survivingPlaces,
    ),
    { 'place-native-later': 'Home' },
  );
});

test('keeps a surviving place name over a nearby removed label and prunes true orphans', () => {
  const oldPlaces = [
    { id: 'place-imported-old', lat: 37, lng: -122 },
    { id: 'place-gone', lat: 41, lng: -73 },
  ];
  const survivingPlaces = [{ id: 'place-native-later', lat: 37.0004, lng: -122.0002 }];
  assert.deepEqual(
    reconcilePlaceNamesAfterImportRemoval(
      { 'place-imported-old': 'Old Home', 'place-native-later': 'My Home', 'place-gone': 'Former office' },
      oldPlaces,
      survivingPlaces,
    ),
    { 'place-native-later': 'My Home' },
  );
});

test('does not transfer a label to a place outside the visit matching radius', () => {
  assert.deepEqual(
    reconcilePlaceNamesAfterImportRemoval(
      { 'place-imported-old': 'Home' },
      [{ id: 'place-imported-old', lat: 37, lng: -122 }],
      [{ id: 'place-native-later', lat: 37.01, lng: -122 }],
    ),
    {},
  );
});