import type { KeyValue } from '../base/platform';

// How big the app's text is, as a percentage of its designed size: this device's own choice.
const KEY = 'workoffdesk.textSize';
export const TEXT_MIN = 80;
export const TEXT_MAX = 150;
export const TEXT_STEP = 10;
const USUAL = 100;

export function createTextSize(storage: KeyValue) {
  return {
    get(): number {
      try {
        const n = Number(storage.getItem(KEY) ?? USUAL);
        if (Number.isInteger(n) && n >= TEXT_MIN && n <= TEXT_MAX) return n;
      } catch {
        // Storage can be blocked; the usual size still works.
      }
      return USUAL;
    },
    keep(n: number): void {
      try {
        storage.setItem(KEY, String(n));
      } catch {
        // Not kept, but shown until the app is closed.
      }
    },
  };
}
