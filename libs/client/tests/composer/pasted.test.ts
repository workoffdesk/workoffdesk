import { describe, expect, it } from 'vitest';
import { pastedFiles } from '../../src/composer/pasted';

const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'notes.pdf', { type: 'application/pdf' });
// A clipboard as the browser hands it to a paste: its text, and an item for each thing on it.
const clipboard = (text: string, files: (File | null)[]) => ({
  getData: (type: string) => (type === 'text/plain' ? text : ''),
  items: [
    ...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : []),
    ...files.map((f) => ({ kind: 'file', type: f?.type ?? 'image/png', getAsFile: () => f })),
  ],
});

describe('pastedFiles', () => {
  it.each([
    ['a screenshot copied to the clipboard', clipboard('', [png]), [png]],
    ['several files', clipboard('', [png, pdf]), [png, pdf]],
    ['a picture with only spaces for text', clipboard(' \n', [png]), [png]],
  ])('takes what a paste brings with no text as files to attach: %s', (_, data, files) => {
    expect(pastedFiles(data)).toEqual(files);
  });

  it.each([
    ['text alone', clipboard('hello', [])],
    // A copy from a spreadsheet or a document carries a picture of itself beside its text.
    ['text with a picture of it', clipboard('A1\tB1', [png])],
    ['no clipboard', null],
    ['a file the browser could not read', clipboard('', [null])],
  ])('leaves the paste to the field otherwise: %s', (_, data) => {
    expect(pastedFiles(data)).toEqual([]);
  });
});
