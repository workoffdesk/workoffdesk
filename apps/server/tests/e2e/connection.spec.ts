import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_HOME } from '../../playwright.config';
import { shot, login, api, clearSessions, termText, newSession, fakeSpeechRecognition, hear, holdBar, listening, rec, jsonl, newClaude } from '../helpers/e2e';

// What the page keeps of a chat, read the way the page reads it.
const keptChat = (page: Page, id: string) =>
  page.evaluate(
    (key) =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('workoffdesk');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('chats')) return resolve([]);
          const get = db.transaction('chats').objectStore('chats').get(key);
          get.onsuccess = () => resolve((get.result?.items ?? []).map((i: { text?: string }) => i.text ?? ''));
          get.onerror = () => resolve([]);
        };
      }),
    id,
  );

// Holds the page's terminal connection until window.__connect() is called, the way a slow network does.
const slowSessionConnection = (page: Page) =>
  page.addInitScript(() => {
    const Real = WebSocket;
    let connect!: () => void;
    const gate = new Promise<void>((r) => (connect = r));
    (window as any).__connect = connect;
    class Slow extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      binaryType: BinaryType = 'blob';
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      real: WebSocket | null = null;
      closed = false;
      constructor(url: string) {
        super();
        gate.then(() => {
          if (this.closed) return;
          const real = new Real(url);
          real.binaryType = this.binaryType;
          this.real = real;
          real.onopen = (e) => ((this.readyState = 1), this.onopen?.(e));
          real.onmessage = (e) => this.onmessage?.(e);
          real.onerror = (e) => this.onerror?.(e);
          real.onclose = (e) => ((this.readyState = 3), this.onclose?.(e));
        });
      }
      send(data: string | ArrayBufferView) {
        if (!this.real || this.readyState !== 1) throw new Error('not open');
        this.real.send(data);
      }
      close() {
        this.closed = true;
        this.readyState = 3;
        this.real?.close();
      }
    }
    (window as any).WebSocket = function (url: string, protocols?: string | string[]) {
      return /\/sessions\/[a-z0-9]+\/ws/.test(url) ? new Slow(url) : new Real(url, protocols);
    };
    Object.assign((window as any).WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });

test.describe('the session page', () => {
  // A message goes to the Mac on a request of its own, so a session connection being reconnected does not
  // hold it back.
  test('still sends text sent while reconnecting', async ({ page }) => {
    let blocked = false;
    const live: { close: (o?: { code?: number }) => Promise<void> }[] = [];
    await page.routeWebSocket(/\/sessions\/[a-z0-9]+\/ws/, (ws) => {
      if (blocked) return void ws.close({ code: 4000 });
      ws.connectToServer();
      live.push(ws);
    });
    await login(page);
    await newSession(page);
    blocked = true;
    for (const ws of live.splice(0)) await ws.close({ code: 4000 });
    await expect(page.getByText('重连中…')).toBeVisible();
    const composer = page.getByLabel('输入');
    await composer.fill('echo went-$((7*7))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('went-49');
    await expect(composer).toHaveValue('');
  });

  test('shows reconnecting when the connection drops, and recovers by itself', async ({ page }) => {
    let blocked = false;
    const live: { close: (o?: { code?: number }) => Promise<void> }[] = [];
    await page.routeWebSocket(/\/sessions\/[a-z0-9]+\/ws/, (ws) => {
      if (blocked) return void ws.close({ code: 4000 });
      ws.connectToServer();
      live.push(ws);
    });
    await login(page);
    await newSession(page);
    blocked = true;
    for (const ws of live.splice(0)) await ws.close({ code: 4000 });
    await expect(page.getByText('重连中…')).toBeVisible();
    await shot(page, '07-reconnecting');
    blocked = false;
    await expect(page.getByText('重连中…')).toBeHidden({ timeout: 15_000 });
    const composer = page.getByLabel('输入');
    await composer.fill('echo back-$((3*3))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('back-9');
  });

  test('shows a session killed elsewhere as ended, and offers a new one', async ({ page }) => {
    await login(page);
    await newSession(page);
    const id = page.url().split('/').pop()!;
    await api(page, 'DELETE', `/api/m/local/sessions/${id}`);
    await expect(page.getByText('会话已结束')).toBeVisible();
    await shot(page, '08-ended');
    await page.getByRole('button', { name: '重新开一个' }).click();
    await expect(page).not.toHaveURL(new RegExp(`/s/${id}$`));
    await expect(page.getByTestId('chat')).toBeVisible();
  });

  test('rides out a restart of the Mac side: back within a second, nothing typed lost or sent', async ({ page }) => {
    // When the session list's own socket closes and opens again; it shows nothing on screen.
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      const w = window as unknown as { events: { closed?: number; opened?: number } };
      w.events = {};
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (!String(url).endsWith('/api/events')) return;
          this.addEventListener('close', () => (w.events.closed ??= performance.now()));
          this.addEventListener('open', () => {
            if (w.events.closed !== undefined) w.events.opened ??= performance.now();
          });
        }
      };
    });
    await login(page);
    await clearSessions(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    await composer.fill('还没发的话');
    // How long the reconnecting notice is up, timed in the page rather than by polling from outside.
    await page.evaluate(() => {
      const w = window as unknown as { shown?: number; hidden?: number };
      const showing = () => document.body.innerText.includes('重连中…');
      new MutationObserver(() => {
        if (w.shown === undefined && showing()) w.shown = performance.now();
        else if (w.shown !== undefined && w.hidden === undefined && !showing()) w.hidden = performance.now();
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    expect((await api(page, 'POST', '/__test/restart')).status()).toBe(202);
    await expect.poll(() => page.evaluate(() => (window as unknown as { hidden?: number }).hidden), { timeout: 10_000 }).toBeDefined();
    const ms = await page.evaluate(() => {
      const w = window as unknown as { shown: number; hidden: number };
      return w.hidden - w.shown;
    });
    // Without the restart handling the first try comes after a full second.
    expect(ms).toBeLessThan(950);
    const events = await page.evaluate(() => (window as unknown as { events: { closed: number; opened: number } }).events);
    expect(events.opened - events.closed).toBeLessThan(950);
    await expect(composer).toHaveValue('还没发的话');
    expect(await termText(page)).not.toContain('还没发的话');
    await expect(page.getByText('读不到对话')).toHaveCount(0);
  });

  // WebKit sends a page's requests through its service worker, which Playwright cannot route.
  test.describe('with requests held or dropped on the way', () => {
    test.use({ serviceWorkers: 'block' });

    test('knows which session it is at once, from the list or after a reload', async ({ page }) => {
      await login(page);
      await clearSessions(page);
      await page.reload();
      await newClaude(page);
      const title = page.locator('.term-title strong');
      const name = (await title.textContent())!;
      expect(name).not.toBe('会话');
      await page.getByRole('button', { name: '返回' }).click();
      await page.getByTestId('session-card').first().click();
      // Read straight away, before anything new could come from the Mac.
      expect(await title.textContent()).toBe(name);
      await expect(page.getByTestId('chat')).toBeVisible();

      // With no word from the Mac at all, it still knows the session and opens its chat.
      await page.routeWebSocket(/\/api\/events/, () => {});
      await page.reload();
      await expect(title).toHaveText(name);
      await expect(page.getByTestId('chat')).toBeVisible();
    });

    test('brings in the earlier turns when the latest page is too short to scroll', async ({ page }) => {
      await login(page);
      const { transcript } = await newClaude(page);
      // Each round prints a megabyte, so the latest page is a few rounds that fit on the screen with room to spare.
      const big = 'x'.repeat(1024 * 1024);
      writeFileSync(
        transcript,
        jsonl(
          ...Array.from({ length: 8 }, (_, i) => [
            rec.user(`第 ${i} 轮`),
            rec.claude({ type: 'tool_use', id: `toolu_${i}`, name: 'Bash', input: { command: `cat big-${i}` } }),
            rec.user([{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: big }]),
          ]).flat(),
        ),
      );
      const chat = page.getByTestId('chat');
      await expect(chat.getByText('第 7 轮', { exact: true })).toBeVisible();
      await expect(chat.getByText('第 0 轮', { exact: true })).toHaveCount(1, { timeout: 15_000 });
    });

    test('sends once what is sent before the session is connected', async ({ page }) => {
      await login(page);
      await newClaude(page);
      await slowSessionConnection(page);
      await page.reload();
      await expect(page.getByTestId('chat')).toBeVisible();
      await expect(page.locator('.term-page')).toHaveAttribute('data-link', 'connecting');
      const marker = join(E2E_HOME, `sent-early-${test.info().project.name}`);
      const composer = page.getByLabel('输入');
      await composer.fill(`echo sent-early >> ${marker}`);
      await composer.press('Enter');
      await expect(composer).toHaveValue('');
      await expect.poll(() => existsSync(marker)).toBe(true);
      await page.evaluate(() => (window as any).__connect());
      await expect(page.locator('.term-page')).toHaveAttribute('data-link', 'live');
      await page.waitForTimeout(500);
      expect(readFileSync(marker, 'utf8')).toBe('sent-early\n');
    });

    // A restart of the Mac side refuses what comes while it closes; the new one is up within a second.
    test('shows as sending a message sent while the Mac side restarts, and sends it once back', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      let refused = 0;
      await page.route(/\/messages$/, async (r) => {
        if (refused++ < 2) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"closing"}' });
        await new Promise((res) => setTimeout(res, 600));
        return r.continue();
      });
      await composer.fill('echo restarted-$((9*9))');
      await composer.press('Enter');
      await expect(composer).toHaveValue('');
      await expect(page.getByRole('listitem', { name: '正在发送的消息' })).toHaveText([/restarted.*发送中/s]);
      await shot(page, '41-sending-while-restarting');
      await expect.poll(() => termText(page)).toContain('restarted-81');
      await expect(page.getByRole('listitem', { name: '正在发送的消息' })).toHaveCount(0);
      await expect(page.locator('.toast')).toHaveCount(0);
      expect(refused).toBe(3);
    });

    test('sends again a message whose answer is lost on the way, and it goes in once', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      let lost = false;
      await page.route(/\/messages$/, async (r) => {
        if (lost) return r.continue();
        lost = true;
        await r.fetch();
        return r.abort();
      });
      await composer.fill('echo once-$((4*4))');
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('once-16');
      await page.waitForTimeout(2500);
      expect((await termText(page)).match(/once-16/g)).toHaveLength(1);
      await expect(composer).toHaveValue('');
      await expect(page.locator('.toast')).toHaveCount(0);
    });

    test('gives back to the composer, saying so, text that cannot reach the Mac, which goes when sent again', async ({ page }) => {
      await login(page);
      await newSession(page);
      const composer = page.getByLabel('输入');
      await page.route(/\/messages$/, (r) => r.abort());
      await composer.fill('echo kept-$((8*8))');
      await composer.press('Enter');
      await expect(page.locator('.toast')).toHaveText('没发出去，文字放回输入框了', { timeout: 15_000 });
      await expect(composer).toHaveValue('echo kept-$((8*8))');
      await page.unroute(/\/messages$/);
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('kept-64');
      await expect(composer).toHaveValue('');
    });

    test('gives back to the composer what is said when it cannot reach the Mac', async ({ page }) => {
      await fakeSpeechRecognition(page);
      await login(page);
      await newClaude(page);
      await page.route(/\/messages$/, (r) => r.abort());
      await holdBar(page);
      await listening(page);
      await hear(page, [['帮我看一下这个报错', false]]);
      await page.mouse.up();
      await expect(page.locator('.toast')).toHaveText('没发出去，文字放回输入框了', { timeout: 15_000 });
      await expect(page.getByLabel('输入')).toHaveValue('帮我看一下这个报错');
    });

    test('falls back to reading from the Mac when the copy on the phone is damaged or unavailable', async ({ page }) => {
      await login(page);
      const { id, transcript } = await newClaude(page);
      writeFileSync(transcript, jsonl(rec.claude({ type: 'text', text: '在 Mac 上的回答' })));
      const chat = page.getByTestId('chat');
      await expect(chat.getByText('在 Mac 上的回答')).toBeVisible();
      await expect.poll(() => keptChat(page, id)).toEqual(['在 Mac 上的回答']);
      await page.evaluate(
        (key) =>
          new Promise<void>((resolve) => {
            const open = indexedDB.open('workoffdesk');
            open.onsuccess = () => {
              const tx = open.result.transaction('chats', 'readwrite');
              tx.objectStore('chats').put({ items: 'damaged', next: 'x' }, key);
              tx.oncomplete = () => resolve();
            };
          }),
        id,
      );
      await page.reload();
      await expect(chat.getByText('在 Mac 上的回答')).toBeVisible();

      await page.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', {
          get() {
            throw new Error('blocked');
          },
        });
      });
      await page.reload();
      await expect(chat.getByText('在 Mac 上的回答')).toBeVisible();
    });
  });
});
