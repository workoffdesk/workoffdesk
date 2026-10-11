import { stripVTControlCharacters } from 'node:util';

// What each record of a Claude Code transcript is, decided here and nowhere else. The format is Claude Code's
// own and undocumented: every field is optional, and a record not understood is `other`, never thrown on.
// Readers switch over `k` (see ../../events.ts); a kind added here makes the compiler name every reader that
// has not handled it.

export type ToolResult = { id: string; text: string; error: boolean; image: boolean };
export type ReplyBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type QueueOp = 'enqueue' | 'dequeue' | 'remove' | 'popAll';

export type ClaudeEvent = { at?: string } & (
  // The person's words. text: as shown, a picture as [image]; words: only what was typed.
  | { k: 'claude:prompt'; text: string; words: string }
  // A command typed at the prompt. local: one Claude Code ran on its own and wrote as its own record.
  | { k: 'claude:command'; name: string; args: string; local: boolean }
  | { k: 'claude:commandOutput'; text: string; local: boolean }
  // `!` at the prompt, and what it printed.
  | { k: 'claude:shell'; command: string }
  | { k: 'claude:shellOutput'; text: string }
  // Answers to Claude's calls; detail: what Claude Code adds of the call's own (a file's change, a task made).
  | { k: 'claude:results'; results: ToolResult[]; detail: unknown }
  | { k: 'claude:interrupted' }
  // The summary a compacted conversation goes on from, and the line where it was compacted.
  | { k: 'claude:compacted' }
  | { k: 'claude:compactBoundary'; manual: boolean }
  // Words written as the person's and no one's: a note Claude Code adds for Claude.
  | { k: 'claude:noted' }
  | { k: 'claude:peer'; from: string; body: string }
  | { k: 'claude:teammates'; messages: { from: string; body: string }[] }
  | { k: 'claude:taskNotification'; text: string }
  // A prompt from neither the person nor anyone named above.
  | { k: 'claude:fromOther'; text: string }
  | { k: 'claude:reply'; blocks: ReplyBlock[] }
  | { k: 'claude:apiError'; limit: boolean; text: string }
  | { k: 'claude:turnOver' }
  | { k: 'claude:queue'; op: QueueOp; text?: string }
  // Taken into the turn under way from Claude's queue: a message, or how a background command ended.
  | { k: 'claude:midTurnPrompt'; text: string }
  | { k: 'claude:midTurnTaskEnd'; text: string }
  | { k: 'claude:title'; by: 'person' | 'claude'; text: string }
  | { k: 'claude:lastPrompt'; text: string }
  // A subagent's own record.
  | { k: 'claude:sidechain' }
  | { k: 'claude:other' }
);

// A transcript line once it is known to be an object. Every field may be missing or of any type.
export type TranscriptRecord = { [field: string]: unknown; message?: { content?: unknown } };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const object = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

// As text, without the colours and links a terminal would have drawn from it.
export function blocksText(content: unknown): string {
  if (typeof content === 'string') return stripVTControlCharacters(content);
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b?.type === 'text' ? stripVTControlCharacters(str(b.text)) : b?.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join(' ');
}

// Only what was typed: the text blocks, without pictures.
const typedText = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap((b) => (b?.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join(' ') : '';

// Text as it was pasted at the prompt, which Claude Code records wrapped in a tag naming the paste.
const unpasted = (text: string) => text.replace(/<pasted_content id="([^"]*)">\n*([\s\S]*?)\n*<\/pasted_content id="\1">/g, '$2');

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export const tagText = (text: string, tag: string) =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]).trim() ?? '';

const INTERRUPTED = '[Request interrupted';
const COMMAND = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_OUTPUT = /^<local-command-std(?:out|err)>([\s\S]*?)(?:<\/local-command-std(?:out|err)>)?$/;

function commandOf(text: string, local: boolean): ClaudeEvent | null {
  const command = COMMAND.exec(text);
  if (command) return { k: 'claude:command', name: command[1].trim(), args: tagText(text, 'command-args'), local };
  const output = COMMAND_OUTPUT.exec(text);
  return output ? { k: 'claude:commandOutput', text: output[1], local } : null;
}

// Teammates' messages, which older Claude Code records with no sender: it wraps them in this envelope instead.
const TEAMMATES = 'Another Claude session sent a message:\n<teammate-message ';
const teammates = (text: string) =>
  [...text.matchAll(/<teammate-message\s[^>]*?teammate_id="([^"]*)"[^>]*>([\s\S]*?)<\/teammate-message>/g)].map(([, from, body]) => ({ from, body: body.trim() }));

// What the person's own record says, once it is known to be theirs.
function personSaid(r: TranscriptRecord): ClaudeEvent {
  const content = r.message?.content;
  if (r.isCompactSummary) return { k: 'claude:compacted' };
  if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
    const results = content
      .filter((b) => b?.type === 'tool_result' && typeof b.tool_use_id === 'string')
      .map((b) => ({
        id: b.tool_use_id as string,
        text: blocksText(b.content),
        error: b.is_error === true,
        image: Array.isArray(b.content) && b.content.some((c: { type?: unknown } | null) => c?.type === 'image'),
      }));
    return { k: 'claude:results', results, detail: r.toolUseResult };
  }
  const text = unpasted(blocksText(content)).trim();
  if (text.startsWith(INTERRUPTED)) return { k: 'claude:interrupted' };
  const command = commandOf(text, false);
  if (command) return command;
  if (text.startsWith('<bash-input>')) return { k: 'claude:shell', command: tagText(text, 'bash-input') };
  if (text.startsWith('<bash-stdout>')) return { k: 'claude:shellOutput', text: [tagText(text, 'bash-stdout'), tagText(text, 'bash-stderr')].filter(Boolean).join('\n') };
  return { k: 'claude:prompt', text, words: unpasted(typedText(content)) };
}

// A user record: the person's, or one Claude Code records who sent. Older versions record nobody, and then it
// is the person's, unless it is teammates' messages in their envelope.
function userEvent(r: TranscriptRecord): ClaudeEvent {
  const origin = object(r.origin);
  if (!origin) {
    const text = blocksText(r.message?.content).trim();
    if (text.startsWith(TEAMMATES)) return { k: 'claude:teammates', messages: teammates(text) };
    return r.isMeta ? { k: 'claude:noted' } : personSaid(r);
  }
  if (origin.kind === 'peer') return { k: 'claude:peer', from: str(origin.name), body: str(origin.body) };
  if (r.isMeta) return { k: 'claude:noted' };
  if (origin.kind === 'human') return personSaid(r);
  const text = blocksText(r.message?.content).trim();
  return origin.kind === 'task-notification' ? { k: 'claude:taskNotification', text } : { k: 'claude:fromOther', text };
}

function replyEvent(r: TranscriptRecord): ClaudeEvent {
  const content = r.message?.content;
  if (r.isApiErrorMessage) return { k: 'claude:apiError', limit: r.error === 'rate_limit', text: blocksText(content) };
  const blocks: ReplyBlock[] = (Array.isArray(content) ? content : []).flatMap((b): ReplyBlock[] => {
    if (b?.type === 'text' && typeof b.text === 'string') return [{ type: 'text', text: b.text }];
    if (b?.type === 'tool_use' && typeof b.id === 'string') return [{ type: 'tool_use', id: b.id, name: str(b.name), input: object(b.input) ?? {} }];
    return [];
  });
  return { k: 'claude:reply', blocks };
}

function systemEvent(r: TranscriptRecord): ClaudeEvent {
  if (r.subtype === 'stop_hook_summary') return { k: 'claude:turnOver' };
  if (r.subtype === 'compact_boundary') return { k: 'claude:compactBoundary', manual: object(r.compactMetadata)?.trigger === 'manual' };
  if (r.subtype === 'local_command') return commandOf(str(r.content).trim(), true) ?? { k: 'claude:other' };
  return { k: 'claude:other' };
}

// A message the person sent while Claude worked, which Claude took in the middle of its turn.
function midTurnEvent(r: TranscriptRecord): ClaudeEvent {
  const a = object(r.attachment);
  if (a?.type !== 'queued_command' || a.isMeta) return { k: 'claude:other' };
  const origin = object(a.origin);
  if (origin?.kind === 'task-notification' || a.commandMode === 'task-notification') return { k: 'claude:midTurnTaskEnd', text: blocksText(a.prompt) };
  if ((a.commandMode ?? 'prompt') !== 'prompt' || (origin && origin.kind !== 'human')) return { k: 'claude:other' };
  return { k: 'claude:midTurnPrompt', text: unpasted(blocksText(a.prompt)).trim() };
}

const QUEUE_OPS: readonly QueueOp[] = ['enqueue', 'dequeue', 'remove', 'popAll'];

function kindOf(r: TranscriptRecord): ClaudeEvent {
  if (r.isSidechain) return { k: 'claude:sidechain' };
  switch (r.type) {
    case 'user':
      return object(r.message) ? userEvent(r) : { k: 'claude:other' };
    case 'assistant':
      return object(r.message) ? replyEvent(r) : { k: 'claude:other' };
    case 'system':
      return systemEvent(r);
    case 'attachment':
      return midTurnEvent(r);
    case 'queue-operation': {
      const op = QUEUE_OPS.find((o) => o === r.operation);
      if (!op) return { k: 'claude:other' };
      return typeof r.content === 'string' ? { k: 'claude:queue', op, text: r.content } : { k: 'claude:queue', op };
    }
    case 'custom-title':
      return { k: 'claude:title', by: 'person', text: str(r.customTitle) };
    case 'ai-title':
      return { k: 'claude:title', by: 'claude', text: str(r.aiTitle) };
    case 'last-prompt':
      return { k: 'claude:lastPrompt', text: str(r.lastPrompt) };
    default:
      return { k: 'claude:other' };
  }
}

export function eventOf(v: unknown): ClaudeEvent {
  const r = object(v) as TranscriptRecord | null;
  if (!r) return { k: 'claude:other' };
  const event = kindOf(r);
  return typeof r.timestamp === 'string' ? { ...event, at: r.timestamp } : event;
}

// What a record says beside its kind: the folder it was written in, and whether a program rather than a person
// ran the conversation.
export function envelopeOf(v: unknown): { cwd: string | null; automated: boolean } {
  const r = object(v);
  return { cwd: typeof r?.cwd === 'string' && r.cwd ? r.cwd : null, automated: r?.entrypoint === 'sdk-cli' };
}
