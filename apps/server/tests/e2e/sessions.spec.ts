import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_HOME } from '../../playwright.config';
import { shot, login, api, clearSessions, termText, newSession, hook, rec, jsonl, newClaude } from '../helpers/e2e';

// A finger dragged sideways across a row of the session list.
async function swipeRow(page: Page, row: Locator, dx: number, dy = 4) {
  const b = (await row.boundingBox())!;
  const at = { x: b.x + b.width - 40, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('the session list', () => {
  test('lists what people started to resume, keeps what agents started folded away, and stays tidy when long', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /续上最近的 Claude/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: /登录页按钮圆角/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /MEM-705/ })).toBeHidden();
    await expect(sheet.getByText('Paperclip Wake Payload')).toHaveCount(0);
    const fold = sheet.getByRole('button', { name: '自动任务的会话（12）' });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet.getByRole('button', { name: /MEM-705 自动任务 5/ })).toBeVisible();
    // Long enough to scroll, and the search box keeps its height all the same.
    const body = sheet.locator('.sheet-body');
    expect(await body.evaluate((b) => b.scrollHeight > b.clientHeight), 'precondition: the list overflows').toBe(true);
    const search = sheet.getByPlaceholder('搜标题或路径');
    const box = (await search.boundingBox())!;
    expect(box.height).toBeCloseTo(42, 0);
    // The back and close icons line up with the edges of what is under them.
    const back = (await sheet.getByRole('button', { name: '上一步' }).locator('svg').boundingBox())!;
    const close = (await sheet.getByRole('button', { name: '关闭' }).locator('svg').boundingBox())!;
    expect(Math.abs(back.x - box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(close.x + close.width - (box.x + box.width))).toBeLessThanOrEqual(1);
    await shot(page, '10-pick-recent-many');
    // A search looks through the folded ones too.
    await fold.click();
    await search.fill('MEM-709');
    await expect(sheet.getByRole('button', { name: /MEM-709/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /登录页按钮圆角/ })).toBeHidden();
  });

  test('shows the status of Claude sessions, which start in a project or resume', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();

    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /在项目里新开 Claude/ }).click();
    await expect(page.getByRole('button', { name: /project-a/ })).toBeVisible();
    await shot(page, '09-pick-project');
    await page.getByRole('button', { name: /project-a/ }).click();
    await expect.poll(() => termText(page), { timeout: 10_000 }).toContain('fake claude --session-id');
    const fresh = page.url().split('/').pop()!;
    await page.getByRole('button', { name: '返回' }).click();

    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /续上最近的 Claude/ }).click();
    await expect(page.getByRole('button', { name: /登录页按钮圆角/ })).toBeVisible();
    await shot(page, '10-pick-recent');
    await page.getByRole('button', { name: /登录页按钮圆角/ }).click();
    // It opens to read first; picking it up here is a step of its own, confirmed again while the Mac may
    // still be writing it (the fixture was written moments ago).
    await page.getByRole('button', { name: '在手机上接着聊' }).click();
    await expect(page.getByText(/两边同时写会分叉/)).toBeVisible();
    await page.getByRole('button', { name: '在手机上接着聊' }).click();
    await expect.poll(() => termText(page), { timeout: 10_000 }).toContain('fake claude --resume 3f2a1b4c');
    await page.getByRole('button', { name: '返回' }).click();

    await hook(fresh, 'UserPromptSubmit');
    await hook(fresh, 'Notification');
    await newSession(page);
    await page.getByRole('button', { name: '返回' }).click();
    const cards = page.getByTestId('session-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.filter({ hasText: '等你确认' })).toHaveCount(1);
    await shot(page, '11-list');
    // Claude's sessions wear the app's own colour, and still differ from a shell at a glance.
    const styled = (attrs: Partial<HTMLElement>, prop: 'color' | 'backgroundColor') =>
      page.evaluate(([a, p]) => {
        const probe = document.body.appendChild(Object.assign(document.createElement('span'), a));
        const value = getComputedStyle(probe)[p];
        probe.remove();
        return value;
      }, [attrs, prop] as const);
    const accent = await styled({ style: 'color: var(--accent)' } as Partial<HTMLElement>, 'color');
    const claudeAvatar = await cards.locator('.avatar.claude').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(claudeAvatar).toBe(accent);
    expect(await styled({ className: 'avatar shell' }, 'backgroundColor')).not.toBe(claudeAvatar);

    // A transcript already open in a session jumps there instead of opening a second copy.
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /续上最近的 Claude/ }).click();
    await expect(page.getByRole('button', { name: /登录页按钮圆角/ })).toContainText('已打开');
  });

  test('lists a conversation a Claude background session holds, which cannot be resumed here', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /续上最近的 Claude/ }).click();
    const held = page.getByRole('dialog').getByRole('button', { name: /把博客文章改成图文帖/ });
    await expect(held).toContainText('在 Claude 后台会话里，这里不能续');
    await expect(held).toBeDisabled();
    await expect(page.getByRole('dialog').getByRole('button', { name: /登录页按钮圆角/ })).toBeEnabled();
    await shot(page, '39-recent-background-held');
  });

  test('says a conversation whose folder is gone cannot go on here, before and after it is opened', async ({ page }) => {
    const sid = '3f2a1b4c-0000-4000-8000-0000000000aa';
    writeFileSync(
      join(E2E_HOME, 'claude-projects', '-p', `${sid}.jsonl`),
      jsonl({ type: 'user', cwd: join(E2E_HOME, 'worktrees', 'battle-pigeon'), message: { content: '修一下 worktree 里的测试' } }),
    );
    await login(page);
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('button', { name: /续上最近的对话/ }).click();
    const gone = page.getByRole('dialog').getByRole('button', { name: /修一下 worktree 里的测试/ });
    await expect(gone).toContainText('文件夹已不在，这里不能续');
    await expect(gone).toBeDisabled();

    await page.goto(`/claude/${sid}`);
    await expect(page.locator('.bubble').filter({ hasText: '修一下 worktree 里的测试' })).toBeVisible();
    await expect(page.getByRole('button', { name: '它的文件夹已经不在了，这里接不上' })).toBeDisabled();
    await expect(page.getByText(/battle-pigeon 已经不在这台 Mac 上了/)).toBeVisible();
    await expect(page.getByRole('button', { name: /接管到手机|在手机上接着聊/ })).toHaveCount(0);
    await shot(page, '54-mac-conversation-folder-gone');
  });

  // Its reads go through the page's own fetch, where they can be made to fail, not through the service worker.
  test.describe('with the network failing', () => {
    test.use({ serviceWorkers: 'block' });

    test('keeps asking the Mac about a conversation it could not reach, and offers to go on once it hears', async ({ page }) => {
      const sid = '3f2a1b4c-0000-4000-8000-0000000000ab';
      writeFileSync(join(E2E_HOME, 'claude-projects', '-p', `${sid}.jsonl`), jsonl({ type: 'user', cwd: E2E_HOME, message: { content: '看一下构建为什么慢' } }));
      await login(page);
      // One ask that fails: the client tries a read four times (retry.ts) before it gives up.
      let refused = 0;
      await page.route('**/api/recent', (route) => (refused < 4 ? (refused++, route.abort('internetdisconnected')) : route.continue()));
      await page.goto(`/claude/${sid}`);
      await expect(page.getByText('连不上服务器，检查一下网络')).toBeVisible();
      await expect(page.getByRole('button', { name: '在手机上接着聊' })).toBeDisabled();
      await expect(page.getByRole('button', { name: '在手机上接着聊' })).toBeEnabled({ timeout: 15_000 });
      expect(refused).toBe(4);
      await expect(page.getByText('连不上服务器，检查一下网络')).toHaveCount(0);
    });
  });

  test('reads like a chat list: what Claude said last, when, and who needs you', async ({ page }) => {
    await login(page);
    await clearSessions(page);
    await page.reload();
    // New sessions start from the header; nothing floats over the list.
    await expect(page.getByRole('heading', { name: '会话', exact: true })).toBeVisible();
    await expect(page.locator('.fab')).toHaveCount(0);

    const done = await newClaude(page);
    writeFileSync(done.transcript, jsonl(rec.user('改按钮'), rec.claude({ type: 'text', text: '改好了，**圆角 8px**，测试全绿。' })));
    await hook(done.id, 'UserPromptSubmit');
    await hook(done.id, 'Stop');
    await page.getByRole('button', { name: '返回' }).click();
    const busy = await newClaude(page);
    await page.getByRole('button', { name: '返回' }).click();
    // A command line opened on the Mac's side is listed too.
    await api(page, 'POST', '/api/m/local/sessions', { kind: 'shell' });

    const rows = page.getByTestId('session-card');
    await expect(rows).toHaveCount(3);
    const said = rows.filter({ hasText: '改好了，圆角 8px，测试全绿。' });
    await expect(said).toHaveCount(1);
    await expect(said.locator('.sess-time')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(said.locator('.needs-you, .busy')).toHaveCount(0);

    // What a session is doing shows as it changes, without reloading.
    await hook(busy.id, 'UserPromptSubmit');
    const working = rows.filter({ hasText: '在干活…' });
    await expect(working.locator('.busy')).toBeVisible();
    await expect(working.locator('.needs-you')).toHaveCount(0);
    await hook(busy.id, 'Notification');
    const asking = rows.filter({ hasText: '等你确认' });
    await expect(asking.locator('.needs-you')).toBeVisible();
    await expect(asking.locator('.busy')).toHaveCount(0);
    await shot(page, '23-list');

    // Search by name or folder.
    const search = page.getByRole('searchbox', { name: '搜索' });
    const hint = page.getByText('搜索', { exact: true });
    await expect(hint).toBeVisible();
    await search.fill('PROJECT-A');
    // The word stands in for what is typed and goes once there is some.
    await expect(hint).toBeHidden();
    await expect(rows).toHaveCount(2);
    await search.fill('ts-e2e');
    await expect(rows).toHaveCount(2);
    await search.fill('没有这个');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('没有找到「没有这个」')).toBeVisible();
    await search.fill('');
    await expect(rows).toHaveCount(3);
  });

  test('names a command line opened on the Mac, whose screen can be looked at', async ({ page }) => {
    await login(page);
    const shell = await (await api(page, 'POST', '/api/m/local/sessions', { kind: 'shell' })).json();
    await page.goto(`/m/local/s/${shell.id}`);
    await expect(page.getByText('这是 Mac 上的命令行会话')).toBeVisible();
    await expect(page.getByLabel('输入')).toHaveCount(0);
    await shot(page, '28-shell-session');
    await page.getByRole('button', { name: '看屏幕' }).click();
    await expect(page.getByRole('dialog', { name: 'Mac 上的屏幕' }).getByLabel('屏幕内容')).toBeVisible();
  });

  test.describe('a session kept as past', () => {
    test('stays listed once ended from its row, goes on in place, and is deleted only after asking', async ({ page }) => {
      await login(page);
      await clearSessions(page);
      const { id, transcript } = await newClaude(page);
      await page.getByRole('button', { name: '返回' }).click();
      const row = page.getByTestId('session-card').filter({ hasText: 'project-a' });
      await swipeRow(page, row, -120);
      await page.getByRole('button', { name: '结束会话' }).click();
      await expect(row).toHaveCount(1);
      await expect(row.locator('.avatar.mac')).toBeVisible();
      // Read back from the Mac rather than from what this page remembers.
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(row.locator('.avatar.mac')).toBeVisible();
      await shot(page, '58-past-session');

      await row.click();
      await expect(page).toHaveURL(new RegExp(`/s/${id}$`));
      await expect(page.getByText('会话已结束')).toBeVisible();
      // Claude no longer keeps a conversation it has no transcript of: it can only be read here.
      await page.getByRole('button', { name: '接着这个对话' }).click();
      await expect(page.getByText(/这个对话已经不在 Agent 那里了/)).toBeVisible();
      await expect(page.locator('.term-page')).not.toHaveAttribute('data-link', 'live');
      writeFileSync(transcript, jsonl(rec.user('把首页改成深色')));
      await page.getByRole('button', { name: '接着这个对话' }).click();
      await expect(page.locator('.term-page')).toHaveAttribute('data-link', 'live', { timeout: 10_000 });
      await expect(page).toHaveURL(new RegExp(`/s/${id}$`));
      await page.getByRole('button', { name: '返回' }).click();
      await expect(row.locator('.avatar.mac')).toHaveCount(0);

      await swipeRow(page, row, -120);
      await page.getByRole('button', { name: '结束会话' }).click();
      await expect(row.locator('.avatar.mac')).toBeVisible();
      await swipeRow(page, row, -120);
      await page.getByRole('button', { name: '删除' }).click();
      const ask = page.getByRole('dialog', { name: '删除这个会话？' });
      await expect(ask).toBeVisible();
      await ask.getByRole('button', { name: '取消' }).click();
      await expect(row).toHaveCount(1);
      await swipeRow(page, row, -120);
      await page.getByRole('button', { name: '删除' }).click();
      await page.getByRole('dialog', { name: '删除这个会话？' }).getByRole('button', { name: '删除' }).click();
      await expect(row).toHaveCount(0);
      const listed: { id: string }[] = await (await api(page, 'GET', '/api/m/local/sessions')).json();
      expect(listed.map((s) => s.id)).not.toContain(id);
    });
  });

  test('finds every other conversation on the Mac from the clock, by day and by a search', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Mac 上的对话' }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    await expect(page.getByRole('heading', { name: 'Mac 上的对话' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
    const found = page.locator('.sess-item');
    await expect(found.filter({ hasText: '登录页按钮圆角' })).toHaveCount(1);
    // Those programs started are not people's conversations.
    await expect(found.filter({ hasText: 'MEM-705' })).toHaveCount(0);
    await shot(page, '59-conversations-on-mac');
    await page.getByLabel('搜索').fill('登录页');
    await expect(found).toHaveCount(1);
    await page.getByLabel('搜索').fill('没有这样的对话');
    await expect(page.getByText(/没有这样的对话/).last()).toBeVisible();
    await expect(found).toHaveCount(0);
    await page.getByLabel('搜索').fill('');
    await found.filter({ hasText: '登录页按钮圆角' }).click();
    await expect(page).toHaveURL(/\/claude\/3f2a1b4c-0000-4000-8000-000000000001$/);
  });

  test.describe("a session's name", () => {
    test('is offered as 改名 on a swipe to the left on a row, kept and found', async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'swiping is for touch screens');
      await login(page);
      await clearSessions(page);
      await newClaude(page);
      await page.getByRole('button', { name: '返回' }).click();
      const row = page.getByTestId('session-card').filter({ hasText: 'project-a' }).first();
      const action = page.getByRole('button', { name: '改名' });
      // Going by its directory's name, it does not show the directory twice.
      await expect(row.locator('.sess-dir')).toHaveCount(0);
      // A sideways wobble, or a drag more down than sideways, is scrolling, not a swipe.
      await swipeRow(page, row, -20);
      await expect(action).toBeHidden();
      await swipeRow(page, row, -60, 150);
      await expect(action).toBeHidden();
      await swipeRow(page, row, -120);
      await expect(action).toBeVisible();
      await shot(page, '27-swipe-rename');
      // A tap on the row while it is open closes it, rather than opening the session.
      await row.click();
      await expect(action).toBeHidden();
      await expect(page).toHaveURL(/\/$/);
      // Swiped open and back, it is closed.
      await swipeRow(page, row, -120);
      await expect(action).toBeVisible();
      await swipeRow(page, row, 120);
      await expect(action).toBeHidden();

      await swipeRow(page, row, -120);
      await action.click();
      const sheet = page.getByRole('dialog', { name: '改名' });
      const name = sheet.getByLabel('名字');
      await expect(name).toHaveValue('');
      await expect(name).toHaveAttribute('placeholder', 'project-a');
      await expect(sheet.getByRole('button', { name: '保存' })).toBeDisabled();
      await name.fill('部署修复');
      await sheet.getByRole('button', { name: '保存' }).click();
      await expect(sheet).toBeHidden();
      const renamed = page.getByTestId('session-card').filter({ hasText: '部署修复' });
      await expect(renamed.locator('.sess-name')).toHaveText('部署修复');
      // Which directory it is in still shows beside a name of its own.
      await expect(renamed.locator('.sess-dir')).toHaveText('project-a');
      await expect(action).toBeHidden();
      await page.getByLabel('搜索').fill('部署');
      await expect(page.getByTestId('session-card')).toHaveCount(1);
      await shot(page, '28-renamed-in-list');
      // Read back from the Mac rather than from what this page remembers.
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.getByTestId('session-card').filter({ hasText: '部署修复' })).toHaveCount(1);
      // A tap is never quite still; a finger that shifts a little still opens the session.
      const b = (await renamed.boundingBox())!;
      await page.mouse.move(b.x + 150, b.y + 30);
      await page.mouse.down();
      await page.mouse.move(b.x + 153, b.y + 32);
      await page.mouse.up();
      await expect(page).toHaveURL(/\/m\/local\/s\/[a-z0-9]+$/);
    });

    test('is changed from a tap on the title, and never to an empty one', async ({ page }) => {
      // Claude stays at its prompt: an ended session's title is not a button.
      const stays = join(E2E_HOME, 'claude-stays');
      writeFileSync(stays, '');
      try {
        await login(page);
        await newClaude(page);
        await page.getByRole('button', { name: /^改名/ }).click();
        const sheet = page.getByRole('dialog', { name: '改名' });
        await sheet.getByLabel('名字').fill('看日志');
        await shot(page, '30-rename-sheet');
        await sheet.getByLabel('名字').press('Enter');
        await expect(sheet).toBeHidden();
        const title = page.locator('.term-title');
        await expect(title.locator('strong')).toHaveText('看日志');
        await expect(title.locator('span').first()).toContainText('project-a');
        await page.getByRole('button', { name: /^改名/ }).click();
        await expect(sheet.getByLabel('名字')).toHaveValue('看日志');
        await sheet.getByLabel('名字').fill('   ');
        await expect(sheet.getByRole('button', { name: '保存' })).toBeDisabled();
        await sheet.getByLabel('名字').press('Enter');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.sheet-note')).not.toContainText('不填');
        await expect(title.locator('strong')).toHaveText('看日志');
      } finally {
        rmSync(stays, { force: true });
      }
    });

    test('is given to a Claude session as it is started', async ({ page }) => {
      await login(page);
      await page.getByRole('button', { name: '新建会话' }).click();
      await page.getByRole('button', { name: /在项目里新开 Claude/ }).click();
      await page.getByLabel('名字（可不填）').fill('周报');
      await page.getByRole('button', { name: /project-a/ }).click();
      await expect(page).toHaveURL(/\/m\/local\/s\/[a-z0-9]+$/);
      await expect(page.locator('.term-title strong')).toHaveText('周报');
    });
  });
});
