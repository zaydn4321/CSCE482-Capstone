export function toCloudPoint(point) {
  return {
    ts: point.timestamp,
    lat: point.lat,
    lon: point.lng,
    ...(Number.isFinite(point.accuracy) ? { accuracy: Math.max(0, point.accuracy) } : {}),
    source: point.source === 'import' ? 'import' : 'device',
    ...(point.source === 'import' && point.importId ? { import_id: point.importId } : {}),
  };
}

export function fromCloudPoint(point) {
  return {
    timestamp: point.ts,
    lat: point.lat,
    lng: point.lon,
    accuracy: point.accuracy ?? 0,
    source: point.source,
    importId: point.import_id ?? null,
  };
}

export function splitIntoChunks(items, size = 1000) {
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error('Invalid cloud batch size.');
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function mergeCloudPoints(existing, incoming) {
  const pointKey = point => `${point.timestamp}:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}:${point.source}:${point.importId ?? ''}`;
  const merged = new Map(existing.map(point => [pointKey(point), point]));
  for (const point of incoming) {
    const key = pointKey(point);
    if (!merged.has(key)) merged.set(key, point);
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function mayUploadBackup({ authenticated, consentEnabled, trackingMode }) {
  return authenticated === true && consentEnabled === true && trackingMode === 'real';
}

export function selectBackupSources(points) {
  return points
    .filter(point => point.origin === 'device' || point.origin === 'timeline_import')
    .map(({ origin, ...point }) => point);
}

export function isValidCloudExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const user = payload.user;
  if (!user || typeof user !== 'object' || !Number.isInteger(user.id) || user.id < 1 ||
    typeof user.email !== 'string' || !user.email.includes('@') ||
    typeof user.created_at !== 'string' || !Number.isFinite(Date.parse(user.created_at))) return false;
  if (!Number.isFinite(payload.exported_at) || payload.exported_at < 0 ||
    !Array.isArray(payload.points) || !Array.isArray(payload.visits) ||
    !Array.isArray(payload.interest_overrides)) return false;
  if (!payload.interest_overrides.every(item => item && typeof item.category === 'string' && typeof item.hidden === 'boolean')) return false;
  return payload.points.every(point => {
    if (!point || typeof point !== 'object') return false;
    return Number.isInteger(point.id) && point.id > 0 &&
      Number.isInteger(point.ts) && Number.isFinite(point.ts) && point.ts >= 0 &&
      Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
      Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180 &&
      (point.accuracy === undefined || point.accuracy === null ||
        (Number.isFinite(point.accuracy) && point.accuracy >= 0)) &&
      (point.source === 'device' || point.source === 'import') &&
      (point.import_id === undefined || point.import_id === null ||
        (typeof point.import_id === 'string' && point.import_id.length <= 64));
  });
}

export function isValidCloudApiUrl(value, development = false) {
  if (typeof value !== 'string' || !value.trim() || !/^https?:\/\//i.test(value.trim())) return false;
  try {
    const parsed = new URL(value.trim());
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const localHttp = development && parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '10.0.2.2'].includes(parsed.hostname);
    return parsed.protocol === 'https:' || localHttp;
  } catch {
    return false;
  }
}

export function restoredTrackingPreferences() {
  return { mode: 'real', wantedActive: false, backgroundEnabled: false };
}

export async function enqueueAnalysisAfterBackup(uploadedPoints, enqueue) {
  if (uploadedPoints < 1) return { analysisJobId: null, analysisError: null, cause: null };
  try {
    const job = await enqueue();
    return { analysisJobId: job.job_id, analysisError: null, cause: null };
  } catch (cause) {
    return {
      analysisJobId: null,
      analysisError: cause instanceof Error ? cause.message : 'Visit analysis could not be queued.',
      cause,
    };
  }
}