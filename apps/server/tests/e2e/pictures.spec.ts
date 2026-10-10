import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { E2E_HOME } from '../../playwright.config';
import { ORIGIN, shot, login, clearSessions, termText, newSession, shown, rec, jsonl, newClaude } from '../helpers/e2e';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const pick = async (page: Page, file: { name: string; buffer: Buffer }, button = '上传图片') => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles({ ...file, mimeType: 'image/png' });
};

// A plain picture big enough to see in a screenshot.
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])]);
  const rows = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test.describe('a picture', () => {
  test('waits above the composer once picked, and goes to Claude as its path on the Mac', async ({ page }) => {
    await login(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    await composer.fill('看看这张图');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '上传图片' }).click();
    // One tap on a photo picks it: the iPhone's multi-select picker only ticks photos, and a stray tick
    // sends a second picture along.
    expect((await chooser).isMultiple()).toBe(false);
    await (await chooser).setFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: PNG });
    const waiting = page.locator('.attachments img');
    await expect(waiting).toHaveCount(1);
    await shown(waiting);
    // The picture shows; its path stays out of what is typed.
    await expect(composer).toHaveValue('看看这张图');
    await shot(page, '14-upload');

    // What is not a picture is refused, and what was there stays.
    await pick(page, { name: 'notes.png', buffer: Buffer.from('not a picture') });
    await expect(page.locator('.toast')).toContainText('只能上传图片');
    await expect(waiting).toHaveCount(1);
    await expect(composer).toHaveValue('看看这张图');

    // More can be added from beside them, and any taken back.
    await pick(page, { name: 'IMG_0002.png', buffer: PNG }, '再加一张图片');
    await expect(waiting).toHaveCount(2);
    await page.getByRole('button', { name: '移除图片' }).first().click();
    await expect(waiting).toHaveCount(1);

    // A picture alone can be sent, with nothing typed.
    await composer.fill('');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.locator('.attachments')).toHaveCount(0);
    await expect.poll(() => termText(page)).toContain(`${E2E_HOME}/uploads/`);
    const uploaded = new RegExp(`${E2E_HOME}/uploads/\\d{4}-\\d{2}-\\d{2}-\\d{6}-[0-9a-f]{6}\\.png`);
    const sent = (await termText(page)).replace(/\n/g, '').match(uploaded)![0];
    expect(readFileSync(sent)).toEqual(PNG);
  });

  test('shows in the chat as itself once sent to Claude, and opens large', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const up = await page.request.fetch('/api/uploads', { method: 'POST', data: PNG, headers: { origin: ORIGIN, 'content-type': 'image/png' } });
    const { path } = await up.json();
    const gone = `${E2E_HOME}/uploads/2020-01-01-000000-abcdef.png`;
    const { transcript } = await newClaude(page);
    writeFileSync(transcript, jsonl(rec.user(`${path} 这个按钮为什么歪了`), rec.claude({ type: 'text', text: '看到了。' }), rec.user(gone)));
    const chat = page.getByTestId('chat');
    await expect(chat.getByText('这个按钮为什么歪了')).toBeVisible();
    await expect(chat).not.toContainText('/uploads/');
    const thumb = chat.getByRole('button', { name: '查看图片' }).first();
    await shown(thumb.locator('img'));
    // An upload cleared away after its month says so rather than show a broken picture.
    await expect(chat.getByText('图片已过期')).toBeVisible();
    // The picture-only message is just the picture, with no empty bubble beside it.
    await expect(chat.locator('.bubble.mine')).toHaveCount(1);
    await shot(page, '24-chat-image');

    await thumb.click();
    const viewer = page.getByRole('dialog', { name: '图片' });
    await shown(viewer.locator('img'));
    await shot(page, '25-image-viewer');
    await viewer.getByRole('button', { name: '关闭' }).click();
    await expect(viewer).toHaveCount(0);
  });

  test('shows in the chat when Claude names, reads or links it, and once when sent once', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const up = await page.request.fetch('/api/uploads', { method: 'POST', data: solidPng(160, 100, [80, 140, 230]), headers: { origin: ORIGIN, 'content-type': 'image/png' } });
    const { path: sent } = await up.json();
    const shotPath = `${E2E_HOME}/截图 1.png`;
    const readPath = `${E2E_HOME}/read.png`;
    const gonePath = `${E2E_HOME}/deleted.png`;
    writeFileSync(shotPath, solidPng(160, 100, [240, 160, 60]));
    writeFileSync(readPath, solidPng(160, 100, [90, 190, 120]));
    const { transcript } = await newClaude(page);
    writeFileSync(
      transcript,
      jsonl(
        // What Claude Code records for a picture sent from the phone: its marker and path, then the picture.
        rec.user([{ type: 'text', text: `[Image #8]${sent} 这个` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }]),
        // One pasted on the Mac has no path to be shown by, which the chat says rather than show nothing.
        rec.user([{ type: 'text', text: '还有这张 [Image #9]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }]),
        rec.claude({ type: 'text', text: `截好了：\`${shotPath}\`\n\n![示意](https://example.com/x.png)\n\n旧的那张 ${gonePath} 删了。` }),
        rec.claude({ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: readPath } }),
        rec.user([{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }]),
        // Neither a file read as text, nor a picture from a tool that does not name a file, has one to show.
        rec.claude({ type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: shotPath } }),
        rec.user([{ type: 'tool_result', tool_use_id: 'r2', content: 'not an image after all' }]),
        rec.claude({ type: 'tool_use', id: 'r3', name: 'mcp__browser__screenshot', input: { file_path: gonePath } }),
        rec.user([{ type: 'tool_result', tool_use_id: 'r3', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }]),
      ),
    );
    const chat = page.getByTestId('chat');
    await expect(chat.locator('.bubble.mine')).toHaveText(['这个', '还有这张']);
    for (const raw of ['[Image #', '/uploads/', '[图片]']) await expect(chat.locator('.bubble.mine').first()).not.toContainText(raw);
    // Not a box the size of a picture, which would read as one that failed to load.
    await expect(chat.locator('.chat-image-note')).toHaveText(['附了 1 张图（在 Mac 上粘贴的，这里看不到）']);
    // Under the words it came with, so it is not read as part of the message before.
    const note = (await chat.locator('.chat-image-note').boundingBox())!;
    const words = (await chat.locator('.bubble.mine', { hasText: '还有这张' }).boundingBox())!;
    expect(note.y).toBeGreaterThan(words.y + words.height - 1);
    await expect(chat.locator('.chat-picture.gone')).toHaveCount(1);
    const thumbs = chat.getByRole('button', { name: '查看图片' });
    // The picture sent, the one Claude named and the one it read; the deleted one says so.
    await expect(thumbs).toHaveCount(3);
    for (let i = 0; i < 3; i++) await shown(thumbs.nth(i).locator('img'));
    await expect(chat.getByText('图片已不在')).toHaveCount(1);
    // The one Claude read is under its tool line, without opening it.
    await expect(chat.locator('.chat-tool + .chat-pictures').getByRole('button', { name: '查看图片' })).toBeVisible();
    // A web image is not loaded until asked for.
    const ext = chat.getByRole('link', { name: /外链图片/ });
    await expect(ext).toHaveAttribute('href', 'https://example.com/x.png');
    expect(await page.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src).filter((s) => !s.startsWith(location.origin)))).toEqual([]);
    await chat.evaluate((el) => el.scrollTo(0, 0));
    await shot(page, '31-chat-images-mine');
    await ext.scrollIntoViewIfNeeded();
    await shot(page, '32-chat-images-reply');

    await thumbs.nth(1).click();
    const viewer = page.getByRole('dialog', { name: '图片' });
    await shown(viewer.locator('img'));
    await viewer.getByRole('button', { name: '关闭' }).click();
    await expect(viewer).toHaveCount(0);
  });

  test('is not shown again once shown, beside a line of its own for what reached Claude from elsewhere', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const up = await page.request.fetch('/api/uploads', { method: 'POST', data: solidPng(160, 100, [80, 140, 230]), headers: { origin: ORIGIN, 'content-type': 'image/png' } });
    const { path: sent } = await up.json();
    const { transcript } = await newClaude(page);
    const notification = `<task-notification>\n<task-id>bdfoi2os0</task-id>\n<status>completed</status>\n<summary>Background command "Wait in background for MEM-727 to finish" completed (exit code 0)</summary>\n</task-notification>`;
    writeFileSync(
      transcript,
      jsonl(
        rec.user([{ type: 'text', text: `[Image #1]${sent} 看这张` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }]),
        rec.claude({ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: sent } }),
        rec.user([{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }]),
        rec.claude({ type: 'text', text: `看到了，就是 ${sent} 这张。` }),
        // Shapes from Claude Code 2.1.288: who sent a prompt is in origin.
        { ...rec.user(notification), origin: { kind: 'task-notification', producer: 'session-task' }, promptSource: 'system' },
        { ...rec.user('Another Claude session sent a message: …'), isMeta: true, origin: { kind: 'peer', name: 'random-ca', body: '设计稿看完了，有五条意见。' } },
        rec.claude({ type: 'text', text: '收到。' }),
      ),
    );
    const chat = page.getByTestId('chat');
    await expect(chat.getByText('收到。')).toBeVisible();
    // Only what the user sent is drawn as theirs.
    await expect(chat.locator('.bubble.mine')).toHaveText(['看这张']);
    await expect(chat).not.toContainText('<task-notification>');
    await expect(chat.locator('.chat-note')).toContainText(['后台任务完成：Wait in background for MEM-727 to finish', '收到 random-ca 的消息']);
    const peer = chat.locator('details.chat-note', { hasText: 'random-ca' });
    await expect(peer.getByText('设计稿看完了')).toBeHidden();
    await peer.locator('summary').click();
    await expect(peer.getByText('设计稿看完了，有五条意见。')).toBeVisible();
    // The picture shows once, where it was sent; the read of it and the reply naming it lead back to it.
    await expect(chat.getByRole('button', { name: '查看图片' })).toHaveCount(1);
    await shown(chat.getByRole('button', { name: '查看图片' }).locator('img'));
    await expect(chat.getByRole('button', { name: '↑ 看上面那张图' })).toHaveCount(1);
    await shot(page, '33-chat-system-lines');
    await chat.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await chat.getByRole('button', { name: '↑ 看上面那张图' }).click();
    await expect(chat.getByRole('button', { name: '查看图片' })).toBeInViewport();
  });
});
