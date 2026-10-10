import { expect, test, type Page } from '@playwright/test';
import { shot, login, newSession } from '../helpers/e2e';

// iOS 26 can open a home-screen app in a view that stops short of the screen bottom by about the status bar;
// iOS paints that strip itself, in the theme colour, and the home indicator sits in it, not under the page.
async function fakeHomeScreenApp(page: Page, { standalone, shortBy = 47 }: { standalone: boolean; shortBy?: number }) {
  await page.addInitScript(({ standalone, shortBy }) => {
    const realMatch = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      const m = realMatch(q);
      if (q.includes('display-mode: standalone')) Object.defineProperty(m, 'matches', { value: standalone });
      return m;
    };
    Object.defineProperty(screen, 'height', { get: () => window.innerHeight + shortBy });
    Object.defineProperty(screen, 'width', { get: () => window.innerWidth });
    (window as unknown as { keyboard: number }).keyboard = 0;
    const realHeight = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height')!.get!;
    Object.defineProperty(VisualViewport.prototype, 'height', {
      get() { return realHeight.call(this) - (window as unknown as { keyboard: number }).keyboard; },
    });
  }, { standalone, shortBy });
}
const pageHeight = (page: Page) => page.locator('.term-page').evaluate((el) => el.getBoundingClientRect().height);
const showKeyboard = (page: Page, px: number) =>
  page.evaluate((px) => {
    (window as unknown as { keyboard: number }).keyboard = px;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, px);
const roomBelow = (page: Page) => page.locator('.term-bottom').evaluate((el) => getComputedStyle(el).paddingBottom);
const withHomeIndicatorInset = (page: Page) => page.addStyleTag({ content: ':root { --safe-bottom: 34px !important; }' });

test.describe('the session page', () => {
  test('gives the strip iOS paints below the view the colour of the key bar', async ({ page }) => {
    await login(page);
    await newSession(page);
    const bar = await page.locator('.term-bottom').evaluate((el) => getComputedStyle(el).backgroundColor);
    const theme = await page.evaluate(() => {
      const meta = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find((m) => window.matchMedia(m.media).matches);
      const probe = document.createElement('div');
      probe.style.color = meta!.content;
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    expect(theme).toBe(bar);
  });

  test.describe('as a home-screen app', () => {
    for (const shortBy of [47, 0]) {
      test(`fits a view ${shortBy ? 'short of' : 'reaching'} the screen bottom, with the key bar right above the keyboard`, async ({ page }) => {
        test.skip(!test.info().project.use.hasTouch, 'phones only');
        await fakeHomeScreenApp(page, { standalone: true, shortBy });
        await login(page);
        await newSession(page);
        await withHomeIndicatorInset(page);
        const view = await page.evaluate(() => window.innerHeight);
        await expect.poll(() => pageHeight(page)).toBe(view);
        // Room for the home indicator only when it is under the page.
        await expect.poll(() => roomBelow(page)).toBe(shortBy ? '6px' : '28px');
        await page.getByLabel('输入').focus();
        await showKeyboard(page, 300);
        await expect.poll(() => pageHeight(page)).toBe(view - 300);
        await expect.poll(() => roomBelow(page)).toBe('6px');
        await showKeyboard(page, 0);
        await expect.poll(() => pageHeight(page)).toBe(view);
        await expect.poll(() => roomBelow(page)).toBe(shortBy ? '6px' : '28px');
      });
    }

    // iOS can leave the visual viewport at its keyboard height after the keyboard is gone, and send no event
    // when it does: the keyboard is only up while something takes typing.
    for (const away of ['the composer is left', 'a message is sent'] as const) {
      test(`is the whole view again once ${away}, even if iOS still reports the keyboard`, async ({ page }) => {
        test.skip(!test.info().project.use.hasTouch, 'phones only');
        await fakeHomeScreenApp(page, { standalone: true, shortBy: 0 });
        await login(page);
        await newSession(page);
        await withHomeIndicatorInset(page);
        const view = await page.evaluate(() => window.innerHeight);
        const composer = page.getByLabel('输入');
        await composer.focus();
        await showKeyboard(page, 300);
        await expect.poll(() => pageHeight(page)).toBe(view - 300);
        const drawnKeyboard = () => page.evaluate(() => {
          const kb = document.createElement('div');
          kb.id = 'drawn-keyboard';
          kb.textContent = '（键盘）';
          kb.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:300px;background:#3a3a3c;color:#aaa;display:flex;align-items:center;justify-content:center;z-index:99';
          document.body.append(kb);
        });
        if (away === 'the composer is left') {
          await composer.fill('键盘弹起时，输入栏贴着键盘');
          await drawnKeyboard();
          await shot(page, '44-keyboard-up');
          await page.evaluate(() => document.getElementById('drawn-keyboard')!.remove());
        }
        if (away === 'a message is sent') {
          await composer.fill('echo bye');
          await composer.press('Enter');
        } else {
          await composer.blur();
        }
        await expect(composer).not.toBeFocused();
        // The stale height stays: no resize event comes.
        expect(await page.evaluate(() => window.visualViewport!.height)).toBe(view - 300);
        await expect.poll(() => pageHeight(page)).toBe(view);
        await expect.poll(() => roomBelow(page)).toBe('28px');
        const barBottom = await page.locator('.term-bottom').evaluate((el) => el.getBoundingClientRect().bottom);
        expect(barBottom).toBe(view);
        if (away === 'the composer is left') await shot(page, '45-keyboard-gone-bar-at-bottom');
      });
    }

    test('keeps the key bar above the keyboard when moving from one field to another', async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'phones only');
      await fakeHomeScreenApp(page, { standalone: true, shortBy: 0 });
      await login(page);
      await newSession(page);
      const view = await page.evaluate(() => window.innerHeight);
      await page.getByLabel('输入').focus();
      await showKeyboard(page, 300);
      await expect.poll(() => pageHeight(page)).toBe(view - 300);
      await page.evaluate(() => {
        const other = document.createElement('input');
        document.querySelector('.term-top')!.append(other);
        other.focus();
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await pageHeight(page)).toBe(view - 300);
    });

    test('fills the view when opened while iOS still reports a keyboard that is not there', async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'phones only');
      await fakeHomeScreenApp(page, { standalone: true, shortBy: 0 });
      await login(page);
      await newSession(page);
      await page.addInitScript(() => { (window as unknown as { keyboard: number }).keyboard = 300; });
      await page.reload();
      const view = await page.evaluate(() => window.innerHeight);
      expect(await page.evaluate(() => window.visualViewport!.height)).toBe(view - 300);
      await expect.poll(() => pageHeight(page)).toBe(view);
    });
  });

  test.describe('in the browser', () => {
    test('is as tall as what is visible', async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'phones only');
      await fakeHomeScreenApp(page, { standalone: false });
      await login(page);
      await newSession(page);
      const visible = await page.evaluate(() => window.visualViewport!.height);
      await expect.poll(() => pageHeight(page)).toBe(visible);
      // Safari's own toolbars make the screen taller than the page; the home indicator is still under it.
      await withHomeIndicatorInset(page);
      await expect.poll(() => roomBelow(page)).toBe('28px');
      await shot(page, '08-bottom-bar');
    });
  });
});
