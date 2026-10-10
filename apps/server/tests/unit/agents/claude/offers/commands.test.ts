import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listCommands } from '../../../../../src/agents/claude/offers/commands';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ts-cmd-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const skill = (name: string, description: string, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# body\n`;

async function names(files: Record<string, string>) {
  const root = tree(files);
  const list = await listCommands({ claudeDir: join(root, 'claude'), cwd: join(root, 'project') });
  return { list, of: (source: string) => list.filter((c) => c.source === source).map((c) => c.name) };
}

describe('listCommands', () => {
  it('names the built-in commands even when nothing else is there', async () => {
    const { list, of } = await names({});
    expect(of('builtin')).toEqual(expect.arrayContaining(['clear', 'compact', 'model', 'resume']));
    expect(list.every((c) => c.description.length > 0)).toBe(true);
  });

  it('reads the skills of the user, by the name and description they give', async () => {
    const { list } = await names({
      'claude/skills/lesson/SKILL.md': skill('lesson', '把一条经验归档'),
      'claude/skills/dir-name/SKILL.md': skill('given-name', '"quoted: with a colon"'),
      'claude/skills/folded/SKILL.md': '---\nname: folded\ndescription: >\n  first line\n  second line\n---\n',
      'claude/skills/bare/SKILL.md': '# no front matter\n\nWhat it does.\n',
    });
    const user = Object.fromEntries(list.filter((c) => c.source === 'user').map((c) => [c.name, c.description]));
    expect(user).toEqual({
      lesson: '把一条经验归档',
      'given-name': 'quoted: with a colon',
      folded: 'first line second line',
      bare: 'What it does.',
    });
  });

  it('leaves out what cannot be typed: skills kept from the user, hidden folders, folders without a skill', async () => {
    const { of } = await names({
      'claude/skills/model-only/SKILL.md': skill('model-only', 'x', 'user-invocable: false\n'),
      'claude/skills/.trash/old/SKILL.md': skill('old', 'x'),
      'claude/skills/.hidden/SKILL.md': skill('hidden', 'x'),
      'claude/skills/empty/notes.md': 'nothing',
      'claude/skills/kept/SKILL.md': skill('kept', 'x'),
    });
    expect(of('user')).toEqual(['kept']);
  });

  it('reads commands of the user, a folder in front of the name', async () => {
    const { list } = await names({
      'claude/commands/deploy.md': '---\ndescription: Ship it\n---\nbody',
      'claude/commands/git/sync.md': 'Pull and push the branch\n',
      'claude/commands/team/git/tag.md': 'Tag a release\n',
    });
    expect(list.filter((c) => c.source === 'user').map((c) => [c.name, c.description])).toEqual([
      ['deploy', 'Ship it'],
      ['git:sync', 'Pull and push the branch'],
      ['team:git:tag', 'Tag a release'],
    ]);
  });

  it("reads the project's own skills and commands from where the session runs", async () => {
    const { of } = await names({
      'project/.claude/skills/pen-ui/SKILL.md': skill('pen-ui', 'x'),
      'project/.claude/commands/release.md': 'Cut a release\n',
      'elsewhere/.claude/commands/not-here.md': 'x\n',
    });
    expect(of('project')).toEqual(['pen-ui', 'release']);
  });

  it('reads the plugins turned on for this session, named after the plugin', async () => {
    const root = tree({
      'cache/sp/skills/brainstorming/SKILL.md': skill('brainstorming', 'Before creative work'),
      'cache/sp/commands/plan.md': 'Write a plan\n',
      'cache/off/skills/nope/SKILL.md': skill('nope', 'x'),
      'cache/mine/skills/here/SKILL.md': skill('here', 'x'),
      'cache/theirs/skills/there/SKILL.md': skill('there', 'x'),
    });
    const at = (p: string) => join(root, 'cache', p);
    const project = join(root, 'project');
    mkdirSync(join(project, '.claude'), { recursive: true });
    mkdirSync(join(root, 'claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(root, 'claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'superpowers@official': [{ scope: 'user', installPath: at('sp') }],
          'off@official': [{ scope: 'user', installPath: at('off') }],
          'mine@official': [{ scope: 'local', projectPath: project, installPath: at('mine') }],
          'theirs@official': [{ scope: 'local', projectPath: '/some/other/project', installPath: at('theirs') }],
        },
      }),
    );
    writeFileSync(
      join(root, 'claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@official': true, 'off@official': false, 'theirs@official': true } }),
    );
    writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'mine@official': true } }));
    const list = await listCommands({ claudeDir: join(root, 'claude'), cwd: project });
    expect(list.filter((c) => c.source === 'plugin').map((c) => [c.name, c.description])).toEqual([
      ['mine:here', 'x'],
      ['superpowers:brainstorming', 'Before creative work'],
      ['superpowers:plan', 'Write a plan'],
    ]);
  });

  it('gives each command its name, description and source, and nothing more', async () => {
    const { list } = await names({
      'claude/skills/s/SKILL.md': skill('s', 'x'),
      'claude/commands/c.md': 'x\n',
    });
    for (const c of list) expect(Object.keys(c).sort()).toEqual(['description', 'name', 'source']);
  });

  it('lists each name once, in name order', async () => {
    const { list } = await names({
      'claude/skills/compact/SKILL.md': skill('compact', 'a skill that shadows nothing'),
      'claude/skills/zeta/SKILL.md': skill('zeta', 'x'),
      'project/.claude/skills/zeta/SKILL.md': skill('zeta', 'the project one'),
    });
    const all = list.map((c) => c.name);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...all].sort());
    expect(list.find((c) => c.name === 'compact')!.source).toBe('builtin');
    expect(list.find((c) => c.name === 'zeta')!.description).toBe('the project one');
  });

  it('gets by when the files are broken or missing', async () => {
    const { list, of } = await names({
      'claude/settings.json': '{ not json',
      'claude/plugins/installed_plugins.json': '[]',
      'claude/skills/ok/SKILL.md': skill('ok', 'x'),
    });
    expect(of('user')).toEqual(['ok']);
    expect(list.length).toBeGreaterThan(5);
  });

  it('keeps a description to one short line', async () => {
    const { list } = await names({ 'claude/skills/long/SKILL.md': skill('long', 'word '.repeat(100)) });
    const d = list.find((c) => c.name === 'long')!.description;
    expect(d.length).toBeLessThanOrEqual(120);
    expect(d).not.toMatch(/\n/);
  });
});
