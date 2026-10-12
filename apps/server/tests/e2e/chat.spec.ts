import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_HOME } from '../../playwright.config';
import { shot, login, api, clearSessions, termText, newSession, hook, rec, jsonl, newClaude } from '../helpers/e2e';

test.describe('the chat', () => {
  test('lists the files a reply changed under its last words, and opens each edit on what it changed', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const { transcript } = await newClaude(page);
    const file = join(E2E_HOME, 'project-a', 'src', 'Login.tsx');
    const doc = join(E2E_HOME, 'project-a', 'docs', 'notes.md');
    const result = (id: string, toolUseResult: object) => ({ ...rec.user([{ type: 'tool_result', tool_use_id: id, content: 'ok' }]), toolUseResult });
    writeFileSync(
      transcript,
      jsonl(
        rec.user('把登录按钮改成圆角，再记一下'),
        rec.claude({ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: file, old_string: 'radius: 4', new_string: 'radius: 12' } }),
        result('e1', {
          filePath: file,
          structuredPatch: [
            { oldStart: 40, oldLines: 4, newStart: 40, newLines: 5, lines: ['   <button', "-    style={{ borderRadius: 4 }}", "+    style={{ borderRadius: 12 }}", "+    aria-label=\"登录\"", '   >'] },
          ],
        }),
        rec.claude({ type: 'tool_use', id: 'e2', name: 'Write', input: { file_path: doc, content: '# 记录\n\n按钮改成 12px 圆角\n' } }),
        result('e2', { type: 'create', filePath: doc, content: '# 记录\n\n按钮改成 12px 圆角\n', structuredPatch: [] }),
        rec.claude({ type: 'text', text: '改好了：按钮圆角 12px，顺手记了一笔。' }),
      ),
    );
    const chat = page.getByTestId('chat');
    const changes = chat.getByRole('group', { name: '这次改动的文件' });
    await expect(changes).toContainText('改了 2 个文件');
    await expect(changes.getByRole('button', { name: /Login\.tsx/ })).toContainText('+2');
    await expect(changes.getByRole('button', { name: /Login\.tsx/ })).toContainText('−1');
    await expect(changes.getByRole('button', { name: /notes\.md/ })).toContainText('新');
    // The edit's own line says how much it changed, and opens on the lines themselves.
    const edit = chat.locator('[data-tool="e1"]');
    await expect(edit.locator('summary')).toContainText('+2');
    await changes.getByRole('button', { name: /Login\.tsx/ }).click();
    await expect(edit).toHaveAttribute('open', '');
    await expect(edit.getByRole('group', { name: '改动' })).toContainText('borderRadius: 12');
    await expect(edit.locator('.diff-line.del')).toHaveCount(1);
    await expect(edit.locator('.diff-line.add')).toHaveCount(2);
    await shot(page, '40-chat-changes');
  });

  test('says how far along Claude is through its task list, and 停止 interrupts it', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const { id, transcript } = await newClaude(page);
    const made = (tid: string, use: string, subject: string) => [
      rec.claude({ type: 'tool_use', id: use, name: 'TaskCreate', input: { subject, description: '', activeForm: subject } }),
      { ...rec.user([{ type: 'tool_result', tool_use_id: use, content: `Task #${tid} created` }]), toolUseResult: { task: { id: tid, subject } } },
    ];
    const update = (tid: string, use: string, status: string) => rec.claude({ type: 'tool_use', id: use, name: 'TaskUpdate', input: { taskId: tid, status } });
    writeFileSync(
      transcript,
      jsonl(
        rec.user('把海外版接上后端，去掉微信'),
        ...made('1', 'c1', '对接海外后端 API'),
        ...made('2', 'c2', '去微信化'),
        ...made('3', 'c3', '界面文案英文化'),
        update('1', 'u1', 'in_progress'),
        update('1', 'u2', 'completed'),
        update('2', 'u3', 'in_progress'),
      ),
    );
    await hook(id, 'UserPromptSubmit');
    const chat = page.getByTestId('chat');
    const bar = chat.locator('.chat-tasks');
    await expect(bar).toContainText('任务 1/3');
    await expect(bar).toContainText('正在：去微信化');
    await bar.locator('summary').click();
    await expect(bar.locator('li.completed')).toHaveText(/对接海外后端 API/);
    await expect(chat.getByRole('button', { name: '停止' })).toBeVisible();
    await shot(page, '41-chat-tasks');
    await chat.getByRole('button', { name: '停止' }).click();
  });

  test('reads a claude session as a chat, which follows the transcript', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    const { id, transcript } = await newClaude(page);
    writeFileSync(
      transcript,
      jsonl(
        rec.user('把登录页的按钮改成圆角'),
        rec.claude({ type: 'text', text: '好的，我先看一下按钮的样式。' }),
        rec.claude({ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'grep -rn btn src', description: '找按钮样式' } }),
        rec.user([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'src/styles.css:12: .btn { border-radius: 0 }' }]),
        rec.claude({ type: 'text', text: '准备这样改：\n\n```css\n.btn { border-radius: 8px; transition: background-color 120ms ease-in-out, box-shadow 120ms ease-in-out; }\n```\n\n只动这一行。' }),
        rec.claude({ type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/Users/alice/Projects/some/deeply/nested/project/src/components/buttons/styles.css' } }),
        rec.claude({
          type: 'text',
          text: [
            '## 核心结论',
            '',
            '按钮改成**圆角 8px**，其它不动。',
            '',
            '1. 改样式',
            '   只动 `.btn` 这一条',
            '2. 跑测试',
            '',
            '- 登录页',
            '- 设置页',
            '',
            '| 页面 | 结果 |',
            '|---|---|',
            '| 登录 | ✅ |',
            '',
            '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>',
          ].join('\n'),
        }),
      ),
    );

    const chat = page.getByTestId('chat');
    await expect(chat.getByText('把登录页的按钮改成圆角')).toBeVisible();
    await expect(chat.getByText('好的，我先看一下按钮的样式。')).toBeVisible();
    const tool = chat.getByText('找按钮样式');
    await expect(tool).toBeVisible();
    // A tool call is folded: what it printed shows only when asked for.
    const output = chat.getByText('src/styles.css:12: .btn { border-radius: 0 }');
    await expect(output).toBeHidden();
    await tool.click();
    await expect(output).toBeVisible();
    // Code is set apart from the prose around it, without its fence lines.
    await expect(chat.locator('.reply pre')).toHaveText(/^\.btn \{ border-radius: 8px;/);
    await expect(chat.getByText('只动这一行。')).toBeVisible();
    // A file is named by its name, which a long path would otherwise push out of sight.
    await expect(chat.locator('.tool-summary', { hasText: 'styles.css ~/Projects/some/deeply' })).toBeVisible();
    // Claude writes Markdown, and it reads as such.
    const md = chat.locator('.reply').filter({ hasText: '核心结论' });
    await expect(md.locator('h2')).toHaveText('核心结论');
    await expect(md.locator('strong')).toHaveText('圆角 8px');
    await expect(md.locator('ol > li')).toHaveCount(2);
    await expect(md.locator('ol > li').first()).toContainText('只动 .btn 这一条');
    await expect(md.locator('ul > li')).toHaveCount(2);
    await expect(md.locator('td').last()).toHaveText('✅');
    // What it quotes is text, never markup that runs.
    await expect(md.locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    // Nothing in the chat makes the page scroll sideways.
    expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await shot(page, '16-chat');

    // What Claude writes next shows up without asking.
    appendFileSync(transcript, jsonl(rec.claude({ type: 'text', text: '改好了，圆角 8px。' })));
    await expect(chat.getByText('改好了，圆角 8px。')).toBeVisible({ timeout: 5_000 });
    await expect(chat.getByText('把登录页的按钮改成圆角')).toHaveCount(1);

    // Claude asking for a decision can only be answered in the terminal, so the chat says so.
    await hook(id, 'Notification');
    await expect(chat.getByText('Claude 在等你确认')).toBeVisible();
    await shot(page, '17-chat-waiting');

    // The choice is kept for this session.
    await page.reload();
    await expect(page.getByTestId('chat').getByText('改好了，圆角 8px。')).toBeVisible();
    await expect(page.locator('.term-page')).toHaveAttribute('data-link', 'live');

    // The composer types into the session.
    const composer = page.getByLabel('输入');
    await composer.fill('echo from-chat-$((2*3))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('from-chat-6');
  });

  test('follows new replies while at its end, and stays put while reading further up', async ({ page }) => {
    await login(page);
    const { transcript } = await newClaude(page);
    writeFileSync(transcript, jsonl(...Array.from({ length: 40 }, (_, i) => rec.claude({ type: 'text', text: `第 ${i} 段回复` }))));
    const chat = page.getByTestId('chat');
    await expect(chat.getByText('第 39 段回复')).toBeInViewport();

    appendFileSync(transcript, jsonl(rec.claude({ type: 'text', text: '新的一段' })));
    await expect(chat.getByText('新的一段')).toBeInViewport();

    const down = page.getByRole('button', { name: '回到底部' });
    await expect(down).toBeHidden();
    await chat.evaluate((el) => el.scrollTo(0, 0));
    await expect(chat.getByText('第 0 段回复')).toBeInViewport();
    appendFileSync(transcript, jsonl(rec.claude({ type: 'text', text: '又一段' })));
    await expect(chat.getByText('又一段')).toHaveCount(1);
    await expect(chat.getByText('第 0 段回复')).toBeInViewport();
    await expect(down).toBeVisible();
    await shot(page, '21-chat-scrolled-up');
    await down.click();
    await expect(chat.getByText('又一段')).toBeInViewport();
    await expect(down).toBeHidden();
  });

  // Sending is the reader saying they are back at the end: the chat goes there and follows the answer.
  // A key (Esc, ^C, arrows) sends nothing to the chat, and a message that goes in later was already followed.
  test('goes to its end on a message sent while reading further up, and then follows the answer', async ({ page }) => {
    await login(page);
    const { transcript } = await newClaude(page);
    writeFileSync(transcript, jsonl(...Array.from({ length: 40 }, (_, i) => rec.claude({ type: 'text', text: `第 ${i} 段回复` }))));
    const chat = page.getByTestId('chat');
    await expect(chat.getByText('第 39 段回复')).toBeInViewport();
    const down = page.getByRole('button', { name: '回到底部' });
    await chat.evaluate((el) => el.scrollTo(0, 0));
    await expect(down).toBeVisible();

    await page.getByRole('button', { name: 'Esc', exact: true }).click();
    await expect(chat.getByText('第 0 段回复')).toBeInViewport();
    await expect(down).toBeVisible();

    const composer = page.getByLabel('输入');
    await composer.fill('看完旧的了，接着说');
    await shot(page, '46-send-while-scrolled-up');
    await composer.press('Enter');
    await expect(chat.getByText('看完旧的了，接着说')).toBeInViewport();
    await expect(down).toBeHidden();
    await shot(page, '47-sent-and-at-the-end');

    appendFileSync(
      transcript,
      jsonl(rec.user('看完旧的了，接着说'), ...Array.from({ length: 12 }, (_, i) => rec.claude({ type: 'text', text: `接着的第 ${i} 段` }))),
    );
    await expect(chat.getByText('接着的第 11 段')).toBeInViewport();
    await expect(down).toBeHidden();
  });

  test('is the session page alone: nothing of the screen comes to the phone', async ({ page }) => {
    const binary: unknown[] = [];
    page.on('websocket', (ws) => {
      if (/\/sessions\/[a-z0-9]+\/ws/.test(ws.url())) ws.on('framereceived', (f) => typeof f.payload !== 'string' && binary.push(f.payload));
    });
    await login(page);
    await newSession(page);
    const composer = page.getByLabel('输入');
    await composer.fill('echo only-chat-$((4*4))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('only-chat-16');
    for (const name of ['终端', '聊天', '历史']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.locator('.xterm')).toHaveCount(0);
    expect(binary).toEqual([]);
  });

  test('leaves what Claude waits on that it cannot read to look at as the screen', async ({ page }) => {
    await login(page);
    const { id } = await newSession(page);
    const composer = page.getByLabel('输入');
    await composer.fill('echo on-screen-$((6*7)); sleep 3; echo later-$((5*5))');
    await composer.press('Enter');
    await expect.poll(() => termText(page)).toContain('on-screen-42');
    await hook(id, 'Notification');
    const chat = page.getByTestId('chat');
    await expect(chat.getByText('Claude 在等你确认')).toBeVisible();
    await chat.getByRole('button', { name: '看屏幕' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mac 上的屏幕' });
    const text = sheet.getByLabel('屏幕内容');
    await expect(text).toContainText('on-screen-42');
    await expect(text).not.toContainText('later-25');
    await shot(page, '27-screen');
    // It is the screen as it was when asked for; 刷新 asks again.
    await expect.poll(() => termText(page)).toContain('later-25');
    await expect(text).not.toContainText('later-25');
    await sheet.getByRole('button', { name: '刷新' }).click();
    await expect(text).toContainText('later-25');
  });

  test('says it is empty while the transcript is not written yet', async ({ page }) => {
    await login(page);
    await newClaude(page);
    await expect(page.getByTestId('chat').getByText('还没有对话')).toBeVisible();
    await shot(page, '18-chat-empty');
  });

  test.describe('a choice Claude asks for', () => {
    test('is answered by tapping it', async ({ page }) => {
      await login(page);
      const { id } = await newClaude(page);
      const select = fileURLToPath(new URL('../fixtures/select.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${select} 先跑测试 直接上线 '再想想'`);
      await composer.press('Enter');
      // Claude shows its question before it notifies.
      await expect.poll(() => termText(page)).toContain('Which one?');
      await hook(id, 'Notification');

      const card = page.getByRole('group', { name: 'Claude 在问你' });
      await expect(card.getByText('Which one?')).toBeVisible();
      await expect(card.getByRole('button', { name: /先跑测试/ })).toHaveAttribute('aria-current', 'true');
      await shot(page, '19-chat-choice');
      // Tapped while typing, its buttons act without putting the keyboard away.
      await composer.focus();
      await card.getByRole('button', { name: 'Esc 取消' }).click();
      await expect(composer).toBeFocused();
      await card.getByRole('button', { name: /直接上线/ }).click();
      await expect(composer).toBeFocused();
      await expect(card).toBeHidden();

      await expect.poll(() => termText(page)).toContain('picked: 直接上线');
    });

    test('takes several answers as ticks, sent in one go', async ({ page }) => {
      await login(page);
      const { id } = await newSession(page);
      const multi = fileURLToPath(new URL('../fixtures/multiselect.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${multi} '跑 lint' +类型检查 跑测试 '一段很长很长的选项名字，长到在手机上一行放不下，看它怎么折行'`);
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('Which checks?');
      await hook(id, 'Notification');

      const card = page.getByRole('group', { name: 'Claude 在问你' });
      await expect(card.getByText('Which checks?')).toBeVisible();
      const box = (name: RegExp) => card.getByRole('checkbox', { name });
      await expect(box(/类型检查/)).toBeChecked();
      await expect(box(/跑 lint/)).not.toBeChecked();
      // The answer of one's own cannot be ticked from here, and says where to write it instead.
      await expect(card.getByRole('checkbox', { name: /Type something/ })).toHaveCount(0);
      await expect(card.getByText(/自己写/)).toBeVisible();

      // Ticking stays in the card until it is sent: nothing reaches the program yet.
      await composer.focus();
      await box(/跑 lint/).click();
      await box(/类型检查/).click();
      await box(/跑测试/).click();
      await expect(composer).toBeFocused();
      await expect(box(/跑 lint/)).toBeChecked();
      await expect(box(/类型检查/)).not.toBeChecked();
      await expect(card.getByRole('button', { name: '提交（2 项）' })).toBeVisible();
      await shot(page, '31-chat-multi-choice');
      const before = await termText(page);
      expect(before).toContain('[✔] 类型检查');
      expect(before).toContain('[ ] 跑 lint');

      await card.getByRole('button', { name: '提交（2 项）' }).click();
      await expect(card).toBeHidden();
      await expect.poll(() => termText(page)).toContain('ticked: 跑 lint,跑测试');
    });

    test("takes an answer of one's own, typed in the composer once its option is tapped", async ({ page }) => {
      await login(page);
      const { id } = await newClaude(page);
      const select = fileURLToPath(new URL('../fixtures/select.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${select} 先跑测试 'Type something.'`);
      await composer.press('Enter');
      await hook(id, 'Notification');

      const card = page.getByRole('group', { name: 'Claude 在问你' });
      await card.getByRole('button', { name: '自己写一个回答' }).click();
      await expect(card.getByText('在下面的输入框写回答，发送就行')).toBeVisible();
      await expect(card.getByRole('button', { name: '自己写一个回答' })).toHaveAttribute('aria-current', 'true');
      await shot(page, '20-chat-choice-typed');
      await composer.fill('周一再发');
      await composer.press('Enter');
      await expect.poll(() => termText(page)).toContain('picked: Type something.');
    });
  });

  test.describe('a panel Claude opens', () => {
    test('shows in the chat, holds back what is sent into it, and closes from there', async ({ page }) => {
      await login(page);
      await newClaude(page);
      const log = join(tmpdir(), `panel-keys-${process.pid}-${Date.now()}`);
      writeFileSync(log, '');
      const keys = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string);
      const panel = fileURLToPath(new URL('../fixtures/panel.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${panel} ${log}`);
      await composer.press('Enter');

      const card = page.getByRole('group', { name: 'Claude 打开了「设置」面板' });
      await expect(card).toBeVisible();
      await expect(card.locator('.panel-body')).toContainText('❯ Auto-compact');
      await shot(page, '24-chat-panel');
      // Sent now, it would go into the panel: it stays in the composer, saying why.
      await composer.fill('帮我看看');
      await composer.press('Enter');
      await expect(page.getByRole('status', { name: '发送暂停' })).toContainText('「设置」');
      await expect(composer).toHaveValue('帮我看看');
      expect(keys()).toEqual([]);

      // Either close is the key bar's Esc: one press, one Esc, and the keyboard stays where it was. A tap that
      // took the focus would put the keyboard away under the finger, moving what was tapped from under it.
      const held = page.getByRole('status', { name: '发送暂停' });
      await expect(composer).toBeFocused();
      await held.getByRole('button', { name: '关闭' }).click();
      await expect(composer).toBeFocused();
      // The first Esc only clears the search box, so the panel is still up.
      await expect.poll(keys).toEqual(['\x1b']);
      await expect(card.locator('.panel-body')).toContainText('❯ Auto-compact');
      await card.getByRole('button', { name: '关闭 (Esc)' }).click();
      await expect(composer).toBeFocused();
      await expect.poll(keys).toEqual(['\x1b', '\x1b']);
      await expect(card).toBeHidden();
      await expect(held).toBeHidden();
      await composer.press('Enter');
      await expect(composer).toHaveValue('');
      await expect.poll(() => keys().join('')).toContain('帮我看看');
    });

    for (const where of ['card', 'held'] as const) {
      test(`takes one Esc from a close tapped twice, the second tap landing on nothing (${where})`, async ({ page }) => {
        await login(page);
        await newClaude(page);
          const log = join(tmpdir(), `panel-keys-${process.pid}-${Date.now()}`);
        writeFileSync(log, '');
        const keys = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string);
        const panel = fileURLToPath(new URL('../fixtures/panel.mjs', import.meta.url));
        const composer = page.getByLabel('输入');
        await composer.fill(`${process.execPath} ${panel} ${log} tall`);
        await composer.press('Enter');
        const card = page.getByRole('group', { name: /^Claude 打开了/ });
        await expect(card).toBeVisible();
        await composer.fill('帮我看看');
        await composer.press('Enter');
        const held = page.getByRole('status', { name: '发送暂停' });

        // An Esc after the panel has gone lands on the prompt, where two in a row open Claude Code's rewind menu.
        const close = where === 'card' ? card.getByRole('button', { name: '关闭 (Esc)' }) : held.getByRole('button', { name: '关闭' });
        await close.dblclick();
        await expect.poll(keys).toEqual(['\x1b']);
        await expect(card).toBeHidden();
        await expect(held).toBeHidden();
        await page.waitForTimeout(300);
        expect(keys()).toEqual(['\x1b']);
      });
    }

    test('lets go of the composer at once when taller than the screen and closed from the key bar', async ({ page }) => {
      await login(page);
      await newClaude(page);
      const log = join(tmpdir(), `panel-keys-${process.pid}-${Date.now()}`);
      writeFileSync(log, '');
      const keys = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string);
      const panel = fileURLToPath(new URL('../fixtures/panel.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${panel} ${log} tall`);
      await composer.press('Enter');

      // Right above the composer, where the eyes are when sending, whatever the chat is scrolled to.
      const held = page.getByRole('status', { name: '发送暂停' });
      await expect(held).toBeVisible();
      await expect(held).toContainText('Claude 开着「用量」面板');
      await expect(held).toBeInViewport();
      const bar = (await held.boundingBox())!;
      const box = (await composer.boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(box.y + 1);
      await composer.fill('帮我看看');
      await composer.press('Enter');
      await expect(composer).toHaveValue('帮我看看');
      expect(keys()).toEqual([]);
      await shot(page, '29-panel-held');
      await page.emulateMedia({ colorScheme: 'light' });
      await shot(page, '29-panel-held-light');
      await page.emulateMedia({ colorScheme: null });

      // Closed in the terminal's own way: the card and the hold go with it, and the text is let through.
      await page.getByRole('button', { name: 'Esc', exact: true }).click();
      await expect(held).toBeHidden();
      await expect(page.getByRole('group', { name: /^Claude 打开了/ })).toBeHidden();
      await composer.press('Enter');
      await expect(composer).toHaveValue('');
      expect(keys()[0]).toBe('\x1b');
      await expect.poll(() => keys().join('')).toContain('帮我看看');
    });

    test('says, as the usage panel, how much of the plan is used and what it could not read', async ({ page }) => {
      await login(page);
      await newClaude(page);
      const log = join(tmpdir(), `panel-keys-${process.pid}-${Date.now()}`);
      writeFileSync(log, '');
      const panel = fileURLToPath(new URL('../fixtures/panel.mjs', import.meta.url));
      const composer = page.getByLabel('输入');
      await composer.fill(`${process.execPath} ${panel} ${log} usage`);
      await composer.press('Enter');
      const card = page.getByRole('group', { name: 'Claude 打开了「用量」面板' });
      await expect(card.locator('.panel-usage')).toHaveText(['5 小时额度已用 9%', '本周额度：屏幕上没露出来']);
      await expect(card.locator('.panel-body')).toContainText('Total cost:            $1.23');
      await shot(page, '25-chat-usage');
    });
  });

  test.describe("when an account's limit stops a reply", () => {
    // Claude stays at its prompt, where a limit leaves it.
    const stays = join(E2E_HOME, 'claude-stays');
    test.beforeEach(() => writeFileSync(stays, ''));
    test.afterEach(() => rmSync(stays, { force: true }));
    const limitHit = () =>
      jsonl(rec.user('把登录页的按钮改成圆角'), {
        ...rec.claude({ type: 'text', text: "You've hit your weekly limit · resets 4pm (Europe/Rome)" }),
        isApiErrorMessage: true,
        error: 'rate_limit',
        apiError: 'usage_limit_reached',
      });
    // New sessions start on the default account again, as before any was picked.
    test.afterEach(async ({ page }) => void (await api(page, 'PUT', '/api/claude/account', { id: '' })));
    const runsOn = async (page: Page, id: string) => {
      const list: { id: string; claudeAccount?: string }[] = await (await api(page, 'GET', '/api/m/local/sessions')).json();
      return list.find((x) => x.id === id)?.claudeAccount;
    };
    const stopped = async (page: Page) => {
      await login(page);
      await clearSessions(page);
      await page.reload();
      const { id, transcript } = await newClaude(page);
      writeFileSync(transcript, limitHit());
      await hook(id, 'Stop');
      return id;
    };

    test('goes on on another account of the Mac, and says continue once the session runs there', async ({ page }) => {
      const id = await stopped(page);
      const chat = page.getByTestId('chat');
      await expect(chat.getByText('额度用完了')).toBeVisible();
      await expect(chat.getByText(/weekly limit/)).toBeVisible();
      await expect(chat.getByRole('button', { name: '再试一次' })).toBeVisible();
      await shot(page, '50-chat-limit');
      await chat.getByRole('button', { name: '换个账号接着跑' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('button', { name: /own@example\.com/ })).toHaveCount(0);
      await expect(sheet).toContainText('开着的会话都会在那个账号上从停下的地方接着跑');
      await expect(sheet).not.toContainText('还没看到它的用量');
      await shot(page, '51-chat-limit-accounts');
      await sheet.getByRole('button', { name: /work@example\.com/ }).click();
      await expect(sheet).toBeHidden();
      await expect(chat.getByText('继续', { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(await runsOn(page, id)).toBe('work@example.com');
      const accounts = await (await api(page, 'GET', '/api/claude/accounts')).json();
      expect(accounts).toMatchObject({ elsewhere: 0, moving: 0 });
    });

    test('asks, of a message typed while stopped, whether to go on on another account first', async ({ page }) => {
      const id = await stopped(page);
      const chat = page.getByTestId('chat');
      await expect(chat.getByRole('button', { name: '换个账号接着跑' })).toBeVisible();
      const composer = page.getByLabel('输入');
      await composer.fill('把按钮也改成蓝色');
      await composer.press('Enter');
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText('「把按钮也改成蓝色」先留着，换好账号就发出去。');
      await expect(composer).toHaveValue('');
      await shot(page, '57-chat-limit-typed');

      // Not moved: the message is the composer's again.
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(composer).toHaveValue('把按钮也改成蓝色');

      // A command is not a message to hold.
      await composer.fill('/usage');
      await composer.press('Enter');
      await expect(sheet).toBeHidden();
      await page.keyboard.press('Escape');

      // Moved: it goes once the session runs on the other account.
      await composer.fill('把按钮也改成蓝色');
      await composer.press('Enter');
      await sheet.getByRole('button', { name: /work@example\.com/ }).click();
      await expect(sheet).toBeHidden();
      await expect(chat.getByText('把按钮也改成蓝色', { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(await runsOn(page, id)).toBe('work@example.com');
    });

    test('moves, from the This Mac page, the open sessions to the account picked, each once its reply is done', async ({ page }) => {
      const id = await stopped(page);
      await hook(id, 'UserPromptSubmit');
      await page.goto('/mac');
      await page.getByRole('button', { name: /work@example\.com/ }).click();
      const callout = page.locator('.mac-move');
      await expect(callout).toContainText('1 个开着的会话还在别的账号上');
      await expect(callout).toContainText('搬到 work@example.com，从停下的地方接着跑。');
      await shot(page, '55-mac-move');
      await callout.getByRole('button', { name: '搬过去' }).click();
      // Mid-reply, it waits for the reply to be done.
      await expect(callout).toContainText('正在搬 1 个会话');
      await expect(callout).toContainText('正在搬到 work@example.com：空闲的马上搬，正在回复的等这轮完了再搬。');
      await expect(page.getByText('新会话用打勾的账号开')).toHaveCount(0);
      await shot(page, '56-mac-moving');
      expect(await runsOn(page, id)).toBe('own@example.com');
      await hook(id, 'Stop');
      await expect(callout).toBeHidden({ timeout: 20_000 });
      expect(await runsOn(page, id)).toBe('work@example.com');
    });

    test("switches account from the session's menu, saying nothing once moved", async ({ page }) => {
      await login(page);
      await clearSessions(page);
      await page.reload();
      const { id } = await newClaude(page);
      await page.getByRole('button', { name: '会话操作' }).click();
      await page.getByRole('button', { name: '换 Claude 账号' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText('换 Claude 账号');
      await shot(page, '60-chat-switch-account');
      await sheet.getByRole('button', { name: /work@example\.com/ }).click();
      await expect(sheet).toBeHidden();
      await expect.poll(() => runsOn(page, id), { timeout: 20_000 }).toBe('work@example.com');
      await expect(page.getByTestId('chat').getByText('继续', { exact: true })).toHaveCount(0);
    });

    test('offers, while Claude is at work, to switch now or once its reply is done', async ({ page }) => {
      const id = await stopped(page);
      await hook(id, 'UserPromptSubmit');
      await page.getByRole('button', { name: '会话操作' }).click();
      await page.getByRole('button', { name: '换 Claude 账号' }).click();
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('button', { name: /work@example\.com/ }).click();
      await expect(sheet).toContainText('Claude 这轮还没回复完。');
      await expect(sheet.getByRole('button', { name: '现在就换（会打断它）' })).toBeVisible();
      await shot(page, '61-chat-switch-when');
      await sheet.getByRole('button', { name: '等它停下再换' }).click();
      await expect(sheet).toBeHidden();
      expect(await runsOn(page, id)).toBe('own@example.com');
      await hook(id, 'Stop');
      await expect.poll(() => runsOn(page, id), { timeout: 20_000 }).toBe('work@example.com');
    });

    test('says how to add an account when the Mac has no other', async ({ page }) => {
      // The other account is not through Claude Code's first run, so nothing can go on on it.
      const file = join(E2E_HOME, 'accounts', '.claude-work', '.claude.json');
      const was = readFileSync(file, 'utf8');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(was), hasCompletedOnboarding: false }));
      try {
        await login(page);
        await clearSessions(page);
        await page.reload();
        const { id, transcript } = await newClaude(page);
        writeFileSync(transcript, limitHit());
        await hook(id, 'Stop');
        const chat = page.getByTestId('chat');
        await expect(chat.getByRole('button', { name: '再试一次' })).toBeVisible();
        // Until the Mac reads its accounts again, which it does at most every 10 seconds.
        await expect(async () => {
          await page.reload();
          await expect(chat.getByText(/CLAUDE_CONFIG_DIR=~\/\.claude-<名字> claude/)).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        await expect(chat.getByRole('button', { name: '换个账号接着跑' })).toHaveCount(0);
        await shot(page, '52-chat-limit-no-account');
      } finally {
        writeFileSync(file, was);
      }
    });
  });

  test('keeps the place of what is under the composer while the session is read', async ({ page }) => {
    const stays = join(E2E_HOME, 'claude-stays');
    writeFileSync(stays, '');
    try {
      await login(page);
      await clearSessions(page);
      await page.reload();
      const { id } = await newClaude(page);
      await hook(id, 'Stop');
      // On a phone that kept nothing of it, until the session list comes on /api/events, what runs in the session
      // is not known.
      await page.routeWebSocket(/\/api\/events/, () => {});
      await page.route('**/api/events/now', () => {});
      await page.evaluate(() => localStorage.clear());
      await page.goto(`/m/local/s/${id}`);
      const placeholder = page.getByRole('status', { name: '读取中…' }).and(page.locator('.pill-skeleton'));
      await expect(placeholder).toBeVisible();
      await shot(page, '53-chat-pill-loading');
      const height = (await page.locator('.composer-foot').boundingBox())?.height;

      const after = await page.context().newPage();
      await after.goto(`/m/local/s/${id}`);
      await expect(after.locator('.pill')).toBeVisible();
      await expect(after.locator('.pill-skeleton')).toHaveCount(0);
      expect((await after.locator('.composer-foot').boundingBox())?.height).toBe(height);
    } finally {
      rmSync(stays, { force: true });
    }
  });

  test('quits, from the bar that says so, the Claude in a terminal on the Mac that has the conversation open too', async ({ page }) => {
    // Claude stays at its prompt.
    const stays = join(E2E_HOME, 'claude-stays');
    writeFileSync(stays, '');
    await login(page);
    await clearSessions(page);
    await page.reload();
    const { id } = await newClaude(page);
    const list: { id: string; claudeSessionId: string }[] = await (await api(page, 'GET', '/api/m/local/sessions')).json();
    const sid = list.find((x) => x.id === id)!.claudeSessionId;
    // Not in a WorkOffDesk session, as a terminal's Claude is not.
    const there = spawn('sleep', ['600'], { stdio: 'ignore', env: { PATH: '/bin:/usr/bin' } });
    const agents = join(E2E_HOME, 'mac-agents.json');
    writeFileSync(agents, JSON.stringify([{ pid: there.pid, sessionId: sid, cwd: E2E_HOME, kind: 'interactive', status: 'idle' }]));
    try {
      // The Mac is looked at as a message goes in.
      const composer = page.getByLabel('输入');
      await composer.fill('看看');
      await composer.press('Enter');
      const bar = page.getByRole('status', { name: '这个对话在 Mac 的终端里也开着' });
      await expect(bar).toContainText('两边各写各的', { timeout: 20_000 });
      await shot(page, '62-chat-also-on-mac');
      await bar.getByRole('button', { name: '退出那边的 Claude' }).click();
      await expect(bar).toBeHidden({ timeout: 20_000 });
      expect(there.exitCode !== null || there.signalCode !== null).toBe(true);
    } finally {
      rmSync(agents, { force: true });
      there.kill('SIGKILL');
      rmSync(stays, { force: true });
    }
  });
});
