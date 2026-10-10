import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_HOME, E2E_PORT } from '../../playwright.config';

export const ORIGIN = `http://localhost:${E2E_PORT}`;
const SCREENS = 'tests/e2e/__screens__';

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SCREENS}/${test.info().project.name}-${name}.png`, fullPage: false, animations: 'disabled' });

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('alice');
  await page.getByLabel('密码').fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

export const api = (page: Page, method: string, path: string, data?: unknown) =>
  page.request.fetch(path, { method, data, headers: { origin: ORIGIN } });

export async function clearSessions(page: Page) {
  const list = await (await api(page, 'GET', '/api/m/local/sessions')).json();
  for (const s of list) await api(page, 'DELETE', `/api/m/local/sessions/${s.id}`);
}

export const sessionId = (page: Page) => page.url().split('/').pop()!;
// What the session's screen on the Mac shows, as text: the phone draws none of it.
export const termText = async (page: Page) =>
  (await (await api(page, 'GET', `/api/m/local/sessions/${sessionId(page)}/screen`)).json()).text as string;

// A session to type into, opened from the list. The fake claude prints its arguments and hands over to a shell.
export async function newSession(page: Page) {
  const s = await newClaude(page);
  await expect.poll(() => termText(page), { timeout: 10_000 }).toContain('fake claude');
  return s;
}

export const hook = (termId: string, event: string, more: Record<string, string> = {}) =>
  new Promise<void>((resolve) =>
    execFile(
      'curl',
      ['-s', '--max-time', '3', '--unix-socket', join(E2E_HOME, 'hooks.sock'), '-H', `x-workoffdesk-session: ${termId}`,
        '--data-binary', JSON.stringify({ hook_event_name: event, ...more }), 'http://localhost/hook'],
      () => resolve(),
    ),
  );

// An image that has come in and shows, not one still loading or broken.
export const shown = (img: Locator) => expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

// The browser's own speech recognition, played by a script: what a test says, it hears.
// endsOnStop: false plays a recognizer that keeps the last words, and its end, to itself after stop().
export async function fakeSpeechRecognition(page: Page, { supported = true, error = '', endsOnStop = true } = {}) {
  await page.addInitScript(({ supported, error, endsOnStop }) => {
    if (!supported) {
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;
      return;
    }
    class Fake {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      stopped = false;
      aborted = false;
      // The test says when the microphone is listening, with __speech.onstart().
      start() {
        (window as any).__speech = this;
        if (error) setTimeout(() => (this.onerror?.({ error }), this.onend?.()));
      }
      // The test delivers the last words and the end itself, with hear() and __speech.onend().
      stop() {
        this.stopped = true;
        if (endsOnStop) setTimeout(() => this.onend?.());
      }
      abort() {
        this.aborted = true;
        setTimeout(() => (this.onerror?.({ error: 'aborted' }), this.onend?.()));
      }
    }
    (window as any).webkitSpeechRecognition = Fake;
    delete (window as any).SpeechRecognition;
  }, { supported, error, endsOnStop });
}
// Results as the browser delivers them: every result so far, the last ones possibly not final.
export const hear = (page: Page, results: [string, boolean][]) =>
  page.evaluate((results) => {
    const r = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    (window as any).__speech.onresult({ resultIndex: 0, results: r });
  }, results);

// The empty bar, as a thumb finds it: a tap is for typing, a hold is for talking.
export const bar = (page: Page) => page.getByRole('button', { name: /^发消息/ });
export const tapBar = (page: Page) => bar(page).click();
export async function holdBar(page: Page) {
  const box = (await bar(page).boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(page.locator('.voice-panel')).toBeVisible();
  return at;
}
export const listening = (page: Page) => page.evaluate(() => (window as any).__speech.onstart());

const at = '2026-10-03T06:00:00.000Z';
export const rec = {
  user: (content: unknown) => ({ type: 'user', timestamp: at, message: { role: 'user', content } }),
  claude: (block: unknown) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [block] } }),
};
export const jsonl = (...rs: unknown[]) => rs.map((r) => `${JSON.stringify(r)}\n`).join('');

export async function newClaude(page: Page) {
  await page.getByRole('button', { name: '新建会话' }).click();
  await page.getByRole('button', { name: /在项目里新开 Claude/ }).click();
  await page.getByRole('button', { name: /project-a/ }).click();
  await expect(page).toHaveURL(/\/m\/local\/s\/[a-z0-9]+$/);
  // A Claude session opens in its chat; what is typed there goes to the session once it is connected.
  await expect(page.getByTestId('chat')).toBeVisible();
  await expect(page.locator('.term-page')).toHaveAttribute('data-link', 'live', { timeout: 10_000 });
  const id = page.url().split('/').pop()!;
  const list: { id: string; claudeSessionId: string }[] = await (await api(page, 'GET', '/api/m/local/sessions')).json();
  const sid = list.find((s) => s.id === id)!.claudeSessionId;
  return { id, transcript: join(E2E_HOME, 'claude-projects', '-p', `${sid}.jsonl`) };
}
