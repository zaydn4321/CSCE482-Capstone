import type { ProcessedPlace, RawLocation, Visit } from './visitProcessor';

export type Statistics = {
  daysTracked: number;
  uniquePlaces: number;
  totalVisits: number;
  distanceKm: number;
  mostVisitedPlace: ProcessedPlace | null;
  mostTimePlace: ProcessedPlace | null;
  mostActiveDay: string | null;
  mostActiveMonth: string | null;
  topPlaces: ProcessedPlace[];
};

const EARTH_RADIUS_M = 6_371_000;
const MAX_ACCURACY_M = 100;
const MAX_DATE_TIMESTAMP = 8.64e15;
const MAX_DISTANCE_GAP_MS = 30 * 60_000;
const MAX_PLAUSIBLE_SPEED_MPS = 55;

function isUsable(point: RawLocation): boolean {
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
    Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180 &&
    Number.isFinite(point.timestamp) && point.timestamp >= 0 && point.timestamp <= MAX_DATE_TIMESTAMP &&
    Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= MAX_ACCURACY_M;
}

function distanceMeters(a: RawLocation, b: RawLocation): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function mostActive(counts: Map<string, number>): string | null {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** Compute UTC-calendar summaries and conservative observed point-to-point distance. */
export function calculateStatistics(
  records: RawLocation[],
  visits: Visit[],
  places: ProcessedPlace[],
): Statistics {
  const validRecords = records.filter(isUsable).sort((a, b) =>
    a.timestamp - b.timestamp || a.lat - b.lat || a.lng - b.lng,
  );
  const days = new Set<string>();
  const dayCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  for (const point of validRecords) {
    const date = new Date(point.timestamp);
    if (!Number.isFinite(date.getTime())) continue;
    const day = date.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    days.add(day);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }

  let distanceTotalMeters = 0;
  let previous: RawLocation | null = null;
  for (const point of validRecords) {
    if (previous && point.timestamp > previous.timestamp) {
      const elapsedMs = point.timestamp - previous.timestamp;
      // Long gaps and physically implausible speeds cannot safely represent a traveled route.
      if (elapsedMs <= MAX_DISTANCE_GAP_MS) {
        const segmentMeters = distanceMeters(previous, point);
        if (segmentMeters / (elapsedMs / 1000) <= MAX_PLAUSIBLE_SPEED_MPS) {
          distanceTotalMeters += segmentMeters;
        }
      }
    }
    previous = point;
  }

  const topPlaces = [...places].sort((a, b) =>
    b.visitCount - a.visitCount || b.totalTimeMs - a.totalTimeMs || a.id.localeCompare(b.id),
  );
  const mostTimePlace = [...places].sort((a, b) =>
    b.totalTimeMs - a.totalTimeMs || b.visitCount - a.visitCount || a.id.localeCompare(b.id),
  )[0] ?? null;

  return {
    daysTracked: days.size,
    uniquePlaces: places.length,
    totalVisits: visits.length,
    distanceKm: distanceTotalMeters / 1000,
    mostVisitedPlace: topPlaces[0] ?? null,
    mostTimePlace,
    mostActiveDay: mostActive(dayCounts),
    mostActiveMonth: mostActive(monthCounts),
    topPlaces,
  };
}