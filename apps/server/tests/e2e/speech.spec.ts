import { expect, test, type Page } from '@playwright/test';
import { shot, login, termText, newSession, fakeSpeechRecognition, hear, bar, tapBar, holdBar, listening } from '../helpers/e2e';

const speechFlags = (page: Page) =>
  page.evaluate(() => ({ stopped: (window as any).__speech.stopped, aborted: (window as any).__speech.aborted }));
// Where the two drop targets are while holding, as a thumb slides up to them.
const dot = async (page: Page, target: '取消' | '转文字') => {
  const box = (await page.locator('.voice-target', { hasText: target }).locator('.voice-target-dot').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2 };
};
const onto = async (page: Page, target: '取消' | '转文字') => {
  const c = await dot(page, target);
  await page.mouse.move(c.x, c.y, { steps: 5 });
};

// One pixel of the page as drawn, as [r, g, b].
async function pixel(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, png.toString('base64'));
}
const bodyColour = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number));
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 3);

test.describe('speech', () => {
  test("is the browser's own, shown as it is heard, with nothing recorded for the Mac to transcribe", async ({ page }) => {
    await login(page);
    await newSession(page);
    await expect(page.getByRole('button', { name: '上传图片' })).toBeVisible();
    // Talking is holding the bar; there is no second way in beside it.
    await expect(page.getByRole('button', { name: /实时语音/ })).toHaveCount(0);
    // Nothing to send yet, so nothing on the right: Enter on its own is on the key bar.
    await expect(page.getByRole('button', { name: '发送' })).toHaveCount(0);
    await expect(page.locator('.composer-row > :last-child')).toHaveClass('composer-field');
    await page.getByLabel('输入').fill('ls');
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  });

  test('says when the phone does not let this page use it', async ({ page }) => {
    await fakeSpeechRecognition(page, { supported: false });
    await login(page);
    await newSession(page);
    // Nothing is offered that would do nothing.
    await expect(page.getByText('按住说话')).toHaveCount(0);

    await fakeSpeechRecognition(page, { error: 'not-allowed' });
    await page.reload();
    const box = (await bar(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('.toast')).toContainText('允许');
    await page.mouse.up();
    await expect(page.locator('.voice-panel')).toHaveCount(0);
    await expect(page.getByLabel('输入')).toHaveValue('');
  });

  test('says so once when the phone will not do it here, and the bar stops offering it', async ({ page }) => {
    await fakeSpeechRecognition(page, { error: 'service-not-allowed' });
    await login(page);
    await newSession(page);
    // The refusal comes at once, so the panel is gone again before it can be looked at.
    const box = (await bar(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('.toast')).toContainText('键盘上的麦克风');
    await page.mouse.up();
    await expect(page.locator('.voice-panel')).toHaveCount(0);
    await expect(bar(page)).toHaveText('发消息');
    await tapBar(page);
    await expect(page.getByLabel('输入')).toBeFocused();
  });

  test('leaves the bar only for typing when the browser has none', async ({ page }) => {
    await fakeSpeechRecognition(page, { supported: false });
    await login(page);
    await newSession(page);
    await expect(bar(page)).toHaveText('发消息');
    await page.mouse.move(0, 0);
    const box = (await bar(page).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await expect(page.locator('.voice-panel')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByLabel('输入')).toBeFocused();
  });

  test.describe('the bar', () => {
    test('is for typing on a tap, and starts no listening', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      await expect(bar(page)).toHaveText('发消息或按住说话…');
      await tapBar(page);
      await expect(page.getByLabel('输入')).toBeFocused();
      await expect(bar(page)).toHaveCount(0);
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__speech)).toBeUndefined();
    });
  });

  test.describe('holding the bar', () => {
    test('listens, showing the words as they come, and sends them on letting go', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      await holdBar(page);
      // Until the microphone is on, it says it is getting there rather than pretend to listen.
      await expect(page.locator('.voice-panel .spinner')).toBeVisible();
      await expect(page.locator('.voice-panel .wave')).toHaveCount(0);
      await listening(page);
      await expect(page.locator('.voice-panel .spinner')).toHaveCount(0);
      await expect(page.locator('.voice-panel .wave')).toBeVisible();
      await expect(page.locator('.voice-hint')).toHaveText('松开发送 · 滑到 ✕ 取消');
      await expect(page.locator('.voice-target')).toHaveText(['取消', '转文字']);
      await hear(page, [['echo 帮我看一下这个报错', false]]);
      await expect(page.locator('.voice-heard')).toHaveText('echo 帮我看一下这个报错');
      await shot(page, '22-hold-to-talk');

      await page.mouse.up();
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      await expect.poll(() => termText(page)).toContain('帮我看一下这个报错');
      expect(await speechFlags(page)).toEqual({ stopped: true, aborted: false });
      // It went; nothing is left behind to send again.
      await expect(page.getByLabel('输入')).toHaveValue('');
      await expect(page.getByLabel('输入')).not.toBeFocused();
    });

    test('sends with the message the words the recognizer delivers after letting go', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      await holdBar(page);
      await listening(page);
      await hear(page, [['echo 帮我', false]]);
      await page.mouse.up();
      // Still finishing: it says so instead of sending the half that is in.
      await expect(page.locator('.voice-hint')).toHaveText('正在识别…');
      await page.waitForTimeout(300);
      await hear(page, [['echo 帮我看一下', false]]);
      await page.waitForTimeout(500);
      await hear(page, [['echo 帮我看一下这个报错。', true]]);
      await expect(page.locator('.voice-heard')).toHaveText('echo 帮我看一下这个报错。');
      // The recognizer never says it is done here, so the message goes after waiting a while for it.
      await expect(page.locator('.voice-panel')).toHaveCount(0, { timeout: 3000 });
      await expect.poll(() => termText(page)).toContain('帮我看一下这个报错。');
      // Its microphone is let go of once the message is gone, and anything it says later goes nowhere.
      expect(await speechFlags(page)).toEqual({ stopped: true, aborted: true });
      await hear(page, [['echo 帮我看一下这个报错。多余', true]]);
      await page.waitForTimeout(300);
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      await expect(page.getByLabel('输入')).toHaveValue('');
      expect(await termText(page)).not.toContain('多余');
    });

    test('sends as soon as the recognizer is done, without waiting out the clock', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      await holdBar(page);
      await listening(page);
      await hear(page, [['echo 收到', false]]);
      await page.mouse.up();
      await expect(page.locator('.voice-hint')).toHaveText('正在识别…');
      await hear(page, [['echo 收到了。', true]]);
      await page.evaluate(() => (window as any).__speech.onend());
      await expect(page.locator('.voice-panel')).toHaveCount(0, { timeout: 500 });
      await expect.poll(() => termText(page)).toContain('收到了。');
    });

    // On an iPhone home-screen app, iOS asks for the microphone again on every launch, over the held bar; the
    // finger comes up on its dialog before anything could be heard.
    test('says to hold again when let go before the microphone came on, not that it did not catch it', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      const before = await termText(page);
      await holdBar(page);
      await page.mouse.up();
      await expect(page.locator('.toast')).toHaveText('麦克风刚打开，再按住说一次');
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      expect(await termText(page)).toBe(before);
    });

    test('sends nothing when nothing was heard, and says it did not catch it', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      const before = await termText(page);
      await holdBar(page);
      await listening(page);
      await page.mouse.up();
      await expect(page.locator('.toast')).toHaveText('没听清');
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      expect(await termText(page)).toBe(before);
      await expect(bar(page)).toBeVisible();
    });

    test('drops what was heard at once on sliding up onto 取消', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      const at = await holdBar(page);
      await listening(page);
      await hear(page, [['echo 不要这句', false]]);
      await onto(page, '取消');
      await expect(page.locator('.voice-target.active')).toHaveText('取消');
      await expect(page.locator('.voice-hint')).toHaveText('松开取消');
      await shot(page, '23-hold-cancel');
      // Back down where it started, letting go would send again.
      await page.mouse.move(at.x, at.y, { steps: 5 });
      await expect(page.locator('.voice-target.active')).toHaveCount(0);
      await expect(page.locator('.voice-hint')).toHaveText('松开发送 · 滑到 ✕ 取消');
      await onto(page, '取消');
      await page.mouse.up();
      // Nothing to wait for: it is gone the moment the finger is.
      await expect(page.locator('.voice-panel')).toHaveCount(0, { timeout: 300 });
      expect(await speechFlags(page)).toEqual({ stopped: false, aborted: true });
      await hear(page, [['echo 不要这句。', true]]);
      await page.waitForTimeout(300);
      await expect(page.getByLabel('输入')).toHaveValue('');
      await expect(bar(page)).toBeVisible();
      expect(await termText(page)).not.toContain('不要这句');
    });

    test('lets go on 取消 or 转文字 only with a finger on them, and sends anywhere else up the screen', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      const at = await holdBar(page);
      await listening(page);
      await hear(page, [['echo 照样发出去', false]]);
      const cancel = await dot(page, '取消');
      const text = await dot(page, '转文字');
      // Precondition: the two targets are apart, so a point between them is on neither.
      expect(text.x - cancel.x).toBeGreaterThan(2 * (cancel.r + 16) + 20);
      const sending = async () => {
        await expect(page.locator('.voice-target.active')).toHaveCount(0);
        await expect(page.locator('.voice-hint')).toHaveText('松开发送 · 滑到 ✕ 取消');
      };
      // A thumb that drifts up a little.
      await page.mouse.move(at.x, at.y - 39, { steps: 3 });
      await sending();
      // As high as the targets, but between them, and beside each one.
      const between = { x: (cancel.x + text.x) / 2, y: cancel.y };
      await page.mouse.move(between.x, between.y, { steps: 5 });
      await sending();
      await page.mouse.move(cancel.x - cancel.r - 30, cancel.y, { steps: 3 });
      await sending();
      await page.mouse.move(text.x + text.r + 30, text.y, { steps: 3 });
      await sending();
      // Well above them is no target either.
      await page.mouse.move(cancel.x, cancel.y - cancel.r - 60, { steps: 3 });
      await sending();
      // Just off the edge of a target still counts, the way a thumb is not precise.
      await page.mouse.move(cancel.x + cancel.r + 10, cancel.y, { steps: 3 });
      await expect(page.locator('.voice-target.active')).toHaveText('取消');
      await expect(page.locator('.voice-hint')).toHaveText('松开取消');
      await page.mouse.move(text.x, text.y - text.r - 10, { steps: 3 });
      await expect(page.locator('.voice-target.active')).toHaveText('转文字');
      // Off a target again, it is back to sending, and letting go there sends.
      await page.mouse.move(between.x, between.y, { steps: 5 });
      await sending();
      await page.mouse.up();
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      await expect.poll(() => termText(page)).toContain('照样发出去');
      await expect(page.getByLabel('输入')).toHaveValue('');
    });

    test('runs its blue to the very bottom, through what iOS paints below a short home-screen view', async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'phones only');
      await fakeSpeechRecognition(page);
      await login(page);
      await newSession(page);
      const idle = await bodyColour(page);
      await holdBar(page);
      await listening(page);
      // Below a view that stops short of the screen bottom, iOS paints the page background.
      const { w, h } = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const edge = [await pixel(page, 2, h - 1), await pixel(page, w / 2, h - 1), await pixel(page, w - 3, h - 1)];
      const below = await bodyColour(page);
      expect(below[2]).toBeGreaterThan(below[0] + 100);
      for (const p of edge) expect(near(p, below), `${p} against ${below}`).toBe(true);
      await page.mouse.up();
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      expect(await bodyColour(page)).toEqual(idle);
    });

    test('puts the words in the composer with the keyboard up on sliding onto 转文字, last words included', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      await holdBar(page);
      await listening(page);
      await hear(page, [['帮我看一下', false]]);
      await onto(page, '转文字');
      await expect(page.locator('.voice-target.active')).toHaveText('转文字');
      await expect(page.locator('.voice-hint')).toHaveText('松开转文字');
      await shot(page, '24-hold-to-text');
      await page.mouse.up();
      const composer = page.getByLabel('输入');
      await expect(page.locator('.voice-panel')).toHaveCount(0);
      await expect(composer).toBeFocused();
      await expect(composer).toHaveValue('帮我看一下');
      await page.waitForTimeout(300);
      await hear(page, [['帮我看一下这个报错。', true]]);
      await expect(composer).toHaveValue('帮我看一下这个报错。');
      await page.evaluate(() => (window as any).__speech.onend());
      // Ready to carry on typing at the end of what was said.
      expect(await composer.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.value.length])).toEqual([10, 10]);
      await composer.pressSequentially('吧');
      await expect(composer).toHaveValue('帮我看一下这个报错。吧');
      // Once it is in the composer it is the typist's: a recognizer that keeps talking changes nothing.
      await hear(page, [['帮我看一下这个报错。还有', true]]);
      await page.waitForTimeout(300);
      await expect(composer).toHaveValue('帮我看一下这个报错。吧');
      expect(await termText(page)).not.toContain('报错');
    });

    test('sends at once on letting go when the recognizer stopped by itself during a pause', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      await holdBar(page);
      await listening(page);
      await hear(page, [['echo 说完了。', true]]);
      // iPhone dictation ends on its own after a pause, while the finger is still down.
      await page.evaluate(() => (window as any).__speech.onend());
      await expect(page.locator('.voice-panel')).toBeVisible();
      await page.mouse.up();
      await expect(page.locator('.voice-panel')).toHaveCount(0, { timeout: 500 });
      await expect.poll(() => termText(page)).toContain('说完了。');
    });

    test('drops what was heard when the phone takes the hold away, for a call or a swipe home', async ({ page }) => {
      await fakeSpeechRecognition(page, { endsOnStop: false });
      await login(page);
      await newSession(page);
      const at = await holdBar(page);
      await listening(page);
      await hear(page, [['echo 打断了', false]]);
      // Where the finger still is: letting go there would have sent it.
      await bar(page).dispatchEvent('pointercancel', { pointerId: 1, clientX: at.x, clientY: at.y });
      await expect(page.locator('.voice-panel')).toHaveCount(0, { timeout: 300 });
      expect(await speechFlags(page)).toEqual({ stopped: false, aborted: true });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expect(page.getByLabel('输入')).toHaveValue('');
      expect(await termText(page)).not.toContain('打断了');
    });
  });
});
