import { isValidCloudApiUrl, isValidCloudExport, type CloudExportPoint, type CloudPoint } from './cloudData.mjs';

export type CloudUser = { id: number; email: string; created_at: string };
export type CloudAuthResponse = { access_token: string; token_type: 'bearer' };
export type CloudPlace = { id: number; name: string | null; category: string; lat: number; lon: number };
export type CloudVisit = {
  id: number; start_ts: number; end_ts: number; lat: number; lon: number; radius: number;
  point_count: number; label: string | null; place: CloudPlace | null; place_confidence: number | null;
};
export type CloudInterest = { category: string; weight: number; visits: number; dwell_minutes: number; hidden: boolean };
export type CloudTopPlace = { place_id: number; name: string | null; category: string; visits: number; last_visit_ts: number };
export type CloudRecommendation = { place: CloudPlace; score: number; reason: string };
export type CloudPrediction = { place: CloudPlace; probability: number; rank: number };
export type CloudExport = {
  user: CloudUser;
  exported_at: number;
  points: CloudExportPoint[];
  visits: CloudVisit[];
  interest_overrides: Array<{ category: string; hidden: boolean }>;
};
export type EnqueuedCloudJob = { job_id: string; status: 'queued' };
export type CloudJob = {
  id: string; kind: string; status: 'queued' | 'running' | 'done' | 'failed';
  created_at: string; started_at: string | null; finished_at: string | null;
  result: Record<string, unknown> | null; error: string | null; attempts: number;
};
export type CloudProfile = { generated_at: number; total_visits: number; resolved_visits: number; interests: CloudInterest[]; top_places: CloudTopPlace[] };
export type CloudRecommendations = { generated_at: number; items: CloudRecommendation[] };
export type CloudNextPlaces = { generated_at: number; at_ts: number; predictions: CloudPrediction[] };

export class CloudApiError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly code: 'unauthorized' | 'http' | 'network' | 'configuration' | 'response' | 'timeout' = 'http') {
    super(message);
    this.name = 'CloudApiError';
  }
}

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_STANDARD_RESPONSE_BYTES = 5 * 1024 * 1024;

function developmentBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function isCloudConfigured(): boolean {
  return isValidCloudApiUrl(process.env.EXPO_PUBLIC_ORBIT_API_URL, developmentBuild());
}

function baseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_ORBIT_API_URL?.trim();
  if (!configured) throw new CloudApiError('Cloud backup is not configured on this build.', null, 'configuration');
  if (!isValidCloudApiUrl(configured, developmentBuild())) {
    throw new CloudApiError('Cloud backup requires a valid HTTPS API URL (local HTTP is permitted only in development).', null, 'configuration');
  }
  const parsed = new URL(configured);
  return parsed.toString().replace(/\/+$/, '');
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const relayAbort = () => controller.abort();
  options.signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    if (response.status === 401) throw new CloudApiError('Your cloud session has expired. Sign in again.', 401, 'unauthorized');
    if (response.status === 204) {
      if (!response.ok) throw new CloudApiError(`Cloud request failed (${response.status}).`, response.status);
      return undefined as T;
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    const limit = options.maxBytes ?? MAX_STANDARD_RESPONSE_BYTES;
    if (declaredLength > limit) throw new CloudApiError('The cloud response is too large to safely process on this device.', response.status, 'response');
    let text: string;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > limit) {
          await reader.cancel();
          throw new CloudApiError('The cloud response is too large to safely process on this device.', response.status, 'response');
        }
        chunks.push(value);
      }
      const joined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      text = new TextDecoder().decode(joined);
    } else {
      text = await response.text();
      if (text.length * 2 > limit) {
        throw new CloudApiError('The cloud response is too large to safely process on this device.', response.status, 'response');
      }
    }
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; }
    catch { throw new CloudApiError('The cloud service returned an invalid response.', response.status, 'response'); }
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail : `Cloud request failed (${response.status}).`;
      throw new CloudApiError(detail.slice(0, 300), response.status, 'http');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof CloudApiError) throw error;
    if (controller.signal.aborted) {
      throw new CloudApiError(options.signal?.aborted ? 'Cloud operation was cancelled.' : 'The cloud request timed out.', null, options.signal?.aborted ? 'network' : 'timeout');
    }
    throw new CloudApiError('Could not reach the cloud service. Check your connection and try again.', null, 'network');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', relayAbort);
  }
}

export const cloudApi = {
  register: (email: string, password: string, signal?: AbortSignal) =>
    request<CloudAuthResponse>('/auth/register', { method: 'POST', body: { email, password }, signal }),
  login: (email: string, password: string, signal?: AbortSignal) =>
    request<CloudAuthResponse>('/auth/login', { method: 'POST', body: { email, password }, signal }),
  me: (token: string, signal?: AbortSignal) => request<CloudUser>('/auth/me', { token, signal }),
  deleteAccount: (token: string, signal?: AbortSignal) =>
    request<void>('/auth/me', { method: 'DELETE', token, signal }),
  uploadPoints: (token: string, points: CloudPoint[], signal?: AbortSignal) =>
    request<{ received: number; inserted: number; duplicates: number }>('/locations/batch', {
      method: 'POST', token, body: { points }, signal,
    }),
  exportAll: async (token: string, signal?: AbortSignal) => {
    const payload = await request<unknown>('/export', { token, signal, timeoutMs: 60_000, maxBytes: MAX_RESPONSE_BYTES });
    if (!isValidCloudExport(payload)) {
      throw new CloudApiError('The cloud export response contains invalid account or location data.', null, 'response');
    }
    return payload as CloudExport;
  },
  recomputeVisits: (token: string, signal?: AbortSignal) =>
    request<EnqueuedCloudJob>('/visits/recompute', { method: 'POST', token, signal }),
  getJob: (token: string, id: string, signal?: AbortSignal) =>
    request<CloudJob>(`/jobs/${encodeURIComponent(id)}`, { token, signal }),
  getProfile: (token: string, signal?: AbortSignal) => request<CloudProfile>('/profile', { token, signal }),
  updateInterest: (token: string, category: string, hidden: boolean, signal?: AbortSignal) => {
    const normalized = category.trim();
    if (!normalized) throw new CloudApiError('Interest category is required.');
    return request<CloudProfile>(`/profile/interests/${encodeURIComponent(normalized)}`, {
      method: 'PATCH', token, body: { hidden }, signal,
    });
  },
  getRecommendations: (token: string, signal?: AbortSignal) => request<CloudRecommendations>('/recommendations', { token, signal }),
  sendRecommendationFeedback: (token: string, placeId: number, action: 'saved' | 'dismissed', signal?: AbortSignal) => {
    if (!Number.isInteger(placeId) || placeId <= 0) throw new CloudApiError('Recommendation place ID must be a positive integer.');
    return request<void>(`/recommendations/${placeId}/feedback`, { method: 'POST', token, body: { action }, signal });
  },
  getNextPlace: (token: string, signal?: AbortSignal) => request<CloudNextPlaces>('/predict/next', { token, signal }),
};