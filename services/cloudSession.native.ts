import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'location-wrapped-cloud-session-v1';
const LEGACY_KEYS = [
  'location-wrapped-cloud-token-v1',
  'location-wrapped-cloud-account-v1',
  'location-wrapped-cloud-backup-consent-v1',
];
type StoredSession = {
  version: 1;
  token: string | null;
  accountId: number | null;
  consentAccountId: number | null;
};
let writes: Promise<void> = Promise.resolve();

function serializeWrite(action: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(action);
  writes = next;
  return next;
}

async function readEnvelope(): Promise<StoredSession | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (parsed.version !== 1 ||
      (parsed.token !== null && typeof parsed.token !== 'string') ||
      (parsed.accountId !== null && (!Number.isInteger(parsed.accountId) || parsed.accountId! < 1)) ||
      (parsed.consentAccountId !== null && (!Number.isInteger(parsed.consentAccountId) || parsed.consentAccountId! < 1))) return null;
    return {
      version: 1,
      token: parsed.token ?? null,
      accountId: parsed.accountId ?? null,
      consentAccountId: parsed.consentAccountId ?? null,
    };
  } catch {
    return null;
  }
}

async function writeEnvelope(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

async function clearLegacyKeys(): Promise<void> {
  for (const key of LEGACY_KEYS) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      try {
        // A failed delete must not leave a usable legacy bearer token behind.
        await SecureStore.setItemAsync(key, '');
      } catch {
        throw new Error('A previously stored cloud credential could not be invalidated safely.');
      }
    }
  }
}

const tombstone: StoredSession = { version: 1, token: null, accountId: null, consentAccountId: null };

export const cloudSessionAvailable = true;
export const cloudSession = {
  getToken: async () => {
    const session = await readEnvelope();
    return session && session.accountId !== null && session.token ? session.token : null;
  },
  saveSession: (token: string, accountId: number) => serializeWrite(async () => {
    const current = await readEnvelope();
    await writeEnvelope({
      version: 1,
      token,
      accountId,
      consentAccountId: current?.accountId === accountId && current.consentAccountId === accountId ? accountId : null,
    });
    await clearLegacyKeys();
  }),
  getAccountId: async () => {
    const session = await readEnvelope();
    return session?.token ? session.accountId : null;
  },
  clearSession: () => serializeWrite(async () => {
    let tombstoneWritten = false;
    try {
      await writeEnvelope(tombstone);
      tombstoneWritten = true;
    } catch {
      // If tombstoning fails, still attempt to remove the one-key envelope below.
    }
    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    } catch (error) {
      if (!tombstoneWritten) {
        throw new Error(`Cloud credentials could not be cleared safely. ${error instanceof Error ? error.message : ''}`);
      }
      // The remaining value is a token-free tombstone, so no credential remains usable.
    }
    await clearLegacyKeys();
  }),
  hasConsent: async (accountId: number) => {
    const session = await readEnvelope();
    return session?.accountId === accountId && session.consentAccountId === accountId;
  },
  setConsent: (accountId: number, enabled: boolean) => serializeWrite(async () => {
    const current = await readEnvelope();
    if (!current?.token || current.accountId !== accountId) throw new Error('Cloud consent must belong to the verified signed-in account.');
    await writeEnvelope({
      ...current,
      consentAccountId: enabled ? accountId : null,
    });
    await clearLegacyKeys();
  }),
};