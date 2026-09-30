import { demoPlaces, demoStatistics } from './demoData.ts';
import type { Statistics } from './statisticsService';
import type { ProcessedPlace, Visit } from './visitProcessor';

export type WrappedKind = 'intro' | 'distance' | 'places' | 'favorite' | 'time' | 'month' | 'personality' | 'heatmap' | 'top' | 'summary';
export type WrappedTheme = 'purple' | 'lime' | 'orange' | 'blue';
export type WrappedSpot = { id: string; name: string; visits: number; duration: string };
export type HeatSpot = { id: string; x: number; y: number; intensity: number };
export type WrappedCard = {
  kind: WrappedKind;
  kicker: string;
  title: string;
  metric: string;
  caption: string;
  theme: WrappedTheme;
  spots?: WrappedSpot[];
  heat?: HeatSpot[];
};

function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function name(place: ProcessedPlace | null): string {
  return place?.name?.trim() || (place ? `${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}` : 'No observed place yet');
}

function monthLabel(month: string | null): string {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 'Not enough history yet';
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function personality(statistics: Statistics): { label: string; description: string } {
  if (!statistics.totalVisits) return { label: 'Just beginning', description: 'Keep exploring; your places will shape this story.' };
  if (statistics.uniquePlaces <= 2) return { label: 'Local', description: 'Your most familiar places are a big part of your story.' };
  if (statistics.uniquePlaces >= 12 && statistics.totalVisits / statistics.uniquePlaces < 2) return { label: 'Explorer', description: 'You found new places more often than you returned.' };
  if (statistics.totalVisits / statistics.uniquePlaces >= 3) return { label: 'Regular', description: 'You have places worth coming back to.' };
  return { label: 'Wanderer', description: 'A mix of familiar favorites and new discoveries.' };
}

/** Geographic normalized positions, weighted by observed visits rather than raw GPS pings. */
function heatSpots(places: ProcessedPlace[], visits: Visit[]): HeatSpot[] {
  if (!places.length) return [];
  const usable = places.filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  if (!usable.length) return [];
  const lons = usable.map(place => place.lng);
  const lats = usable.map(place => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, place.lat)) * Math.PI / 360)));
  const minX = Math.min(...lons), maxX = Math.max(...lons);
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const counts = new Map<string, number>();
  for (const visit of visits) counts.set(visit.placeId, (counts.get(visit.placeId) ?? 0) + 1);
  const maxVisits = Math.max(1, ...usable.map(place => counts.get(place.id) ?? place.visitCount));
  return usable.map((place, index) => ({
    id: place.id,
    x: minX === maxX ? 0.5 : 0.1 + 0.8 * (place.lng - minX) / (maxX - minX),
    y: minY === maxY ? 0.5 : 0.1 + 0.8 * (maxY - lats[index]) / (maxY - minY),
    intensity: (counts.get(place.id) ?? place.visitCount) / maxVisits,
  }));
}

/** Statistics → Wrapped data. The view never invents statistics or personal locations. */
export function generateWrapped(statistics: Statistics, places: ProcessedPlace[], visits: Visit[]): WrappedCard[] {
  const favorite = statistics.mostVisitedPlace;
  const longest = statistics.mostTimePlace;
  const top = statistics.topPlaces.slice(0, 5);
  const persona = personality(statistics);
  const distanceKm = Number.isFinite(statistics.distanceKm) ? Math.max(0, statistics.distanceKm) : 0;
  const count = statistics.uniquePlaces;
  return [
    { kind: 'intro', kicker: 'YOUR LOCATION WRAPPED', title: 'This was your year.', metric: `${statistics.daysTracked} ${statistics.daysTracked === 1 ? 'day' : 'days'}`, caption: statistics.daysTracked ? 'An observed story, made from the moments you chose to record.' : 'Your story will grow as visits are recorded.', theme: 'purple' },
    { kind: 'distance', kicker: 'THE DISTANCE', title: 'Every little journey counts.', metric: `${distanceKm.toFixed(1)} km`, caption: distanceKm ? 'Distance estimated from observed, plausible GPS segments.' : 'No meaningful travel distance observed yet.', theme: 'lime' },
    { kind: 'places', kicker: 'THE PLACES', title: 'A map of your moments.', metric: `${count} ${count === 1 ? 'place' : 'places'}`, caption: count ? `${statistics.totalVisits} observed ${statistics.totalVisits === 1 ? 'visit' : 'visits'} across your places.` : 'Stay somewhere long enough to record your first visit.', theme: 'orange' },
    { kind: 'favorite', kicker: 'MOST VISITED', title: 'The place you returned to.', metric: name(favorite), caption: favorite ? `${favorite.visitCount} ${favorite.visitCount === 1 ? 'visit' : 'visits'} here.` : 'No return visits observed yet.', theme: 'blue' },
    { kind: 'time', kicker: 'MOST TIME SPENT', title: 'Where time slowed down.', metric: name(longest), caption: longest ? `${duration(longest.totalTimeMs)} of observed time.` : 'A longer observed stay will appear here.', theme: 'purple' },
    { kind: 'month', kicker: 'MOST ACTIVE MONTH', title: 'Your busiest chapter.', metric: monthLabel(statistics.mostActiveMonth), caption: statistics.mostActiveMonth ? 'The month with the most recorded location points.' : 'A month of observations will appear here.', theme: 'orange' },
    { kind: 'personality', kicker: 'YOUR LOCATION PERSONALITY', title: 'A pattern, not a label.', metric: persona.label, caption: persona.description, theme: 'lime' },
    { kind: 'heatmap', kicker: 'YOUR PLACE HEATMAP', title: 'Where you spent your days.', metric: `${count} observed ${count === 1 ? 'place' : 'places'}`, caption: count ? 'Brighter spots represent more visits, not more GPS points.' : 'Visit a place to begin filling your map.', heat: heatSpots(places, visits), theme: 'blue' },
    { kind: 'top', kicker: 'YOUR TOP FIVE', title: 'The places that stayed with you.', metric: `${top.length} ${top.length === 1 ? 'place' : 'places'}`, caption: top.length ? 'Ranked by observed visit count.' : 'Your favorites will appear after a visit.', spots: top.map(place => ({ id: place.id, name: name(place), visits: place.visitCount, duration: duration(place.totalTimeMs) })), theme: 'purple' },
    { kind: 'summary', kicker: 'THAT WAS YOUR WRAPPED', title: 'Every place means something.', metric: `${statistics.daysTracked} days · ${count} places`, caption: count ? 'Your observed history is yours to keep, pause, or delete.' : 'This story is just beginning. Come back after collecting some visits.', theme: 'lime' },
  ];
}

/** Demo story is generated in the same data layer and remains explicitly sample-only. */
export function generateDemoWrapped(): WrappedCard[] {
  const spots: WrappedSpot[] = demoPlaces.map(place => ({ id: place.id, name: place.name, visits: place.visits, duration: place.timeSpent }))
    .sort((a, b) => b.visits - a.visits).slice(0, 5);
  const heat: HeatSpot[] = (() => {
    const minLat = Math.min(...demoPlaces.map(place => place.lat)), maxLat = Math.max(...demoPlaces.map(place => place.lat));
    const minLng = Math.min(...demoPlaces.map(place => place.lng)), maxLng = Math.max(...demoPlaces.map(place => place.lng));
    return demoPlaces.map(place => ({ id: place.id, x: .1 + .8 * (place.lng - minLng) / (maxLng - minLng), y: .1 + .8 * (maxLat - place.lat) / (maxLat - minLat), intensity: place.visits / 18 }));
  })();
  return [
    { kind: 'intro', kicker: 'DEMO / SAMPLE STORY', title: 'This was your year.', metric: `${demoStatistics.daysTracked} days`, caption: 'A sample story. None of this is your personal tracking history.', theme: 'purple' },
    { kind: 'distance', kicker: 'DEMO / DISTANCE', title: 'Every little journey counts.', metric: `${demoStatistics.distanceKm} km`, caption: 'A sample distance, not your travels.', theme: 'lime' },
    { kind: 'places', kicker: 'DEMO / PLACES', title: 'A map of your moments.', metric: `${demoStatistics.placesVisited} places`, caption: 'Sample places explored throughout the year.', theme: 'orange' },
    { kind: 'favorite', kicker: 'DEMO / MOST VISITED', title: 'The place you returned to.', metric: demoStatistics.mostVisitedPlace, caption: '18 sample visits to the Lakefront Trail.', theme: 'blue' },
    { kind: 'time', kicker: 'DEMO / MOST TIME SPENT', title: 'Where time slowed down.', metric: 'Lakefront Trail', caption: '23h 40m in this sample story.', theme: 'purple' },
    { kind: 'month', kicker: 'DEMO / ACTIVE MONTH', title: 'Your busiest chapter.', metric: demoStatistics.mostActiveMonth, caption: 'An illustrative month from the sample year.', theme: 'orange' },
    { kind: 'personality', kicker: 'DEMO / PERSONALITY', title: 'A pattern, not a label.', metric: 'Explorer', caption: 'A sample identity drawn from an example year.', theme: 'lime' },
    { kind: 'heatmap', kicker: 'DEMO / HEATMAP', title: 'Where you spent your days.', metric: '5 sample spots', caption: 'Brighter sample spots mean more visits.', heat, theme: 'blue' },
    { kind: 'top', kicker: 'DEMO / TOP FIVE', title: 'The places that stayed with you.', metric: '5 favorite spots', caption: 'Five named sample locations from the demo map.', spots, theme: 'purple' },
    { kind: 'summary', kicker: 'DEMO / THE END', title: 'Every place means something.', metric: 'Your story is next.', caption: 'Turn on tracking to begin your own, separate history.', theme: 'lime' },
  ];
}