import { distanceMeters, PLACE_MATCH_RADIUS_M, type ProcessedPlace } from './visitProcessor.ts';

type PlaceIdentity = Pick<ProcessedPlace, 'id' | 'lat' | 'lng'>;

/**
 * Reattach names from removed place identities to the nearest surviving
 * physical place, while preserving names already assigned to surviving IDs.
 */
export function reconcilePlaceNamesAfterImportRemoval(
  names: Record<string, string>,
  oldPlaces: readonly PlaceIdentity[],
  survivingPlaces: readonly PlaceIdentity[],
): Record<string, string> {
  const survivingById = new Map(survivingPlaces.map(place => [place.id, place]));
  const reconciled: Record<string, string> = {};

  for (const place of survivingPlaces) {
    const name = names[place.id];
    if (name) reconciled[place.id] = name;
  }

  const oldById = new Map(oldPlaces.map(place => [place.id, place]));
  for (const [oldId, name] of Object.entries(names).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name || survivingById.has(oldId)) continue;
    const oldPlace = oldById.get(oldId);
    if (!oldPlace) continue;
    const nearest = survivingPlaces
      .map(place => ({ place, distance: distanceMeters(oldPlace, place) }))
      .filter(candidate => candidate.distance <= PLACE_MATCH_RADIUS_M)
      .sort((a, b) => a.distance - b.distance || a.place.id.localeCompare(b.place.id))[0]?.place;
    if (nearest && !reconciled[nearest.id]) reconciled[nearest.id] = name;
  }
  return reconciled;
}