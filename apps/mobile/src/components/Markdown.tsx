import { UITextView } from '@bsky.app/react-native-uitextview';
import { codeTokens, type CodeKind } from '@workoffdesk/client/chat/highlight';
import { markdownBlocks, type Block, type Span } from '@workoffdesk/client/chat/markdownBlocks';
import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import { memo, useMemo, useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { MONO, tint, useTheme, type Theme } from '../theme';

const COPIED_MS = 1500;

// Code colours, from GitHub's dark and light themes, as on the web (styles.css .hljs-*).
type Look = { color: string; backgroundColor?: string; fontStyle?: 'italic' };
const CODE_COLOURS: Record<'dark' | 'light', Record<CodeKind, Look>> = {
  dark: {
    comment: { color: '#8b949e', fontStyle: 'italic' },
    keyword: { color: '#ff7b72' },
    string: { color: '#a5d6ff' },
    number: { color: '#79c0ff' },
    title: { color: '#d2a8ff' },
    builtin: { color: '#ffa657' },
    deletion: { color: '#ffdcd7', backgroundColor: '#67060c' },
    addition: { color: '#aff5b4', backgroundColor: '#033a16' },
  },
  light: {
    comment: { color: '#6e7781', fontStyle: 'italic' },
    keyword: { color: '#cf222e' },
    string: { color: '#0a3069' },
    number: { color: '#0550ae' },
    title: { color: '#8250df' },
    builtin: { color: '#953800' },
    deletion: { color: '#82071e', backgroundColor: '#ffebe9' },
    addition: { color: '#116329', backgroundColor: '#dafbe1' },
  },
};

// Words a finger can select any part of, as in Notes: iOS draws React Native's Text as a label, which copies
// only whole. Spans inside take part in the same selection.
function Words(props: TextProps) {
  return <UITextView selectable uiTextView {...props} />;
}

// How a paragraph of one text is laid out (iOS); see Prose.
type Layout = { firstLineHeadIndent: number; headIndent: number; paragraphSpacing: number };

function Spans({ spans, s, layout }: { spans: Span[]; s: ReturnType<typeof styles>; layout?: Layout }) {
  return spans.map((sp, i) => (
    <UITextView
      key={i}
      {...layout}
      style={[sp.code && s.code, sp.bold && s.bold, sp.italic && s.italic, sp.href !== undefined && s.link]}
      onPress={sp.href ? () => void Linking.openURL(sp.href!).catch(() => {}) : undefined}
    >
      {layout ? sp.text.replace(/\n/g, LINE_BREAK) : sp.text}
    </UITextView>
  ));
}

const BLOCK_GAP = 14;
const ITEM_GAP = 4;
const DEPTH_INDENT = 18;
const QUOTE_INDENT = 13;
// A new line inside a paragraph: a newline would start a paragraph of its own, without the paragraph's indents.
const LINE_BREAK = '\u2028';

type ProseBlock = Extract<Block, { k: 'paragraph' | 'heading' | 'quote' | 'list' }>;
const isProse = (b: Block): b is ProseBlock => b.k === 'paragraph' || b.k === 'heading' || b.k === 'quote' || b.k === 'list';
type Paragraph = { style: StyleProp<TextStyle>; marker?: string; spans: Span[]; first: number; rest: number; gap: number };

// Paragraphs, headings, quotes and lists that follow one another are one text, so a finger can drag a selection
// across them as in Notes. A list item's marker sits in its paragraph, its wrapped lines starting under the words.
function Prose({ blocks, s }: { blocks: ProseBlock[]; s: ReturnType<typeof styles> }) {
  const fontSize = StyleSheet.flatten(s.text).fontSize ?? 16;
  const paragraphs = blocks.flatMap((b): Paragraph[] => {
    switch (b.k) {
      case 'paragraph':
        return [{ style: null, spans: b.spans, first: 0, rest: 0, gap: BLOCK_GAP }];
      case 'heading':
        return [{ style: b.level === 1 ? s.h1 : s.h2, spans: b.spans, first: 0, rest: 0, gap: BLOCK_GAP }];
      case 'quote':
        return [{ style: s.muted, spans: b.spans, first: QUOTE_INDENT, rest: QUOTE_INDENT, gap: BLOCK_GAP }];
      case 'list': {
        const column = Math.max(...b.items.map((it) => emOf(it.marker) * fontSize + 8), 20);
        return b.items.map((it, i) => ({
          style: null,
          marker: it.marker,
          spans: it.spans,
          first: it.depth * DEPTH_INDENT,
          rest: it.depth * DEPTH_INDENT + column,
          gap: i === b.items.length - 1 ? BLOCK_GAP : ITEM_GAP,
        }));
      }
    }
  });
  return (
    <Words style={s.text}>
      {paragraphs.map((p, i) => {
        const last = i === paragraphs.length - 1;
        const layout = { firstLineHeadIndent: p.first, headIndent: p.rest, paragraphSpacing: last ? 0 : p.gap };
        return (
          <UITextView key={i} style={p.style}>
            {p.marker !== undefined && <UITextView {...layout}>{`${p.marker}\t`}</UITextView>}
            <Spans spans={p.spans} s={s} layout={layout} />
            {!last && <UITextView {...layout}>{'\n'}</UITextView>}
          </UITextView>
        );
      })}
    </Words>
  );
}

function BlockView({ b, s }: { b: Exclude<Block, ProseBlock>; s: ReturnType<typeof styles> }) {
  switch (b.k) {
    case 'code':
      return <CodeBlock text={b.text} lang={b.lang} s={s} />;
    case 'table':
      return <Table rows={b.rows} s={s} />;
    case 'rule':
      return <View style={s.rule} />;
  }
}

// Runs of prose between the blocks with frames of their own.
function parts(blocks: Block[]) {
  const out: (ProseBlock[] | Exclude<Block, ProseBlock>)[] = [];
  for (const b of blocks) {
    const run = out.at(-1);
    if (!isProse(b)) out.push(b);
    else if (Array.isArray(run)) run.push(b);
    else out.push([b]);
  }
  return out;
}

// A table fits the phone's width, its cells wrapping: a sideways scroll in the chat does not move under a
// finger. As a browser lays a table out, each column first gets its longest word, so a word, a number or a
// path is not cut in two, and the width left goes to the columns with more to say. When even the words do
// not fit side by side, each row becomes a card of its own. Nothing measures text before it is drawn, so
// widths are estimated from the characters, on the wide side.
const CELL_PAD = 17;
const WIDE = /[\u2E80-\uFFEF]/g;
const charEm = (ch: string) =>
  ch.charCodeAt(0) >= 0x2e80 ? 1 : /[0-9]/.test(ch) ? 0.6 : /[A-Z]/.test(ch) ? 0.7 : /[a-z]/.test(ch) ? 0.55 : ch === ' ' ? 0.28 : 0.4;
const emOf = (text: string) => [...text].reduce((w, ch) => w + charEm(ch), 0);
// A line breaks at a space, after a slash or a hyphen (a path breaks between its folders), and between any
// two Chinese or Japanese characters.
const longestWordEm = (text: string) => Math.max(0, ...text.replace(WIDE, ' $& ').replace(/[/-]/g, '$& ').split(/\s+/).map(emOf));

// null: the columns' longest words do not fit side by side.
function columnWidths(cells: string[][], columns: number, width: number, fontSize: number): number[] | null {
  const px = (em: number, header: boolean) => em * fontSize * (header ? 1.12 : 1.06) + CELL_PAD;
  const widest = (of: (text: string) => number) =>
    Array.from({ length: columns }, (_, j) => Math.max(CELL_PAD, ...cells.map((r, i) => px(of(r[j] ?? ''), i === 0))));
  const least = widest(longestWordEm);
  const most = widest(emOf);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (sum(most) <= width) return most;
  if (sum(least) > width) return null;
  const spare = (width - sum(least)) / (sum(most) - sum(least));
  return least.map((w, j) => w + (most[j] - w) * spare);
}

function Table({ rows, s }: { rows: Span[][][]; s: ReturnType<typeof styles> }) {
  const columns = Math.max(0, ...rows.map((r) => r.length));
  const cells = useMemo(() => rows.map((r) => r.map((spans) => spans.map((x) => x.text).join(''))), [rows]);
  // Until the table is laid out, the screen less the chat's margins stands in for its width.
  const [width, setWidth] = useState(useWindowDimensions().width - 48);
  const fontSize = StyleSheet.flatten(s.fittedCell).fontSize ?? 14;
  const widths = useMemo(() => columnWidths(cells, columns, width, fontSize), [cells, columns, width, fontSize]);
  const measure = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (!widths && rows.length > 1) {
    const [head, ...body] = rows;
    const label = Math.min(width * 0.4, Math.max(0, ...cells[0].slice(1).map((h) => emOf(h) * fontSize * 1.06)));
    return (
      <View style={s.fitted} onLayout={measure}>
        {body.map((row, i) => (
          <View key={i} style={[s.card, i > 0 && s.fittedRule]}>
            <Words style={[s.cardText, s.bold]}>
              <Spans spans={row[0] ?? []} s={s} />
            </Words>
            {Array.from({ length: columns - 1 }, (_, j) => j + 1).map(
              (j) =>
                !!row[j]?.length && (
                  <View key={j} style={s.cardLine}>
                    <Words style={[s.cardText, s.muted, { width: label }]}>
                      <Spans spans={head[j] ?? []} s={s} />
                    </Words>
                    <Words style={[s.cardText, s.cardValue]}>
                      <Spans spans={row[j]} s={s} />
                    </Words>
                  </View>
                ),
            )}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={s.fitted} onLayout={measure}>
      {rows.map((row, i) => (
        <View key={i} style={[s.fittedRow, i > 0 && s.fittedRule]}>
          {(widths ?? Array.from({ length: columns }, () => 1)).map((w, j) => (
            <Words key={j} style={[s.fittedCell, { flex: w }, j > 0 && s.fittedSide, i === 0 && s.bold]}>
              <Spans spans={row[j] ?? []} s={s} />
            </Words>
          ))}
        </View>
      ))}
    </View>
  );
}

// A block of code, with a button that copies it.
function CodeBlock({ text, lang, s }: { text: string; lang: string; s: ReturnType<typeof styles> }) {
  const [copied, setCopied] = useState(false);
  const { dark } = useTheme();
  const colours = CODE_COLOURS[dark ? 'dark' : 'light'];
  const runs = useMemo(() => codeTokens(text, lang), [text, lang]);
  const copy = () =>
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return (
    <View>
      <View style={[s.pre, s.preInner]}>
        <Words style={s.preText}>
          {runs.map((r, i) => (r.kind ? <UITextView key={i} style={colours[r.kind]}>{r.text}</UITextView> : r.text))}
        </Words>
      </View>
      <Text style={s.codeCopy} onPress={copy} accessibilityRole="button">
        {copied ? t.copied : t.copy}
      </Text>
    </View>
  );
}

// Claude's words as blocks of their own: paragraphs, headings, lists, quotes, tables and code.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const runs = useMemo(() => parts(markdownBlocks(text)), [text]);
  return (
    <View style={s.blocks}>
      {runs.map((r, i) => (Array.isArray(r) ? <Prose key={i} blocks={r} s={s} /> : <BlockView key={i} b={r} s={s} />))}
    </View>
  );
});

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    blocks: { gap: BLOCK_GAP },
    text: { fontSize: fs(16), lineHeight: fs(16) * 1.55, color: c.text },
    muted: { color: c.muted },
    h1: { fontSize: fs(19), lineHeight: fs(19) * 1.4, fontWeight: '700' },
    h2: { fontSize: fs(17), lineHeight: fs(17) * 1.4, fontWeight: '700' },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    link: { color: c.accent },
    code: { fontFamily: MONO, fontSize: fs(16) * 0.86, backgroundColor: tint(c.text, 8) },
    pre: { borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, flexGrow: 0 },
    // The copy button sits above the code, as on the web, not over its first line.
    preInner: { paddingTop: 34, paddingBottom: 8, paddingHorizontal: 10 },
    codeCopy: {
      position: 'absolute',
      top: 6,
      right: 6,
      paddingVertical: 3,
      paddingHorizontal: 9,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      fontSize: fs(12),
      color: c.muted,
      backgroundColor: c.surface2,
    },
    preText: { fontFamily: MONO, fontSize: fs(12), lineHeight: fs(12) * 1.45, color: c.text },
    fitted: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 8, overflow: 'hidden' },
    fittedRow: { flexDirection: 'row' },
    fittedRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    fittedCell: { fontSize: fs(14), lineHeight: fs(14) * 1.45, color: c.text, paddingVertical: 6, paddingHorizontal: 8 },
    card: { paddingVertical: 8, paddingHorizontal: 10, gap: 4 },
    cardLine: { flexDirection: 'row', gap: 10 },
    cardText: { fontSize: fs(14), lineHeight: fs(14) * 1.45, color: c.text },
    cardValue: { flex: 1 },
    fittedSide: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border },
    rule: { height: 1, backgroundColor: c.border },
  });
