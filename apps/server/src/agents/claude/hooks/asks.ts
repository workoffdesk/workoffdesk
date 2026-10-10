import { randomUUID } from 'node:crypto';
import type { Always, Answer, Ask } from '../../types.js';
import { toolSummary } from '../transcript/chat.js';

// Tools whose dialog says more than yes or no (Claude's questions, its plan): left to the screen.
const ON_SCREEN = new Set(['AskUserQuestion', 'ExitPlanMode']);
const DETAIL_MAX = 4000;
// A prompt is let go a little before its hook would be stopped (PERMISSION_HOLD_S in hooks.ts), so the
// hook ends with no word rather than being killed, which reads as the Mac's No.
export const HOLD_MS = 3500_000;
const DECLINED = 'The user declined this from their phone.';

// What a PermissionRequest hook posts; only these fields are read, and each may be of any type.
export type PermissionPayload = { tool_name?: unknown; tool_input?: unknown; permission_suggestions?: unknown };

// Whether the prompt's dialog is one the phone leaves to the Mac's screen.
export const leftToScreen = (payload: PermissionPayload) => typeof payload.tool_name === 'string' && ON_SCREEN.has(payload.tool_name);

// What a prompt asks of the person: Claude's question, its plan, or the tool and what it would do with it.
export function askedOf(payload: PermissionPayload): string {
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const input = isRecord(payload.tool_input) ? payload.tool_input : {};
  if (tool === 'AskUserQuestion') {
    const first: unknown = Array.isArray(input.questions) ? input.questions[0] : null;
    return isRecord(first) ? str(first.question) : '';
  }
  if (tool === 'ExitPlanMode') return str(input.plan);
  return tool && `${tool} ${toolSummary(tool, input)}`.trim();
}

// The hook's side of a prompt: its answer (null: none, the dialog is left to the Mac), and word of it
// ending without one (Claude Code stopped it: No or Esc at the Mac).
export type HeldHook = { reply(output: object | null): void; onGone(cb: () => void): void };

type Held = { ask: Ask; call: string; suggestions: Record<string, unknown>[]; hook: HeldHook; timer: NodeJS.Timeout };

// The permission prompts Claude Code's PermissionRequest hooks hold open for the phone, per session. The
// dialog stays on the Mac's screen all the while: whichever answers first is the answer, and a prompt is
// over when the phone answers it, the Mac does, or the turn moves on without it.
export class PermissionAsks {
  private readonly held = new Map<string, Held[]>();

  // changed: a session's asks came or went.
  constructor(private readonly changed: (termId: string) => void = () => {}) {}

  // The ask the phone is shown for a prompt, or null when it is one left to the screen (and the hook has
  // been answered with nothing).
  hold(termId: string, payload: PermissionPayload, hook: HeldHook): Ask | null {
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    const input = isRecord(payload.tool_input) ? payload.tool_input : null;
    if (!tool || !input || ON_SCREEN.has(tool)) {
      hook.reply(null);
      return null;
    }
    const suggestions = Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions.filter(isRecord) : [];
    const ask: Ask = { id: randomUUID(), kind: 'permission', tool, title: toolSummary(tool, input), detail: detailOf(tool, input), always: alwaysOf(suggestions) };
    const timer = setTimeout(() => this.take(termId, (h) => h.ask.id === ask.id)?.hook.reply(null), HOLD_MS).unref();
    const list = this.held.get(termId) ?? [];
    list.push({ ask, call: callKey(tool, input), suggestions, hook, timer });
    this.held.set(termId, list);
    this.changed(termId);
    return ask;
  }

  list(termId: string): Ask[] {
    return (this.held.get(termId) ?? []).map((h) => h.ask);
  }

  // False when the ask is over. "From now on" takes every suggestion Claude Code made, as its own dialog's
  // option does.
  answer(termId: string, askId: string, answer: Answer): boolean {
    const now = this.take(termId, (h) => h.ask.id === askId);
    if (!now) return false;
    const keep = answer.allow && answer.always && now.suggestions.length ? { updatedPermissions: now.suggestions } : {};
    now.hook.reply(decision(answer.allow ? { behavior: 'allow', ...keep } : { behavior: 'deny', message: DECLINED, interrupt: true }));
    return true;
  }

  // The hook ended without an answer from here: Claude Code stopped it. True when it was still held.
  gone(termId: string, askId: string): boolean {
    return !!this.take(termId, (h) => h.ask.id === askId);
  }

  // The tool of a prompt ran (or failed): it was allowed at the Mac, and its hook waits on nothing.
  toolDone(termId: string, tool: unknown, input: unknown): void {
    if (typeof tool !== 'string' || !isRecord(input)) return;
    const call = callKey(tool, input);
    this.take(termId, (h) => h.call === call)?.hook.reply(null);
  }

  // The turn is over or the session gone: nothing it held is asked any more.
  endAll(termId: string): void {
    for (const h of this.held.get(termId) ?? []) {
      clearTimeout(h.timer);
      h.hook.reply(null);
    }
    if (this.held.delete(termId)) this.changed(termId);
  }

  private take(termId: string, which: (h: Held) => boolean): Held | undefined {
    const list = this.held.get(termId) ?? [];
    const i = list.findIndex(which);
    if (i < 0) return undefined;
    const [h] = list.splice(i, 1);
    if (!list.length) this.held.delete(termId);
    clearTimeout(h.timer);
    this.changed(termId);
    return h;
  }
}

const decision = (d: object) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX)}…` : s);
const marked = (mark: string, s: string) => s.split('\n').map((l) => `${mark} ${l}`).join('\n');

// The whole of what the tool is asked to do, as far as the card has room for it.
function detailOf(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash') return clip(str(input.command));
  if (tool === 'Write') return clip(str(input.content));
  if (tool === 'Edit') return clip(`${marked('-', str(input.old_string))}\n${marked('+', str(input.new_string))}`);
  return clip(JSON.stringify(input, null, 2));
}

// What Claude Code's suggestions would allow from now on; null when it made none the phone can name.
function alwaysOf(suggestions: Record<string, unknown>[]): Always | null {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const always: Always = { rules: [], dirs: [], mode: null };
  for (const s of suggestions) {
    if (s.type === 'addRules' && s.behavior === 'allow') {
      for (const r of list(s.rules).filter(isRecord)) always.rules.push(str(r.ruleContent) ? `${str(r.toolName)}(${str(r.ruleContent)})` : str(r.toolName));
    } else if (s.type === 'addDirectories') always.dirs.push(...list(s.directories).map(str).filter(Boolean));
    else if (s.type === 'setMode' && str(s.mode)) always.mode = str(s.mode);
    else return null;
  }
  return always.rules.length || always.dirs.length || always.mode ? always : null;
}

// A tool call as the same text however its input's keys are ordered, to know a PostToolUse for it.
function callKey(tool: string, input: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  return JSON.stringify([tool, sorted(input)]);
}
