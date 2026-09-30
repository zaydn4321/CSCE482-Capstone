export { processPlaces, processVisits } from './visitProcessor';
export type { ProcessedPlace, RawLocation, Visit } from './visitProcessor';

export function formatCoordinates(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
}