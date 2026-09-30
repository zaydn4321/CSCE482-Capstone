export declare const cloudSessionAvailable: boolean;
export declare const cloudSession: {
  getToken(): Promise<string | null>;
  saveSession(token: string, accountId: number): Promise<void>;
  getAccountId(): Promise<number | null>;
  clearSession(): Promise<void>;
  hasConsent(accountId: number): Promise<boolean>;
  setConsent(accountId: number, enabled: boolean): Promise<void>;
};