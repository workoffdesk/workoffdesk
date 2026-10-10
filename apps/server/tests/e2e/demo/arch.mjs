// node arch.mjs <lang> <out dir> [times...]: renders arch.html frame by frame at 12 fps (or just the given times).
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [lang, dir, ...only] = process.argv.slice(2);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(`file://${join(import.meta.dirname, 'arch.html')}?lang=${lang}`);
await page.evaluate(() => globalThis.document.fonts.ready);
const end = await page.evaluate(() => globalThis.END);
const times = only.length ? only.map(Number) : Array.from({ length: Math.round(end * 12) }, (_, k) => k / 12);
let k = 0;
for (const t of times) {
  await page.evaluate((t) => globalThis.render(t), t);
  await page.screenshot({ path: join(dir, `${String(k++).padStart(4, '0')}.png`) });
}
await browser.close();
console.log(k, 'frames');
