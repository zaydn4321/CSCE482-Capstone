import type { WrappedCard } from './wrappedGenerator';
import { demoStatistics } from './demoData.ts';

export type ShareMode = 'real' | 'demo';
export type PersistedMode = ShareMode | 'new';
export type ShareCardContent = {
  kind: 'summary' | 'top';
  label: string;
  title: string;
  metric: string;
  caption: string;
  places: { rank: number; name: string; visits: number; duration: string }[];
  sample: boolean;
};

/** Demo previews belong to the selected story, not the user's persisted tracking mode. */
export function shouldKeepSharePreview(
  previewMode: ShareMode,
  selectedStoryMode: ShareMode | null,
  persistedMode: PersistedMode,
  hasVisits: boolean,
  sourceMatches: boolean,
): boolean {
  if (selectedStoryMode !== previewMode || !sourceMatches) return false;
  return previewMode === 'demo' || (persistedMode === 'real' && hasVisits);
}

const coordinateLike = /(?:^|\b)-?\d{1,2}\.\d{3,}\s*[,/]\s*-?\d{1,3}\.\d{3,}(?:\b|$)/;
const addressLike = /\b(?:\d{1,6}\s+(?:[\p{L}\d.'-]+\s+){1,3}(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way|highway|hwy\.?)|(?:home|my house|my home|residence|apartment|my place|home address))\b/iu;
const dateLike = /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/g;

export function safePlaceName(value: string, rank: number): string {
  const raw = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(dateLike, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || coordinateLike.test(raw) || addressLike.test(raw) || /\b(?:lat(?:itude)?|lon(?:gitude)?|gps|coordinates?)\b/i.test(raw)) {
    return `Place ${rank}`;
  }
  const safe = raw
    .replace(/[^\p{L}\p{N}\s&'’.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 38)
    .trim();
  return safe || `Place ${rank}`;
}

/**
 * Builds an allow-listed, privacy-safe share payload from the two shareable
 * Wrapped kinds. This intentionally never copies raw GPS, place IDs, dates,
 * categories, first/last visit timestamps, or unfiltered source card content.
 */
export function buildShareContent(card: WrappedCard, mode: ShareMode): ShareCardContent | null {
  if (card.kind !== 'summary' && card.kind !== 'top') return null;
  const sample = mode === 'demo';
  const places = card.kind === 'top'
    ? (card.spots ?? []).slice(0, 5).map((spot, index) => ({
      rank: index + 1,
      name: sample ? safePlaceName(spot.name, index + 1) : `Place ${index + 1}`,
      visits: Number.isFinite(spot.visits) ? Math.max(0, Math.floor(spot.visits)) : 0,
      duration: spot.duration.replace(dateLike, '').replace(/[^\p{L}\p{N}\s·]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24),
    }))
    : [];

  return {
    kind: card.kind,
    label: sample ? 'DEMO / SAMPLE' : 'LOCATION WRAPPED',
    title: card.kind === 'summary' ? 'Your year in places.' : 'The places you returned to.',
    metric: card.kind === 'summary'
      ? sample
        ? `${demoStatistics.daysTracked} days  ·  ${demoStatistics.placesVisited} places`
        : safeSummaryMetric(card.metric)
      : `${places.length} ${places.length === 1 ? 'favorite place' : 'favorite places'}`,
    caption: sample
      ? 'Sample story only. This is not your personal location history.'
      : card.kind === 'summary'
        ? 'A year in places, made from the moments you chose to record.'
        : 'Ranked by observed visits. Personal place names are hidden for privacy.',
    places,
    sample,
  };
}

function safeSummaryMetric(metric: string): string {
  const match = metric.match(/^\s*(\d{1,6})\s+days?\s*[·,]\s*(\d{1,6})\s+places?\s*$/i);
  return match ? `${match[1]} ${Number(match[1]) === 1 ? 'day' : 'days'}  ·  ${match[2]} ${Number(match[2]) === 1 ? 'place' : 'places'}` : 'Your story in places';
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Standalone 1080×1350 artwork for the browser's SVG → PNG download/share flow. */
export function buildShareSvg(content: ShareCardContent): string {
  const topRows = content.places.map((place, index) => {
    const y = 650 + index * 104;
    return `<text x="96" y="${y}" fill="#B6F35B" font-family="Arial,sans-serif" font-size="25" font-weight="700">${String(place.rank).padStart(2, '0')}</text><text x="164" y="${y}" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="30" font-weight="700">${escapeXml(place.name)}</text><text x="164" y="${y + 38}" fill="#C7C4D2" font-family="Arial,sans-serif" font-size="21">${place.visits} ${place.visits === 1 ? 'visit' : 'visits'}${place.duration ? `  ·  ${escapeXml(place.duration)}` : ''}</text>`;
  }).join('');
  const metricSize = content.metric.length > 20 ? 60 : 75;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#29204A"/><stop offset="0.6" stop-color="#171627"/><stop offset="1" stop-color="#101018"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#bg)"/><circle cx="935" cy="176" r="245" fill="none" stroke="#B6F35B" stroke-opacity=".26" stroke-width="2"/><circle cx="935" cy="176" r="170" fill="none" stroke="#D858B0" stroke-opacity=".35" stroke-width="2"/><text x="96" y="112" fill="#B6F35B" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="5">${escapeXml(content.label)}</text><text x="96" y="310" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="72" font-weight="700">${escapeXml(content.title)}</text>${content.kind === 'summary' ? `<text x="96" y="525" fill="#B6F35B" font-family="Arial,sans-serif" font-size="${metricSize}" font-weight="700">${escapeXml(content.metric)}</text>` : `<text x="96" y="486" fill="#B6F35B" font-family="Arial,sans-serif" font-size="32" font-weight="700">${escapeXml(content.metric)}</text>${topRows}`}<text x="96" y="1147" fill="#D2CFDE" font-family="Arial,sans-serif" font-size="27">${escapeXml(content.caption)}</text><path d="M96 1214H984" stroke="#FFFFFF" stroke-opacity=".25"/><text x="96" y="1280" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="23" font-weight="700" letter-spacing="4">LOCATION WRAPPED</text><text x="984" y="1280" fill="#B6F35B" text-anchor="end" font-family="Arial,sans-serif" font-size="20">PRIVATE BY DESIGN</text></svg>`;
}