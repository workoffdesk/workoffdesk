import type { KeyValue } from '../base/platform';

// Things often said to Claude, one a line, kept on this device and offered first after a `/`.
export const SNIPPETS_KEY = 'workoffdesk.snippets';

export function createSnippets(storage: KeyValue) {
  const text = () => {
    try {
      return storage.getItem(SNIPPETS_KEY) ?? '';
    } catch {
      return '';
    }
  };
  return {
    // As typed, to edit again.
    text,
    lines: () =>
      text()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    set(lines: string) {
      try {
        storage.setItem(SNIPPETS_KEY, lines);
      } catch {
        // Not kept.
      }
    },
  };
}

// The snippets holding what was typed after the `/`.
export function matchSnippets(all: string[], query: string): string[] {
  const q = query.toLowerCase();
  return all.filter((s) => s.toLowerCase().includes(q));
}
