import type { KeyValue } from '../base/platform';

const KEY = 'workoffdesk.keysShown';

// Whether the key bar shows above the composer: hidden until asked for, then as last left on this device.
export function createKeyBar(storage: KeyValue) {
  return {
    shown(): boolean {
      try {
        return storage.getItem(KEY) === '1';
      } catch {
        return false;
      }
    },
    show(shown: boolean): void {
      try {
        storage.setItem(KEY, shown ? '1' : '0');
      } catch {
        // Not kept.
      }
    },
  };
}
