import qrcode from 'qrcode-generator';

const BORDER = 2;
// Two modules to a character, the upper and the lower.
const HALF = { '11': '█', '10': '▀', '01': '▄', '00': ' ' } as const;

// The address as a QR code for the phone's camera, drawn black on white whatever the terminal's colors.
// A local address has nothing for a phone to open, so it gets none.
export function originQr(origin: string): string {
  if (!origin.startsWith('https://')) return '';
  const qr = qrcode(0, 'M');
  qr.addData(origin);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + 2 * BORDER;
  const dark = (r: number, c: number) => r >= BORDER && c >= BORDER && r < BORDER + n && c < BORDER + n && qr.isDark(r - BORDER, c - BORDER);
  const lines: string[] = [];
  for (let r = 0; r < size; r += 2) {
    let line = '';
    for (let c = 0; c < size; c++) line += HALF[`${+dark(r, c)}${+dark(r + 1, c)}` as keyof typeof HALF];
    lines.push(`\x1b[30;47m${line}\x1b[0m`);
  }
  return lines.join('\n');
}

// The same, as an SVG for a page: the setup wizard's last step.
export function originQrSvg(origin: string): string {
  if (!origin.startsWith('https://')) return '';
  const qr = qrcode(0, 'M');
  qr.addData(origin);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4 * 6, scalable: true });
}
