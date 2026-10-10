import { expect, test } from '@playwright/test';
import { ORIGIN, shot, login } from '../helpers/e2e';

test.describe('the login page', () => {
  test('is where an anonymous visit lands', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await shot(page, '01-login');
  });

  test('says a password is wrong without leaving the page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('用户名').fill('alice');
    await page.getByLabel('密码').fill('wrong password!!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('用户名或密码不对');
    await shot(page, '02-login-error');
  });

  test('is where a device goes once its login is revoked from another', async ({ page, browser }) => {
    await login(page);
    const other = await browser.newContext({ baseURL: ORIGIN });
    const otherPage = await other.newPage();
    await login(otherPage);
    await page.goto('/settings');
    const rows = page.getByTestId('login-row').filter({ hasNotText: '这台设备' });
    await expect(page.getByTestId('login-row').filter({ hasText: '这台设备' })).toHaveCount(1);
    expect(await rows.count()).toBeGreaterThan(0);
    while ((await rows.count()) > 0) {
      const n = await rows.count();
      await rows.first().getByRole('button', { name: '吊销' }).click();
      await expect(rows).toHaveCount(n - 1);
    }
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/);
    await other.close();
  });
});
