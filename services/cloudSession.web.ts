export const cloudSessionAvailable = false;
const disabled = async (): Promise<never> => {
  throw new Error('Cloud account features are disabled in the browser. No credentials are stored here.');
};

export const cloudSession = {
  getToken: async () => null,
  saveSession: disabled,
  getAccountId: async () => null,
  clearSession: async () => {},
  hasConsent: async () => false,
  setConsent: async () => {},
};