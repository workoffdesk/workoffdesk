import { filePath, type Changed, type Diff, type ToolTurn } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { useContext } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAgentName } from '@workoffdesk/react/agentName';
import { Markdown } from '../Markdown';
import { type S } from './styles';
import { JumpContext, LongView, useOpened } from './common';
import { Pictures } from './media';
import { ShownAbove } from './bubbles';

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export function ToolSummary({ name, summary, s }: { name: string; summary: string; s: S }) {
  const file = FILE_TOOLS.has(name) ? filePath(summary) : null;
  return (
    <Text style={s.toolSummary} numberOfLines={1}>
      {file ? (
        <>
          <Text style={s.strong}>{file.name}</Text> {file.dir}
        </>
      ) : (
        summary
      )}
    </Text>
  );
}

export function DiffCount({ d, s }: { d: { added: number; removed: number }; s: S }) {
  return (
    <Text style={s.diffCount}>
      {d.added > 0 && <Text style={s.ins}>+{d.added} </Text>}
      {d.removed > 0 && <Text style={s.del}>−{d.removed}</Text>}
    </Text>
  );
}

// Lines shown in the chat before the rest is left to a sheet of its own: a sideways or nested scroll in the
// chat does not move under a finger, so long lines wrap and long output opens full screen.
export const SHOWN_LINES = 30;

function DiffView({ d, s }: { d: Diff; s: S }) {
  const rows = [
    ...(d.created ? [{ head: true, text: t.newFile }] : []),
    ...d.hunks.flatMap((h) => [...(d.created ? [] : [{ head: true, text: t.atLine(h.newStart) }]), ...h.lines.map((text) => ({ head: false, text }))]),
    ...(d.cut ? [{ head: true, text: t.diffCut }] : []),
  ];
  const draw = (shown: typeof rows) =>
    shown.map((r, i) =>
      r.head ? (
        <Text key={i} style={s.diffHead}>
          {r.text}
        </Text>
      ) : (
        <Text key={i} style={[s.diffLine, r.text[0] === '+' ? s.diffAdd : r.text[0] === '-' ? s.diffDel : null]} selectable>
          {r.text || ' '}
        </Text>
      ),
    );
  return (
    <LongView count={rows.length} style={s.diff} s={s} all={() => draw(rows)}>
      {draw(rows.slice(0, SHOWN_LINES))}
    </LongView>
  );
}

function Output({ text, s }: { text: string; s: S }) {
  const lines = text.split('\n');
  return (
    <LongView count={lines.length} style={s.pre} s={s} all={() => <Text style={s.preText} selectable>{text}</Text>}>
      <Text style={s.preText} selectable>
        {lines.slice(0, SHOWN_LINES).join('\n')}
      </Text>
    </LongView>
  );
}

// Each file opens the call that last changed it, where it is in the chat.
export function ChangesCard({ files, s }: { files: Changed[]; s: S }) {
  const { openTool } = useContext(JumpContext);
  return (
    <View style={s.changes} accessibilityLabel={t.changedFiles}>
      <Text style={s.changesTitle}>{t.filesChanged(files.length)}</Text>
      {files.map((f) => {
        const p = filePath(f.file);
        return (
          <Pressable key={f.file} style={({ pressed }) => [s.changesFile, pressed && s.pressed]} accessibilityRole="button" onPress={() => openTool(f.tool)}>
            <Text style={s.changesName} numberOfLines={1}>
              <Text style={s.strong}>{p?.name ?? f.file}</Text> {p?.dir}
              {f.created && <Text style={s.strong}> · {t.newMark}</Text>}
            </Text>
            <DiffCount d={f} s={s} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function Tool({ sessionId, turn, repeated, s }: { sessionId: string; turn: ToolTurn & { key: string }; repeated?: Set<string>; s: S }) {
  const [open, setOpen] = useOpened([turn.key]);
  const who = useAgentName();
  if (turn.plan)
    return (
      <View style={s.plan}>
        <Text style={s.planHead}>{t.plan}</Text>
        <Markdown text={turn.plan} />
      </View>
    );
  const diff = turn.result?.diff;
  return (
    <>
      <View style={s.tool}>
        <Pressable style={s.toolSummaryRow} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={s.toolMark}>{open ? '▾' : '▸'}</Text>
          <Text style={[s.toolName, turn.result?.error && s.danger, turn.result?.stopped && s.stoppedName]}>{turn.name}</Text>
          <ToolSummary name={turn.name} summary={turn.summary} s={s} />
          {diff && <DiffCount d={diff} s={s} />}
          {!turn.result && <Text style={s.running}>{t.running}</Text>}
          {turn.result?.stopped && <Text style={s.running}>{t.noteInterrupted}</Text>}
        </Pressable>
        {open &&
          (diff ? (
            <DiffView d={diff} s={s} />
          ) : (
            <Output text={turn.result ? (turn.result.stopped ? t.toolStopped(who) : turn.result.text || t.noOutput) : t.noResultYet} s={s} />
          ))}
      </View>
      {turn.result?.image &&
        turn.name === 'Read' &&
        (repeated?.has(turn.summary) ? <ShownAbove path={turn.summary} s={s} /> : <Pictures sessionId={sessionId} paths={[turn.summary]} read />)}
    </>
  );
}
