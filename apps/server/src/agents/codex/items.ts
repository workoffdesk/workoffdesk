import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, Diff, Hunk } from '../claude/transcript/chat.js';
import type { Usage } from '../claude/usage.js';
import { unhandled } from '../events.js';
import type { Answer, Ask } from '../types.js';
import { commandOf, itemEventOf, turnEventOf, type CodexThreadEvent, type FileChange } from './events.js';

// Codex's app-server protocol (`codex app-server generate-ts`) as far as it is read here. Every field is
// read as possibly missing: the protocol is marked experimental.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SUMMARY_MAX = 200;
const RESULT_MAX = 2000;
const INPUT_MAX = 4000;
const DIFF_LINES_MAX = 300;
const DIFF_LINE_MAX = 400;
const DETAIL_MAX = 4000;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const line1 = (s: string) => clip(s.split('\n')[0], SUMMARY_MAX);

export type Entry = { id: string; item: ChatItem; clientId?: string };

function unifiedDiff(file: string, kind: string, text: string): Diff {
  const lines = text.replace(/\n$/, '').split('\n');
  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  let kept = 0;
  let cut = false as boolean;
  const push = (h: Hunk, l: string) => {
    if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
    if (kept >= DIFF_LINES_MAX) return void (cut = true);
    h.lines.push(clip(l, DIFF_LINE_MAX));
    kept++;
  };
  if (!lines.some((l) => l.startsWith('@@'))) {
    // A file made or removed whole comes as its content.
    const sign = kind === 'delete' ? '-' : '+';
    const h: Hunk = { oldStart: kind === 'delete' ? 1 : 0, newStart: kind === 'delete' ? 0 : 1, lines: [] };
    for (const l of text ? lines : []) push(h, sign + l);
    if (h.lines.length) hunks.push(h);
  } else {
    let h: Hunk | null = null;
    for (const l of lines) {
      const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      if (at) {
        h = { oldStart: Number(at[1]), newStart: Number(at[2]), lines: [] };
        hunks.push(h);
      } else if (h && /^[ +-]/.test(l)) push(h, l);
    }
  }
  return { file, added, removed, ...(kind === 'add' && { created: true as const }), ...(cut ? { cut: true as const } : {}), hunks };
}

const failedOrStopped = (status: string) => ({ error: status === 'failed', ...(status === 'declined' && { stopped: true as const }) });

// What one completed item adds to the chat; nothing for what the chat does not show (reasoning).
export function entriesOf(item: unknown, at?: string): Entry[] {
  return entriesOfEvent(itemEventOf(item, at));
}

// A turn that did not end by itself, as the line the chat puts after it.
export function turnNote(turn: unknown): Entry | null {
  return entriesOfEvent(turnEventOf(turn))[0] ?? null;
}

export function entriesOfEvent(e: CodexThreadEvent): Entry[] {
  const stamp = e.at ? { at: e.at } : {};
  switch (e.k) {
    case 'codex:userMessage':
      return e.text ? [{ id: e.id, item: { k: 'user', text: e.text, ...stamp }, ...(e.clientId && { clientId: e.clientId }) }] : [];
    case 'codex:agentMessage':
    case 'codex:plan':
      return e.text ? [{ id: e.id, item: { k: 'text', text: e.text, ...stamp } }] : [];
    case 'codex:commandExecution': {
      const { id, command } = e;
      const summary = line1(command);
      return [
        { id, item: { k: 'tool', id, name: 'Bash', summary, ...(summary !== command && { input: clip(command, INPUT_MAX) }), ...stamp } },
        { id: `${id}#r`, item: { k: 'result', id, text: clip(e.output, RESULT_MAX), ...failedOrStopped(e.status), ...(e.exitCode !== undefined && e.exitCode !== 0 && { error: true }) } },
      ];
    }
    case 'codex:fileChange':
      return e.changes.flatMap((c, n): Entry[] => {
        if (!c.path) return [];
        const cid = `${e.id}:${n}`;
        return [
          { id: cid, item: { k: 'tool', id: cid, name: c.kind === 'add' ? 'Write' : 'Edit', summary: line1(c.path), ...stamp } },
          { id: `${cid}#r`, item: { k: 'result', id: cid, text: '', ...failedOrStopped(e.status), diff: unifiedDiff(c.path, c.kind, c.diff) } },
        ];
      });
    case 'codex:toolCall': {
      const { id } = e;
      const summary = line1(Object.values(e.args).map(str).find(Boolean) ?? '');
      return [
        { id, item: { k: 'tool', id, name: e.name || 'tool', summary, ...stamp } },
        { id: `${id}#r`, item: { k: 'result', id, text: clip(e.text, RESULT_MAX), error: e.failed } },
      ];
    }
    case 'codex:webSearch':
      return [{ id: e.id, item: { k: 'tool', id: e.id, name: 'WebSearch', summary: line1(e.query), ...stamp } }];
    case 'codex:imageView':
      return [{ id: e.id, item: { k: 'tool', id: e.id, name: 'Read', summary: line1(e.path), ...stamp } }];
    case 'codex:compaction':
      return [{ id: e.id, item: { k: 'note', event: { e: 'compacted' } } }];
    case 'codex:turnEnded':
      if (e.how === 'interrupted') return [{ id: `${e.id}#end`, item: { k: 'note', event: { e: 'interrupted' } } }];
      if (e.how === 'failed') return [{ id: `${e.id}#end`, item: { k: 'note', event: { e: 'failed' }, ...(e.error && { detail: e.error }) } }];
      return [];
    case 'codex:other':
      return [];
    default:
      return unhandled(e);
  }
}

export const COMMAND_APPROVAL = 'item/commandExecution/requestApproval';
export const FILE_APPROVAL = 'item/fileChange/requestApproval';
export const isApproval = (method: string) => method === COMMAND_APPROVAL || method === FILE_APPROVAL;

// The decision that allows from now on what the request offers to, if it offers that.
function amendmentOf(params: Obj): { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } } | null {
  for (const d of arr(params.availableDecisions)) {
    const a = obj(obj(d)?.acceptWithExecpolicyAmendment);
    const prefix = arr(a?.execpolicy_amendment).map(str);
    if (prefix.length && prefix.every(Boolean)) return { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } };
  }
  return null;
}

const offered = (params: Obj, decision: string) => {
  const all = arr(params.availableDecisions);
  return !all.length || all.includes(decision);
};

// An approval Codex asks for, as the phone's permission card. files: the file change it is for, as it started,
// which names the files the request itself does not.
export function askOf(askId: string, method: string, params: Obj, files?: FileChange[]): Ask {
  const reason = str(params.reason);
  if (method === COMMAND_APPROVAL) {
    const command = commandOf(params);
    const amendment = amendmentOf(params);
    const detail = [command, reason, str(params.cwd)].filter(Boolean).join('\n\n');
    return {
      id: askId,
      kind: 'permission',
      tool: 'Bash',
      title: line1(command || reason),
      detail: clip(detail, DETAIL_MAX),
      always: amendment ? { rules: [amendment.acceptWithExecpolicyAmendment.execpolicy_amendment.join(' ')], dirs: [], mode: null } : null,
    };
  }
  const changes = files ?? [];
  const paths = changes.map((c) => c.path).filter(Boolean);
  const diffs = changes.map((c) => c.diff).filter(Boolean).join('\n');
  return {
    id: askId,
    kind: 'permission',
    tool: 'Edit',
    title: line1(paths.join(', ') || str(params.grantRoot) || reason),
    detail: clip([reason, diffs].filter(Boolean).join('\n\n'), DETAIL_MAX),
    always: offered(params, 'acceptForSession') ? { rules: [], dirs: [], mode: 'acceptEdits' } : null,
  };
}

// The reply to an approval. No is the Mac's No: the turn stops.
export function decisionOf(method: string, params: Obj, answer: Answer): { decision: unknown } {
  if (!answer.allow) return { decision: offered(params, 'cancel') ? 'cancel' : 'decline' };
  if (!answer.always) return { decision: 'accept' };
  if (method === COMMAND_APPROVAL) return { decision: amendmentOf(params) ?? 'acceptForSession' };
  return { decision: 'acceptForSession' };
}

// What the usage pill shows, from the thread's last token count and the plan's limits.
export function usageOf(o: { tokenUsage?: unknown; rateLimits?: unknown; model?: string; effort?: string }): Usage | null {
  const u: Usage = {};
  if (o.model) u.model = o.model.slice(0, 80);
  if (o.effort) u.effort = o.effort.slice(0, 80);
  const tokens = obj(o.tokenUsage);
  const window = num(tokens?.modelContextWindow);
  const last = num(obj(tokens?.last)?.totalTokens);
  if (window && last !== undefined) u.context = Math.min(100, Math.round((last / window) * 100));
  const limits = obj(o.rateLimits);
  const limit = (w: unknown) => {
    const used = num(obj(w)?.usedPercent);
    const resetsAt = num(obj(w)?.resetsAt);
    return used === undefined ? undefined : { used: Math.min(100, Math.max(0, used)), ...(resetsAt !== undefined && { resetsAt }) };
  };
  const fiveHour = limit(limits?.primary);
  const sevenDay = limit(limits?.secondary);
  if (fiveHour) u.fiveHour = fiveHour;
  if (sevenDay) u.sevenDay = sevenDay;
  return Object.keys(u).length ? u : null;
}

// A picture sent from the phone travels as its path in the text (libs/client/src/chat/images.ts); Codex is also
// given it as an image.
const UPLOADED_PICTURE = /~?\/[^\s"]*\/uploads\/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.(?:png|jpg|jpeg|gif|webp)/g;

export function inputOf(text: string): Obj[] {
  const pictures = [...new Set(text.match(UPLOADED_PICTURE) ?? [])].map((p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p));
  return [{ type: 'text', text, text_elements: [] }, ...pictures.map((path) => ({ type: 'localImage', path }))];
}
