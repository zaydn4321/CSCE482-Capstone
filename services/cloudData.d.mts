export type CloudPoint = {
  ts: number;
  lat: number;
  lon: number;
  accuracy?: number;
  source: 'device' | 'import';
  import_id?: string;
};
export type CloudExportPoint = {
  id: number;
  ts: number;
  lat: number;
  lon: number;
  accuracy?: number | null;
  source: 'device' | 'import';
  import_id?: string | null;
};

export type LocalCloudPoint = {
  timestamp: number;
  lat: number;
  lng: number;
  accuracy: number;
  source: 'device' | 'import';
  importId: string | null;
};

export function toCloudPoint(point: LocalCloudPoint): CloudPoint;
export function fromCloudPoint(point: CloudExportPoint): LocalCloudPoint;
export function splitIntoChunks<T>(items: T[], size?: number): T[][];
export function mergeCloudPoints(existing: LocalCloudPoint[], incoming: LocalCloudPoint[]): LocalCloudPoint[];
export function mayUploadBackup(options: { authenticated: boolean; consentEnabled: boolean; trackingMode: string }): boolean;
export function selectBackupSources<T extends { origin?: string }>(points: T[]): Omit<T, 'origin'>[];
export function isValidCloudExport(payload: unknown): boolean;
export function isValidCloudApiUrl(value: string | undefined, development?: boolean): boolean;
export function restoredTrackingPreferences(): { mode: 'real'; wantedActive: false; backgroundEnabled: false };
export function enqueueAnalysisAfterBackup(
  uploadedPoints: number,
  enqueue: () => Promise<{ job_id: string }>,
): Promise<{ analysisJobId: string | null; analysisError: string | null; cause: unknown | null }>;