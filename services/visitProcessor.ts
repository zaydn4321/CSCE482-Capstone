export type RawLocation = { lat: number; lng: number; timestamp: number; accuracy: number };

export type Visit = {
  id: string;
  placeId: string;
  arrivedAt: number;
  departedAt: number;
  durationMs: number;
  lat: number;
  lng: number;
  pointCount: number;
};

export type ProcessedPlace = {
  id: string;
  lat: number;
  lng: number;
  visitCount: number;
  totalTimeMs: number;
  firstVisit: number;
  latestVisit: number;
  name?: string;
  category?: string;
};

const EARTH_RADIUS_M = 6_371_000;
const MIN_MOVEMENT_M = 25;
const STATIONARY_SAMPLE_MS = 2 * 60_000;
const MAX_VISIT_GAP_MS = 30 * 60_000;
const VISIT_RADIUS_M = 120;
const MIN_VISIT_DURATION_MS = 8 * 60_000;
const MIN_VISIT_POINTS = 2;
export const PLACE_MATCH_RADIUS_M = 150;

function isValidLocation(point: RawLocation): boolean {
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
    Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180 &&
    Number.isFinite(point.timestamp) && point.timestamp >= 0 &&
    Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 100;
}

export function distanceMeters(a: Pick<RawLocation, 'lat' | 'lng'>, b: Pick<RawLocation, 'lat' | 'lng'>): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/** Reject noisy/repeated samples, while retaining a two-minute stationary heartbeat. */
export function filterLocationPoint(previous: RawLocation | null, next: RawLocation): boolean {
  if (!isValidLocation(next)) return false;
  if (previous === null) return true;
  if (!isValidLocation(previous) || next.timestamp <= previous.timestamp) return false;

  const movedMeters = distanceMeters(previous, next);
  const elapsedMs = next.timestamp - previous.timestamp;
  return movedMeters >= MIN_MOVEMENT_M || (movedMeters < MIN_MOVEMENT_M && elapsedMs >= STATIONARY_SAMPLE_MS);
}

function stableCoordinate(value: number): string {
  return value.toFixed(5).replace('-', 'm').replace('.', 'p');
}

function makeStableId(prefix: string, timestamp: number, lat: number, lng: number, used: Set<string>): string {
  const base = `${prefix}-${timestamp}-${stableCoordinate(lat)}-${stableCoordinate(lng)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

type PlaceAnchor = { id: string; lat: number; lng: number };

/**
 * Turns accepted samples into observed dwell clusters. A long gap always breaks a
 * cluster, so elapsed time without observations is never counted as a visit.
 */
export function processVisits(records: RawLocation[]): Visit[] {
  const ordered = [...records].filter(isValidLocation).sort((a, b) =>
    a.timestamp - b.timestamp || a.lat - b.lat || a.lng - b.lng,
  );
  const accepted: RawLocation[] = [];
  for (const point of ordered) {
    if (filterLocationPoint(accepted.at(-1) ?? null, point)) accepted.push(point);
  }

  const clusters: RawLocation[][] = [];
  let cluster: RawLocation[] = [];
  let centerLat = 0;
  let centerLng = 0;
  const finishCluster = () => {
    if (cluster.length >= MIN_VISIT_POINTS &&
      cluster[cluster.length - 1].timestamp - cluster[0].timestamp >= MIN_VISIT_DURATION_MS) {
      clusters.push(cluster);
    }
    cluster = [];
    centerLat = 0;
    centerLng = 0;
  };

  for (const point of accepted) {
    const previous = cluster.at(-1);
    const gapTooLong = previous !== undefined && point.timestamp - previous.timestamp > MAX_VISIT_GAP_MS;
    const outsideVisit = cluster.length > 0 && distanceMeters({ lat: centerLat, lng: centerLng }, point) > VISIT_RADIUS_M;
    if (gapTooLong || outsideVisit) finishCluster();
    if (cluster.length === 0) {
      centerLat = point.lat;
      centerLng = point.lng;
    } else {
      centerLat = (centerLat * cluster.length + point.lat) / (cluster.length + 1);
      centerLng = (centerLng * cluster.length + point.lng) / (cluster.length + 1);
    }
    cluster.push(point);
  }
  finishCluster();

  const visits: Visit[] = [];
  const usedVisitIds = new Set<string>();
  const placeAnchors: PlaceAnchor[] = [];
  for (const points of clusters) {
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
    const priorPlace = placeAnchors
      .map(place => ({ place, distance: distanceMeters(place, { lat, lng }) }))
      .filter(candidate => candidate.distance <= PLACE_MATCH_RADIUS_M)
      .sort((a, b) => a.distance - b.distance || a.place.id.localeCompare(b.place.id))[0]?.place;
    // Anchor identity to the first accepted point, not the moving cluster center.
    // Otherwise adding another reading to an ongoing visit changes its ID and loses local labels.
    const placeId = priorPlace?.id ?? makeStableId('place', points[0].timestamp, points[0].lat, points[0].lng, new Set(placeAnchors.map(place => place.id)));
    if (!priorPlace) placeAnchors.push({ id: placeId, lat, lng });

    visits.push({
      id: makeStableId('visit', points[0].timestamp, points[0].lat, points[0].lng, usedVisitIds),
      placeId,
      arrivedAt: points[0].timestamp,
      departedAt: points[points.length - 1].timestamp,
      durationMs: points[points.length - 1].timestamp - points[0].timestamp,
      lat,
      lng,
      pointCount: points.length,
    });
  }
  return visits;
}

/** Aggregate visits by their deterministic place identity. */
export function processPlaces(visits: Visit[]): ProcessedPlace[] {
  const places = new Map<string, ProcessedPlace>();
  for (const visit of [...visits].sort((a, b) => a.arrivedAt - b.arrivedAt || a.id.localeCompare(b.id))) {
    const place = places.get(visit.placeId);
    if (place) {
      place.visitCount += 1;
      place.totalTimeMs += visit.durationMs;
      place.latestVisit = Math.max(place.latestVisit, visit.arrivedAt);
    } else {
      places.set(visit.placeId, {
        id: visit.placeId,
        lat: visit.lat,
        lng: visit.lng,
        visitCount: 1,
        totalTimeMs: visit.durationMs,
        firstVisit: visit.arrivedAt,
        latestVisit: visit.arrivedAt,
      });
    }
  }
  return [...places.values()].sort((a, b) => a.firstVisit - b.firstVisit || a.id.localeCompare(b.id));
}