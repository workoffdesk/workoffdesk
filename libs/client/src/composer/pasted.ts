type Clipboard = { getData(type: string): string; items: ArrayLike<{ getAsFile(): File | null }> };

// What a paste brings to attach: its files, when it brings no text. A screenshot copied to the clipboard is a
// picture alone; a copy from a spreadsheet or a document also carries a picture of itself, and goes in as text.
export function pastedFiles(data: Clipboard | null): File[] {
  if (!data || data.getData('text/plain').trim()) return [];
  return Array.from(data.items).flatMap((item) => item.getAsFile() ?? []);
}
