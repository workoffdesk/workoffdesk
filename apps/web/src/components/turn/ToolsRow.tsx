import type { MouseEvent } from 'react';
import { filePath, type Changed, type Diff, type ToolTurn } from '@workoffdesk/client/model/chat';
import { clock, duration } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { type Opener } from './media';
import { TurnView } from '../TurnView';

const FILE_TOOLS = new Set([
  'Read',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
]);

export function ToolSummary({ name, summary }: { name: string; summary: string }) {
  const file = FILE_TOOLS.has(name) ? filePath(summary) : null;
  if (!file) return <span className="tool-summary">{summary}</span>;
  return (
    <span className="tool-summary">
      <span className="tool-file">{file.name}</span> {file.dir}
    </span>
  );
}

export function DiffCount({ d }: { d: { added: number; removed: number } }) {
  return (
    <span className="diff-count">
      {d.added > 0 && <ins>+{d.added}</ins>}
      {d.removed > 0 && <del>−{d.removed}</del>}
    </span>
  );
}

// What a file tool changed, a block per place in the file, each line marked kept, gone or come.
export function DiffView({ d }: { d: Diff }) {
  return (
    <div className="diff" role="group" aria-label={t.changes}>
      {d.created && <div className="diff-head">{t.newFile}</div>}
      {d.hunks.map((h, i) => (
        <div key={i} className="diff-hunk">
          {!d.created && <div className="diff-head">{t.atLine(h.newStart)}</div>}
          {h.lines.map((l, j) => (
            <div key={j} className={`diff-line ${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : ''}`}>
              {l || ' '}
            </div>
          ))}
        </div>
      ))}
      {d.cut && <div className="diff-head">{t.diffCut}</div>}
    </div>
  );
}

// Opens the call that last changed a file, where it is in the chat.
function openTool(e: MouseEvent<HTMLButtonElement>, id: string) {
  const tool = e.currentTarget.closest('.chat')?.querySelector<HTMLDetailsElement>(`[data-tool="${CSS.escape(id)}"]`);
  if (!tool) return;
  for (let d: HTMLDetailsElement | null = tool; d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  tool.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function ChangesCard({ files }: { files: Changed[] }) {
  return (
    <div className="chat-changes" role="group" aria-label={t.changedFiles}>
      <div className="changes-title">{t.filesChanged(files.length)}</div>
      {files.map((f) => {
        const p = filePath(f.file);
        return (
          <button key={f.file} className="changes-file" onClick={(e) => openTool(e, f.tool)}>
            <span className="changes-name">
              <span className="tool-file">{p?.name ?? f.file}</span> {p?.dir}
              {f.created && <span className="changes-new">{t.newMark}</span>}
            </span>
            <DiffCount d={f} />
          </button>
        );
      })}
    </div>
  );
}

// Calls made one after another, as one row: done, when it ended, how long it took, how many calls and what
// they changed; still going (going, or a call unanswered), the newest call. It opens to the calls.
export function ToolsRow(props: { sessionId: string; tools: (ToolTurn & { key: string })[]; going: boolean; end?: string; onOpen: Opener }) {
  const { tools } = props;
  const live = props.going || tools.some((t) => !t.result);
  const latest = tools.at(-1)!;
  const start = Date.parse(tools[0].at ?? '');
  const end = props.end ?? latest.at;
  const took = Date.parse(end ?? '') - start;
  const added = tools.reduce((n, t) => n + (t.result?.diff?.added ?? 0), 0);
  const removed = tools.reduce((n, t) => n + (t.result?.diff?.removed ?? 0), 0);
  const failed = tools.filter((t) => t.result?.error).length;
  return (
    <details className={`chat-tools ${live ? 'live' : ''}`}>
      <summary>
        {live ? (
          <>
            <span className="tools-state">{t.toolsCalled(tools.length)}</span>
            <span className="tool-name">{latest.name}</span>
            <ToolSummary name={latest.name} summary={latest.summary} />
          </>
        ) : (
          <>
            <span className="tools-state">{t.toolsDone(tools.length)}</span>
            <span className="tools-meta">
              {[clock(end), took >= 1000 ? t.took(duration(took)) : '', failed ? t.toolErrors(failed) : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
            {(added > 0 || removed > 0) && <DiffCount d={{ added, removed }} />}
          </>
        )}
      </summary>
      <div className="chat-tools-list">
        {tools.map((t) => (
          <TurnView key={t.key} sessionId={props.sessionId} t={t} onOpen={props.onOpen} />
        ))}
      </div>
    </details>
  );
}
