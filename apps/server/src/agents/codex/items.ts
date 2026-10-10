import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, Diff, Hunk } from '../claude/transcript/chat.js';
import type { Usage } from '../claude/usage.js';
import type { Answer, Ask } from '../types.js';

// Codex's app-server protocol (`codex app-server generate-ts`) as far as it is read here. Every field is
// read as possibly missing: the protocol is marked experimental.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SUMMARY_MAX = 200;
const RESULT_MAX = 2000;
const DIFF_LINES_MAX = 300;
const DIFF_LINE_MAX = 400;
const DETAIL_MAX = 4000;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const line1 = (s: string) => clip(s.split('\n')[0], SUMMARY_MAX);

export type Entry = { id: string; item: ChatItem; clientId?: string };

// What the user typed, as the chat shows it; a picture sent along is named by its path in the text already.
const userText = (content: unknown) =>
  arr(content)
    .map((c) => (obj(c)?.type === 'text' ? str(obj(c)?.text) : ''))
    .filter(Boolean)
    .join('\n');

// The command as Codex parsed it rather than the shell line that wraps it (`/bin/zsh -c '…'`).
const commandOf = (i: Obj) => str(obj(arr(i.commandActions)[0])?.command) || str(i.command);

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
  const i = obj(item);
  const id = str(i?.id);
  if (!i || !id) return [];
  const stamp = at ? { at } : {};
  switch (i.type) {
    case 'userMessage': {
      const text = userText(i.content);
      const clientId = str(i.clientId);
      return text ? [{ id, item: { k: 'user', text, ...stamp }, ...(clientId && { clientId }) }] : [];
    }
    case 'agentMessage':
      return str(i.text) ? [{ id, item: { k: 'text', text: str(i.text), ...stamp } }] : [];
    case 'plan':
      return str(i.text) ? [{ id, item: { k: 'text', text: str(i.text), ...stamp } }] : [];
    case 'commandExecution': {
      const status = str(i.status);
      const exit = num(i.exitCode);
      return [
        { id, item: { k: 'tool', id, name: 'Bash', summary: line1(commandOf(i)), ...stamp } },
        { id: `${id}#r`, item: { k: 'result', id, text: clip(str(i.aggregatedOutput), RESULT_MAX), ...failedOrStopped(status), ...(exit !== undefined && exit !== 0 && { error: true }) } },
      ];
    }
    case 'fileChange': {
      const status = str(i.status);
      return arr(i.changes).flatMap((c, n): Entry[] => {
        const change = obj(c);
        const path = str(change?.path);
        if (!path) return [];
        const kind = str(obj(change?.kind)?.type);
        const cid = `${id}:${n}`;
        return [
          { id: cid, item: { k: 'tool', id: cid, name: kind === 'add' ? 'Write' : 'Edit', summary: line1(path), ...stamp } },
          { id: `${cid}#r`, item: { k: 'result', id: cid, text: '', ...failedOrStopped(status), diff: unifiedDiff(path, kind, str(change?.diff)) } },
        ];
      });
    }
    case 'mcpToolCall':
    case 'dynamicToolCall': {
      const name = [str(i.server) || str(i.namespace), str(i.tool)].filter(Boolean).join('.');
      const args = obj(i.arguments) ?? {};
      const summary = line1(Object.values(args).map(str).find(Boolean) ?? '');
      const error = str(obj(i.error)?.message);
      const text = error || arr(obj(i.result)?.content ?? i.contentItems).map((c) => str(obj(c)?.text)).filter(Boolean).join('\n');
      return [
        { id, item: { k: 'tool', id, name: name || 'tool', summary, ...stamp } },
        { id: `${id}#r`, item: { k: 'result', id, text: clip(text, RESULT_MAX), error: !!error || str(i.status) === 'failed' || i.success === false } },
      ];
    }
    case 'webSearch':
      return [{ id, item: { k: 'tool', id, name: 'WebSearch', summary: line1(str(i.query)), ...stamp } }];
    case 'imageView':
      return [{ id, item: { k: 'tool', id, name: 'Read', summary: line1(str(i.path)), ...stamp } }];
    case 'contextCompaction':
      return [{ id, item: { k: 'note', event: { e: 'compacted' } } }];
    default:
      return [];
  }
}

// A turn that did not end by itself, as the line the chat puts after it.
export function turnNote(turn: unknown): Entry | null {
  const t = obj(turn);
  const id = str(t?.id);
  if (!t || !id) return null;
  if (t.status === 'interrupted') return { id: `${id}#end`, item: { k: 'note', event: { e: 'interrupted' } } };
  if (t.status === 'failed') {
    const detail = str(obj(t.error)?.message);
    return { id: `${id}#end`, item: { k: 'note', event: { e: 'failed' }, ...(detail && { detail }) } };
  }
  return null;
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

// An approval Codex asks for, as the phone's permission card. fileItem: the file change it is for, as it
// started, which names the files the request itself does not.
export function askOf(askId: string, method: string, params: Obj, fileItem?: Obj): Ask {
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
  const changes = arr(fileItem?.changes).map(obj);
  const paths = changes.map((c) => str(c?.path)).filter(Boolean);
  const diffs = changes.map((c) => str(c?.diff)).filter(Boolean).join('\n');
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
