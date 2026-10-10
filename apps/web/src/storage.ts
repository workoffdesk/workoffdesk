import type { KeyValue } from '@workoffdesk/client/base/platform';

// Read through each time: the browser can block storage, and then the access itself throws.
export const storage: KeyValue = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};
