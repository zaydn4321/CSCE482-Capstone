export type MapCenter = { lat: number; lng: number };
export type MapPoint = { x: number; y: number };

export type MapPlace = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  category?: string;
  visitCount: number;
  totalTimeMs?: number;
  displayTime?: string;
  firstVisit?: number | string;
  latestVisit?: number | string;
  demo: boolean;
};

export type MapVisit = {
  id: string;
  placeId: string;
  arrivedAt: number;
  departedAt: number;
  durationMs: number;
};

export type MarkerGroup = {
  key: string;
  places: MapPlace[];
  point: MapPoint;
  lat: number;
  lng: number;
  visits: number;
};

export type PlaceDetailModel = MapPlace & { visits: MapVisit[] };

const TILE_SIZE = 256;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function mercatorY(lat: number) {
  const limited = clamp(lat, -85.05112878, 85.05112878);
  const sin = Math.sin((limited * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

export function inverseMercatorY(y: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

function worldPoint(lat: number, lng: number, zoom: number): MapPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: mercatorY(lat) * scale,
  };
}

export function normalizedLongitude(lng: number) {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

export function fitMap(
  places: MapPlace[],
  width: number,
  height: number,
): { center: MapCenter; zoom: number } | null {
  if (!places.length) return null;
  const latitudes = places.map(place => clamp(place.lat, -85, 85));
  const longitudes = places.map(place => place.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const center = { lat: (minLat + maxLat) / 2, lng: normalizedLongitude((minLng + maxLng) / 2) };

  if (places.length === 1) return { center, zoom: 14 };
  const spanX = Math.max(0.0002, (maxLng - minLng) / 360);
  const spanY = Math.max(0.0002, Math.abs(mercatorY(maxLat) - mercatorY(minLat)));
  const availableWidth = Math.max(100, width - 100);
  const availableHeight = Math.max(100, height - 100);
  const zoomX = Math.log2(availableWidth / (TILE_SIZE * spanX));
  const zoomY = Math.log2(availableHeight / (TILE_SIZE * spanY));
  return { center, zoom: clamp(Math.floor(Math.min(zoomX, zoomY)), 3, 15) };
}

export function projectPlace(
  place: Pick<MapPlace, 'lat' | 'lng'>,
  center: MapCenter,
  zoom: number,
  width: number,
  height: number,
): MapPoint {
  const location = worldPoint(place.lat, place.lng, zoom);
  const origin = worldPoint(center.lat, center.lng, zoom);
  const worldSize = TILE_SIZE * 2 ** zoom;
  let dx = location.x - origin.x;
  if (dx > worldSize / 2) dx -= worldSize;
  if (dx < -worldSize / 2) dx += worldSize;
  return { x: width / 2 + dx, y: height / 2 + location.y - origin.y };
}

export function clusterPlaces(
  places: MapPlace[],
  center: MapCenter,
  zoom: number,
  width: number,
  height: number,
): MarkerGroup[] {
  const cells = new Map<string, { places: MapPlace[]; x: number; y: number }>();
  const cellSize = 48;
  places.forEach(place => {
    const point = projectPlace(place, center, zoom, width, height);
    if (point.x < -cellSize || point.y < -cellSize || point.x > width + cellSize || point.y > height + cellSize) return;
    const col = Math.floor(point.x / cellSize);
    const row = Math.floor(point.y / cellSize);
    const key = `${col}:${row}`;
    const cell = cells.get(key) ?? { places: [], x: 0, y: 0 };
    cell.places.push(place);
    cell.x += point.x;
    cell.y += point.y;
    cells.set(key, cell);
  });
  return Array.from(cells.entries()).map(([key, cell]) => {
    const count = cell.places.length;
    return {
      key,
      places: cell.places,
      point: { x: cell.x / count, y: cell.y / count },
      lat: cell.places.reduce((sum, place) => sum + place.lat, 0) / count,
      lng: cell.places.reduce((sum, place) => sum + place.lng, 0) / count,
      visits: cell.places.reduce((sum, place) => sum + place.visitCount, 0),
    };
  });
}

export function buildPlaceDetailModel(place: MapPlace, visits: MapVisit[]): PlaceDetailModel {
  const placeVisits = place.demo
    ? []
    : visits
      .filter(visit => visit.placeId === place.id)
      .slice()
      .sort((first, second) => second.arrivedAt - first.arrivedAt);
  return { ...place, visits: placeVisits };
}