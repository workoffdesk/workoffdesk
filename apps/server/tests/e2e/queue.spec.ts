import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_HOME } from '../../playwright.config';
import { shot, login, sessionId, termText, newSession, hook, jsonl, newClaude } from '../helpers/e2e';

test.describe('a message sent while Claude is busy', () => {
  // Claude takes nothing while it compacts its conversation: what is sent waits in sight, through a reload, and
  // goes in the order it was sent once the compaction is over.
  test('waits in sight while Claude compacts, stays through a reload, and goes in order after', async ({ page }) => {
    await login(page);
    await newSession(page);
    const id = sessionId(page);
    const bar = page.getByRole('status', { name: '正在压缩上下文' });
    await hook(id, 'PreCompact', { trigger: 'auto' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('正在压缩上下文');

    const composer = page.getByLabel('输入');
    await composer.fill('echo first-$((1+1))');
    await composer.press('Enter');
    await composer.fill('echo second-$((2+2))');
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    const held = page.getByRole('listitem', { name: '已排队的消息' });
    await expect(held).toHaveText([/echo first.*已排队/s, /echo second.*已排队/s]);
    await expect(bar).toContainText('你的 2 条消息在排队');
    expect(await termText(page)).not.toContain('first-2');
    await shot(page, '34-compacting-queued');

    await page.reload();
    await expect(held).toHaveCount(2);
    await expect(bar).toContainText('你的 2 条消息在排队');
    await shot(page, '35-compacting-after-reload');

    await hook(id, 'PostCompact', { trigger: 'auto' });
    await expect.poll(() => termText(page)).toContain('second-4');
    const text = await termText(page);
    expect(text.indexOf('first-2')).toBeLessThan(text.indexOf('second-4'));
    await expect(held).toHaveCount(0);
    await expect(bar).toBeHidden();
    await expect(page.getByRole('listitem', { name: '已送出的消息' })).toHaveText([/echo first.*已送出/s, /echo second.*已送出/s]);
    await shot(page, '36-compacting-delivered');
  });

  // What the real compaction of 2026-10-04 left in the conversation: the typed /compact, the summary, the
  // command again, and what workoffdesk's own hooks printed.
  test('shows as sent until answered after a compaction, which the chat shows as /compact once, without its hooks', async ({ page }) => {
    await login(page);
    const { id, transcript } = await newClaude(page);
    const now = () => new Date().toISOString();
    const said = (content: string, extra = {}) => ({ type: 'user', timestamp: now(), message: { role: 'user', content }, ...extra });
    const answer = (text: string) => ({ type: 'assistant', timestamp: now(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const settings = JSON.parse(readFileSync(join(E2E_HOME, 'claude-settings.json'), 'utf8')) as { hooks: Record<string, [{ hooks: [{ command: string }] }]> };
    const own = settings.hooks.PreCompact[0].hooks[0].command;
    const chat = page.getByTestId('chat');
    writeFileSync(transcript, jsonl(said('/compact')));
    await expect(chat.getByText('/compact', { exact: true })).toHaveCount(1);
    await hook(id, 'PreCompact', { trigger: 'manual' });

    const texts = ['压缩期间发的第一条：只回复数字 1', '第二条：只回复数字 2', '第三条：只回复数字 3'];
    const composer = page.getByLabel('输入');
    for (const t of texts) {
      await composer.fill(t);
      await composer.press('Enter');
    }
    await expect(page.getByRole('listitem', { name: '已排队的消息' })).toHaveCount(3);
    await hook(id, 'PostCompact', { trigger: 'manual' });
    const sent = page.getByLabel('已送出的消息');
    await expect(sent).toHaveText([/第一条.*已送出/s, /第二条.*已送出/s, /第三条.*已送出/s]);

    const dim = (s: string) => `\u001b[2m${s}\u001b[22m`;
    appendFileSync(
      transcript,
      jsonl(
        said('This session is being continued from a previous conversation…', { isCompactSummary: true }),
        said('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>'),
        said(`<local-command-stdout>${dim('Compacted (ctrl+o to see full summary)')}\n${dim(`PreCompact [${own}] completed successfully`)}\n${dim(`PostCompact [${own}] completed successfully`)}</local-command-stdout>`),
        said(texts[0]),
      ),
    );
    await expect(chat.getByText('Compacted (ctrl+o to see full summary)', { exact: true })).toBeVisible();
    // The first is in the conversation now, and reads as sent like the two that are not yet.
    await expect(sent).toHaveText([/第一条.*已送出/s, /第二条.*已送出/s, /第三条.*已送出/s]);
    await expect(chat.getByText(texts[0])).toHaveCount(1);
    await expect(chat.getByText('/compact', { exact: true })).toHaveCount(1);
    await expect(chat).not.toContainText('PreCompact');
    await expect(chat).not.toContainText('hooks.sock');
    await shot(page, '37-compacted-sent');

    appendFileSync(transcript, jsonl(answer('1'), said(texts[1]), said(texts[2])));
    await expect(sent).toHaveText([/第二条.*已送出/s, /第三条.*已送出/s]);
    appendFileSync(transcript, jsonl(answer('2\n\n3')));
    await expect(sent).toHaveCount(0);
    for (const t of texts) await expect(chat.getByText(t)).toHaveCount(1);
    await shot(page, '38-compacted-answered');
  });

  // Sent while Claude works, a message waits inside Claude Code, out of the conversation, until Claude takes it up.
  test('shows as sent at once while Claude works, through a reload, until Claude answers it', async ({ page }) => {
    await login(page);
    const { id, transcript } = await newClaude(page);
    const now = () => new Date().toISOString();
    const said = (content: string) => ({ type: 'user', timestamp: now(), message: { role: 'user', content } });
    const answer = (text: string) => ({ type: 'assistant', timestamp: now(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const chat = page.getByTestId('chat');
    writeFileSync(transcript, jsonl(said('把 README 改一下'), answer('好，我先看看文件。')));
    await expect(chat.getByText('好，我先看看文件。')).toBeVisible();
    await hook(id, 'UserPromptSubmit');
    await expect(chat.getByText('Claude 正在干活…')).toBeVisible();

    const text = '顺便把测试也跑一下';
    const composer = page.getByLabel('输入');
    await composer.fill(text);
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    const sent = page.getByRole('listitem', { name: '已送出的消息' });
    await expect(sent).toHaveText([new RegExp(`${text}.*已送出`, 's')]);
    await expect(page.getByRole('listitem', { name: '已排队的消息' })).toHaveCount(0);
    await shot(page, '39-sent-while-working');

    await page.reload();
    await expect(sent).toHaveText([new RegExp(`${text}.*已送出`, 's')]);

    appendFileSync(transcript, jsonl(answer('README 改好了。'), said(text)));
    await expect(sent).toHaveCount(0);
    await expect(chat.getByText(text)).toHaveCount(1);
    appendFileSync(transcript, jsonl(answer('测试全过了。')));
    await hook(id, 'Stop');
    await expect(chat.getByText('测试全过了。')).toBeVisible();
    await expect(chat.getByText(text)).toHaveCount(1);
    await expect(chat.getByText('已送出')).toHaveCount(0);
    await shot(page, '40-sent-while-working-answered');
  });

  // Claude Code records a message Claude took in the middle of its turn only as a queued_command attachment.
  test('stays in the conversation once Claude is done, when taken in the middle of its turn', async ({ page }) => {
    await login(page);
    const { id, transcript } = await newClaude(page);
    const now = () => new Date().toISOString();
    const said = (content: string) => ({ type: 'user', timestamp: now(), message: { role: 'user', content } });
    const answer = (text: string) => ({ type: 'assistant', timestamp: now(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const chat = page.getByTestId('chat');
    writeFileSync(transcript, jsonl(said('帮我查一下今天的订单'), answer('好，我先查数据库。')));
    await expect(chat.getByText('好，我先查数据库。')).toBeVisible();
    await hook(id, 'UserPromptSubmit');

    const text = '找线下门店这个你别提了';
    const composer = page.getByLabel('输入');
    await composer.fill(text);
    await composer.press('Enter');
    await expect(page.getByRole('listitem', { name: '已送出的消息' })).toHaveCount(1);
    await shot(page, '42-sent-while-working');

    appendFileSync(
      transcript,
      jsonl(
        { type: 'attachment', timestamp: now(), attachment: { type: 'queued_command', prompt: text, commandMode: 'prompt', origin: { kind: 'human' } } },
        answer('收到，不提线下门店。今天订单 37 单。'),
      ),
    );
    await hook(id, 'Stop');
    await expect(chat.getByText('收到，不提线下门店。今天订单 37 单。')).toBeVisible();
    await expect(page.getByRole('listitem', { name: '已送出的消息' })).toHaveCount(0);
    await page.reload();
    await expect(chat.getByText(text)).toHaveCount(1);
    await shot(page, '43-taken-mid-turn-after-idle');
  });

  test('can be taken back into the composer while it waits for a compaction', async ({ page }) => {
    await login(page);
    await newSession(page);
    const id = sessionId(page);
    await hook(id, 'PreCompact', { trigger: 'manual' });
    const composer = page.getByLabel('输入');
    await composer.fill('echo never-$((3+3))');
    await composer.press('Enter');
    const held = page.getByRole('listitem', { name: '已排队的消息' });
    await expect(held).toHaveCount(1);
    await held.getByRole('button', { name: '撤回' }).click();
    await expect(held).toHaveCount(0);
    await expect(composer).toHaveValue('echo never-$((3+3))');
    await hook(id, 'PostCompact', { trigger: 'manual' });
    await expect(page.getByRole('status', { name: '正在压缩上下文' })).toBeHidden();
    await page.waitForTimeout(1000);
    expect(await termText(page)).not.toContain('never-6');
  });
});
