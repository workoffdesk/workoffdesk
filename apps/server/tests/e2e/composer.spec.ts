import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { shot, login, clearSessions, termText, newSession, tapBar } from '../helpers/e2e';

// Reads raw input with bracketed paste on, the way Claude Code does, and prints what arrived.
const PASTE_READER = join(tmpdir(), `ts-paste-reader-${process.pid}.py`);

writeFileSync(
  PASTE_READER,
  [
    'import os, tty',
    'tty.setraw(0)',
    "os.write(1, b'\\x1b[?2004h')",
    "os.write(1, b'reader-ready\\r\\n')",
    "d = b''",
    "while not d.endswith(b'\\r') or d.count(b'\\x1b[200~') != d.count(b'\\x1b[201~'):",
    '    d += os.read(0, 4096)',
    "os.write(1, b'\\x1b[?2004l')",
    "os.write(1, ('got=' + repr(d) + '\\r\\n').encode())",
  ].join('\n'),
);

test.describe('the composer', () => {
  test('sends what is typed, and the key bar its keys, to a session opened from an empty list', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    await expect(page.getByText('还没有会话')).toBeVisible();
    await shot(page, '03-list-empty');

    await page.getByRole('button', { name: '新建会话' }).click();
    await expect(page.getByRole('dialog', { name: '新建会话' })).toBeVisible();
    await shot(page, '04-new-sheet');
    // Every session made from the phone is Claude's: a command line is for the Mac.
    await expect(page.getByRole('dialog', { name: '新建会话' }).getByRole('button', { name: /Shell/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await newSession(page);

    const composer = page.getByLabel('输入');
    await composer.fill('echo 你好-$((40+2))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('你好-42');
    await expect(composer).toHaveValue('');

    // Ctrl is sticky: tap it, then a letter from the composer goes out as a control code.
    await composer.fill('sleep 30');
    await composer.press('Enter');
    await page.getByRole('button', { name: '^C' }).click();
    await composer.fill('echo after-$((1+1))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('after-2');

    await page.getByRole('button', { name: '↑' }).click();
    await page.getByRole('button', { name: '回车' }).click();
    await expect.poll(async () => (await termText(page)).split('after-2').length - 1).toBe(2);
    await shot(page, '05-session');
  });

  test('puts the keyboard away on sending, and brings it back on a tap', async ({ page }) => {
    await login(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    await tapBar(page);
    await composer.fill('echo one-$((1+1))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('one-2');
    expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).not.toBe('TEXTAREA');
    await tapBar(page);
    await expect(composer).toBeFocused();
    await composer.fill('echo two-$((1+1))');
    await page.getByRole('button', { name: '发送' }).click();
    await expect.poll(() => termText(page)).toContain('two-2');
    await expect(composer).not.toBeFocused();
  });

  // Claude Code takes a block of text that arrives at once as pasted, an Enter inside it included.
  test('sends its text to the program as one paste, and Enter after it as a key', async ({ page }) => {
    await login(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    let round = 0;
    for (const [typed, seen] of [
      ['paste-check 1', String.raw`got=b'\x1b[200~paste-check 1\x1b[201~\r'`],
      ['line-a\nline-b', String.raw`got=b'\x1b[200~line-a\nline-b\x1b[201~\r'`],
    ]) {
      await composer.fill(`python3 ${PASTE_READER}`);
      await composer.press('Enter');
      // Typed only once the reader has the terminal raw, or the shell echoes it first.
      round += 1;
      await expect.poll(async () => (await termText(page)).split('reader-ready').length - 1).toBe(round);
      await composer.fill(typed);
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain(seen);
    }
  });

  test('sends Ctrl then a letter as a control key', async ({ page }) => {
    await login(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    await composer.fill('sleep 30; echo slept-$((9*9))');
    await composer.press('Enter');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Ctrl' }).click();
    await composer.fill('c');
    await composer.press('Enter');
    await composer.fill('echo after-ctrl-$((2+3))');
    await composer.press('Enter');
    await expect.poll(() => termText(page), { timeout: 5000 }).toContain('after-ctrl-5');
    expect(await termText(page)).not.toContain('slept-81');
  });

  test.describe('with an input method', () => {
    test('never sends while it is composing', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      await composer.fill('echo ime-$((5+5))');
      await composer.evaluate((el: HTMLTextAreaElement) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(400);
      expect(await termText(page)).not.toContain('ime-10');
      await expect(composer).toHaveValue('echo ime-$((5+5))');

      // Safari fires compositionend first and then a keydown with keyCode 229 for the
      // Enter that confirmed the candidate; that Enter belongs to the IME.
      await composer.evaluate((el: HTMLTextAreaElement) => {
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ime' }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(400);
      expect(await termText(page)).not.toContain('ime-10');

      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('ime-10');
    });

    test('never sends from the send button a candidate not yet committed', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      await composer.fill('echo tap-$((6+6))');
      await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await page.getByRole('button', { name: '发送' }).click();
      await page.waitForTimeout(400);
      expect(await termText(page)).not.toContain('tap-12');
      await expect(composer).toHaveValue('echo tap-$((6+6))');

      await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await page.getByRole('button', { name: '发送' }).click();
      await expect.poll(() => termText(page)).toContain('tap-12');
      await expect(composer).toHaveValue('');
    });
  });

  test.describe('the send button', () => {
    test('is a thumb-sized target kept off the edge of the screen', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page);
      await newSession(page);
      await page.getByLabel('输入').fill('ls');
      const box = (await page.getByRole('button', { name: '发送' }).boundingBox())!;
      // Apple's minimum hit target, and clear of the rounded corner where a thumb slips off the glass.
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(390 - (box.x + box.width)).toBeGreaterThanOrEqual(12);
      // The hit area is the button: a tap at its corner still sends.
      await page.mouse.click(box.x + 3, box.y + box.height / 2);
      await expect(page.getByLabel('输入')).toHaveValue('');
    });
  });

  test.describe('the command list', () => {
    test('offers on a / the commands Claude has here, and puts in the name of the one taken', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      const menu = page.getByRole('listbox', { name: '命令' });
      await tapBar(page);
      await expect(menu).toBeHidden();
      await composer.fill('/');
      await expect(menu.getByRole('option', { name: /^\/compact/ })).toBeVisible();
      await expect(menu.getByRole('option', { name: /^\/lesson 把一条经验归档/ })).toBeVisible();
      await expect(menu.getByRole('option', { name: /^\/release 发一个版本/ })).toBeVisible();
      await shot(page, '30-slash-menu');
      await composer.fill('/les');
      await expect(menu.getByRole('option')).toHaveCount(1);
      await menu.getByRole('option', { name: /^\/lesson/ }).click();
      await expect(composer).toHaveValue('/lesson ');
      await expect(composer).toBeFocused();
      await expect(menu).toBeHidden();
      await composer.press('End');
      await composer.pressSequentially('slash-taken');
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('/lesson slash-taken');
    });

    test('stays out of the way of words, paths and a name already taken', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      const menu = page.getByRole('listbox', { name: '命令' });
      await tapBar(page);
      await composer.fill('/zzz-none');
      await expect(menu).toBeHidden();
      for (const text of ['看看 /tmp', '/tmp/a.png', '/compact now']) {
        await composer.fill('/');
        await expect(menu).toBeVisible();
        await composer.fill(text);
        await expect(menu).toBeHidden();
      }
    });
  });
});
