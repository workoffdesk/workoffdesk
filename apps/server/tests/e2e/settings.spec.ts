import { writeFileSync } from 'node:fs';
import { expect, test, type Locator } from '@playwright/test';
import { shot, login, api, clearSessions, rec, jsonl, newClaude } from '../helpers/e2e';

const fontSizeOf = (l: Locator) => l.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

test.describe('settings', () => {
  test('registers a passkey, which logs back in after a log out', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'virtual authenticators are a Chrome DevTools feature');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });

    await login(page);
    for (const p of await (await api(page, 'GET', '/api/auth/passkeys')).json()) {
      await api(page, 'DELETE', `/api/auth/passkeys/${encodeURIComponent(p.id)}`);
    }
    await page.getByRole('link', { name: '设置' }).click();
    await expect(page.getByRole('heading', { name: '已登录的设备' })).toBeVisible();
    await expect(page.getByText('还没有 Passkey')).toBeVisible();
    await page.getByRole('button', { name: '添加这台设备的 Passkey' }).click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);
    await shot(page, '12-settings');

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('button', { name: '用 Face ID 登录' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '新建会话' })).toBeVisible();
  });

  test.describe('the text size', () => {
    test('is set here, and every page is drawn at it', async ({ page }) => {
      await login(page);
      await clearSessions(page);
      await page.reload();
      const { transcript } = await newClaude(page);
      writeFileSync(transcript, jsonl(rec.user('改按钮'), rec.claude({ type: 'text', text: '改好了。' })));
      const chat = page.getByTestId('chat');
      const reply = chat.locator('.reply');
      const mine = chat.locator('.bubble.mine');
      const title = page.locator('.term-title strong');
      await expect(reply).toHaveText('改好了。');
      const before = { reply: await fontSizeOf(reply), mine: await fontSizeOf(mine), title: await fontSizeOf(title) };

      await page.getByRole('button', { name: '返回' }).click();
      const row = page.getByTestId('session-card').first();
      const rowBefore = await fontSizeOf(row.locator('.sess-name'));
      await page.getByRole('link', { name: '设置' }).click();
      const size = page.getByRole('status', { name: '文字大小' });
      await expect(size).toHaveText('100%');
      await page.getByRole('button', { name: '文字加大' }).click();
      await page.getByRole('button', { name: '文字加大' }).click();
      await expect(size).toHaveText('120%');
      await shot(page, '13-text-size');

      await page.getByRole('button', { name: '返回' }).click();
      expect(await fontSizeOf(row.locator('.sess-name'))).toBeCloseTo(rowBefore * 1.2, 1);
      await row.click();
      await expect(reply).toHaveText('改好了。');
      expect(await fontSizeOf(reply)).toBeCloseTo(before.reply * 1.2, 1);
      expect(await fontSizeOf(mine)).toBeCloseTo(before.mine * 1.2, 1);
      expect(await fontSizeOf(title)).toBeCloseTo(before.title * 1.2, 1);
      await shot(page, '14-text-size-chat');

      // It stays with this device.
      await page.reload();
      await expect(reply).toHaveText('改好了。');
      expect(await fontSizeOf(reply)).toBeCloseTo(before.reply * 1.2, 1);
    });

    test('stops at its smallest and largest, and typing never makes iOS zoom the page', async ({ page }) => {
      await login(page);
      await page.getByRole('link', { name: '设置' }).click();
      const smaller = page.getByRole('button', { name: '文字减小' });
      const bigger = page.getByRole('button', { name: '文字加大' });
      const size = page.getByRole('status', { name: '文字大小' });
      while (await smaller.isEnabled()) await smaller.click();
      await expect(size).toHaveText('80%');
      // Safari zooms into a field whose text is under 16px when it is tapped.
      await page.getByRole('button', { name: '返回' }).click();
      expect(await fontSizeOf(page.getByLabel('搜索'))).toBeGreaterThanOrEqual(16);
      await newClaude(page);
      expect(await fontSizeOf(page.getByLabel('输入'))).toBeGreaterThanOrEqual(16);
      await page.getByRole('button', { name: '返回' }).click();
      await page.getByRole('link', { name: '设置' }).click();
      while (await bigger.isEnabled()) await bigger.click();
      await expect(size).toHaveText('150%');
    });

    for (const [what, init] of [
      ['a stored size that makes no sense', () => localStorage.setItem('workoffdesk.textSize', '7000')],
      ['storage that refuses to be read', () => { Storage.prototype.getItem = () => { throw new Error('denied'); }; }],
    ] as const) {
      test(`stays at the usual size with ${what}`, async ({ page }) => {
        await login(page);
        await page.addInitScript(init);
        await page.goto('/settings');
        await expect(page.getByRole('status', { name: '文字大小' })).toHaveText('100%');
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim())).toBe('1');
      });
    }
  });
});
