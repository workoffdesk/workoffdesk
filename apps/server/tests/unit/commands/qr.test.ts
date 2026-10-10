import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { originQr, originQrSvg } from '../../../src/commands/qr.js';

const ORIGIN = 'https://workoffdesk.example.com';
const ANSI = /\x1b\[[0-9;]*m/g;

// Each character is two modules, one above the other.
const HALVES: Record<string, [boolean, boolean]> = { '█': [true, true], '▀': [true, false], '▄': [false, true], ' ': [false, false] };
const decode = (text: string) =>
  text.split('\n').flatMap((line) => {
    const cells = [...line.replace(ANSI, '')].map((ch) => HALVES[ch] ?? (() => { throw new Error(`unexpected ${JSON.stringify(ch)}`); })());
    return [cells.map((c) => c[0]), cells.map((c) => c[1])];
  });

describe('originQr and originQrSvg', () => {
  it('draws the QR code of the address, with a light border around it', () => {
    const qr = qrcode(0, 'M');
    qr.addData(ORIGIN);
    qr.make();
    const n = qr.getModuleCount();
    const rows = decode(originQr(ORIGIN));
    const border = (rows.length - n) / 2;
    expect(border).toBeGreaterThanOrEqual(1);
    const inner = rows.slice(border, border + n).map((r) => r.slice(border, border + n));
    expect(inner).toEqual(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c))));
    expect(rows.flat().filter(Boolean).length).toBe(inner.flat().filter(Boolean).length);
  });

  it('draws dark on light whatever the terminal colors are', () => {
    for (const line of originQr(ORIGIN).split('\n')) expect(line).toMatch(/^\x1b\[30;47m[█▀▄ ]+\x1b\[0m$/);
  });

  it.each(['http://localhost:7681', 'http://127.0.0.1:7681'])('draws nothing for %s, which a phone cannot open', (origin) => {
    expect(originQr(origin)).toBe('');
  });

  it('draws the same code as an SVG for a page, one dark square per dark module', () => {
    const svg = originQrSvg(ORIGIN);
    const qr = qrcode(0, 'M');
    qr.addData(ORIGIN);
    qr.make();
    let dark = 0;
    for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) dark += +qr.isDark(r, c);
    expect(svg).toMatch(/^<svg[^>]*viewBox=/);
    expect(svg.match(/M\d+,\d+l/g)?.length).toBe(dark);
    expect(originQrSvg('http://localhost:7681')).toBe('');
  });
});
