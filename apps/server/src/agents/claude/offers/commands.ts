import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initialized } from './initialize.js';

export type SlashCommand = { name: string; description: string; source: 'builtin' | 'project' | 'user' | 'plugin' };

// Claude Code's own commands live in its binary, not in files, so these are written down here, for when
// Claude Code cannot be asked for its list (initialize.ts).
const BUILTIN: [string, string][] = [
  ['agents', 'Manage subagents'],
  ['clear', 'Clear the conversation and start over'],
  ['compact', 'Compact the conversation to free up context'],
  ['config', 'Open settings'],
  ['context', 'Show how much context is used'],
  ['cost', 'Show what this session has cost'],
  ['doctor', 'Check the Claude Code installation'],
  ['export', 'Export the conversation'],
  ['help', 'Help'],
  ['hooks', 'Manage hooks'],
  ['init', 'Write a CLAUDE.md for the project'],
  ['mcp', 'Manage MCP servers'],
  ['memory', 'Edit memory files'],
  ['model', 'Switch the model'],
  ['permissions', 'Manage permissions'],
  ['plugin', 'Manage plugins'],
  ['resume', 'Resume an earlier conversation'],
  ['review', 'Review a pull request'],
  ['rewind', 'Go back to an earlier point'],
  ['status', 'Show version, account and connections'],
  ['todos', 'Show the todo list'],
  ['usage', 'Show how much of the plan is used'],
];

const DESCRIPTION_MAX = 120;

type Found = { name: string; description: string };

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function entries(dir: string) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

// The simple keys of a markdown file's front matter, and the text after it. A value of `>` or `|` runs
// on over the indented lines below it.
function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const more: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
      value = more.join(' ');
    }
    fields[kv[1]] = unquote(value);
  }
  return { fields, body: text.slice(m[0].length) };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= DESCRIPTION_MAX ? flat : `${flat.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

const firstLine = (body: string) => body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l) ?? '';

function describe(text: string, fallbackName: string): Found & { hidden: boolean } {
  const { fields, body } = frontMatter(text);
  const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  return {
    name: fields.name || fallbackName,
    description: oneLine(fields.description || lines[0] || firstLine(body)),
    hidden: fields['user-invocable'] === 'false',
  };
}

// <dir>/<folder>/SKILL.md, named by its front matter, else by its folder.
async function skillsIn(dir: string): Promise<Found[]> {
  const found: Found[] = [];
  for (const e of await entries(dir)) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const text = await readText(join(dir, e.name, 'SKILL.md'));
    if (text === null) continue;
    const s = describe(text, e.name);
    if (!s.hidden) found.push({ name: s.name, description: s.description });
  }
  return found;
}

// <dir>/**/<name>.md, a folder becoming `folder:` in front of the name.
async function commandsIn(dir: string, prefix = ''): Promise<Found[]> {
  const found: Found[] = [];
  for (const e of await entries(dir)) {
    const path = join(dir, e.name);
    if (e.isDirectory()) found.push(...(await commandsIn(path, `${prefix}${e.name}:`)));
    else if (e.name.endsWith('.md')) {
      const text = await readText(path);
      if (text !== null) found.push({ name: prefix + e.name.slice(0, -3), description: describe(text, '').description });
    }
  }
  return found;
}

const both = async (root: string) => [...(await skillsIn(join(root, 'skills'))), ...(await commandsIn(join(root, 'commands')))];

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// The plugins switched on for a session in `cwd`: the user's settings, then the project's, then its local ones.
async function enabledPlugins(claudeDir: string, cwd: string): Promise<Set<string>> {
  const on = new Map<string, boolean>();
  for (const path of [join(claudeDir, 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')]) {
    for (const [key, value] of Object.entries(record(record(await readJson(path)).enabledPlugins))) on.set(key, value === true);
  }
  return new Set([...on].filter(([, v]) => v).map(([k]) => k));
}

async function pluginCommands(claudeDir: string, cwd: string): Promise<Found[]> {
  const enabled = await enabledPlugins(claudeDir, cwd);
  const installed = record(record(await readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))).plugins);
  const found: Found[] = [];
  for (const [key, installs] of Object.entries(installed)) {
    if (!enabled.has(key) || !Array.isArray(installs)) continue;
    const install = installs.map(record).find((i) => i.scope === 'user' || i.projectPath === cwd);
    if (typeof install?.installPath !== 'string') continue;
    const plugin = key.split('@')[0];
    for (const c of await both(install.installPath)) found.push({ ...c, name: `${plugin}:${c.name}` });
  }
  return found;
}

// Commands Claude Code takes only in its terminal, which it leaves out of the list it gives a program.
const TERMINAL_ONLY: [string, string][] = [
  ['add-dir', 'Add a new working directory'],
  ['btw', 'Ask a quick side question without interrupting the main conversation'],
  ['export', 'Export the current conversation to a file or clipboard'],
  ['help', 'Show help and available commands'],
  ['hooks', 'Manage hooks'],
  ['memory', 'Edit CLAUDE.md files and memory settings'],
  ['permissions', 'Manage permissions'],
  ['plugin', 'Manage plugins'],
  ['resume', 'Resume a previous conversation'],
  ['rewind', 'Restore the code and/or conversation to a previous point'],
  ['status', 'Show Claude Code status including version, model, account, API connectivity, and tool statuses'],
  ['tasks', 'View and manage everything running in the background'],
];

type Told = { name?: unknown; description?: unknown; builtin?: unknown };

// Claude Code says where a command of the user's or the project's comes from after its description, and a
// plugin's before it.
function fromTold(c: Told): SlashCommand | null {
  // `__` marks one of its own, which its menu does not show.
  if (typeof c.name !== 'string' || !c.name || c.name.startsWith('__')) return null;
  const said = typeof c.description === 'string' ? c.description : '';
  const source: SlashCommand['source'] = c.builtin === true ? 'builtin' : c.name.includes(':') ? 'plugin' : /\(project\)\s*$/.test(said) ? 'project' : 'user';
  const unsourced = said.replace(/\s*\((user|project)\)\s*$/, '');
  const description = source === 'plugin' ? unsourced.replace(/^\([^)]*\)\s*/, '') : unsourced;
  return { name: c.name, description: oneLine(description), source };
}

const byNameOrder = (a: SlashCommand, b: SlashCommand) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// What can follow a `/` in a Claude session started in `cwd`: Claude Code's own list when `claudeBin` can be
// asked for it, else read from the same files Claude Code reads.
export async function listCommands(o: { claudeDir: string; cwd: string; claudeBin?: string }): Promise<SlashCommand[]> {
  if (o.claudeBin && o.cwd) {
    const told = await initialized(o.claudeBin, o.cwd).catch(() => null);
    const list = Array.isArray(told?.commands) ? (told.commands as Told[]) : null;
    if (list) {
      const byName = new Map<string, SlashCommand>();
      for (const c of list.map(fromTold)) if (c && !byName.has(c.name)) byName.set(c.name, c);
      for (const [name, description] of TERMINAL_ONLY) if (!byName.has(name)) byName.set(name, { name, description, source: 'builtin' });
      return [...byName.values()].sort(byNameOrder);
    }
  }
  return filesListed(o);
}

// Read from the same files Claude Code reads. Where two share a name, the earlier source wins: built-in,
// then the project, the user, a plugin.
async function filesListed(o: { claudeDir: string; cwd: string }): Promise<SlashCommand[]> {
  const [project, user, plugin] = await Promise.all([
    o.cwd ? both(join(o.cwd, '.claude')) : [],
    both(o.claudeDir),
    pluginCommands(o.claudeDir, o.cwd),
  ]);
  const byName = new Map<string, SlashCommand>();
  const add = (source: SlashCommand['source'], list: Found[]) => {
    for (const c of list) if (c.name && !byName.has(c.name)) byName.set(c.name, { ...c, source });
  };
  add('builtin', BUILTIN.map(([name, description]) => ({ name, description })));
  add('project', project);
  add('user', user);
  add('plugin', plugin);
  return [...byName.values()].sort(byNameOrder);
}
