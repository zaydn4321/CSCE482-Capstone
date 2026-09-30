type CloudRestorePoint = {
  timestamp: number;
  lat: number;
  lng: number;
  accuracy: number;
  source: 'device' | 'import';
  importId: string | null;
};

type RestoreTransaction = {
  runAsync(sql: string, ...parameters: (string | number)[]): Promise<{ changes: number }>;
};

type RestoreDatabase = {
  withExclusiveTransactionAsync(task: (transaction: RestoreTransaction) => Promise<void>): Promise<void>;
};

export function insertCloudPointsAtomically(
  database: RestoreDatabase,
  points: CloudRestorePoint[],
  canContinue?: () => boolean,
): Promise<number>;