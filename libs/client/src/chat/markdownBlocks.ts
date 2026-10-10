// Claude's replies as blocks to draw natively: the Markdown it writes, read well enough to show paragraphs,
// headings, lists, quotes, tables and code as such. What it does not read stays as written.

export type Span = { text: string; code?: true; bold?: true; italic?: true; href?: string };
export type ListItem = { depth: number; marker: string; spans: Span[] };
export type Block =
  | { k: 'paragraph'; spans: Span[] }
  | { k: 'heading'; level: number; spans: Span[] }
  | { k: 'code'; lang: string; text: string }
  | { k: 'quote'; spans: Span[] }
  | { k: 'list'; items: ListItem[] }
  | { k: 'table'; rows: Span[][][] }
  | { k: 'rule' };

type Style = Omit<Span, 'text'>;

const WORD = /[\p{L}\p{N}_]/u;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;
const ANGLED = /^<(https?:\/\/[^\s<>]+)>/;
// An address written out, as GitHub's Markdown finds one: it starts a word, and the punctuation that
// closes a sentence or a bracket around it is not part of it.
const BARE = /^(?:https?:\/\/|www\.)[^\s<>`"'，。、；：！？）」』】]+/;
const TRAILING = /[.,:;!?*_~]+$/;

function address(s: string, i: number): string | null {
  if (i > 0 && /[\p{L}\p{N}_/:.]/u.test(s[i - 1])) return null;
  const found = BARE.exec(s.slice(i))?.[0];
  if (!found) return null;
  let url = found;
  for (let before = ''; url !== before; ) {
    before = url;
    url = url.replace(TRAILING, '');
    // A closing bracket belongs to the address only when it closes one the address opened.
    if (url.endsWith(')') && count(url, '(') < count(url, ')')) url = url.slice(0, -1);
  }
  return /^(https?:\/\/|www\.)[^./]+/.test(url) ? url : null;
}

const count = (s: string, c: string) => s.split(c).length - 1;
const hrefOf = (url: string) => (url.startsWith('www.') ? `http://${url}` : url);

// The end of a run marked by `mark` that starts at `from`, or -1: it must hold something, and a mark made
// of underscores must not sit inside a word.
function closing(s: string, mark: string, from: number): number {
  for (let at = s.indexOf(mark, from); at >= 0; at = s.indexOf(mark, at + 1)) {
    if (at === from || /\s/.test(s[at - 1])) continue;
    if (mark.length === 1 && s[at + 1] === mark) {
      at++;
      continue;
    }
    if (mark[0] === '_' && WORD.test(s[at + mark.length] ?? '')) continue;
    return at;
  }
  return -1;
}

export function spans(s: string, style: Style = {}): Span[] {
  const out: Span[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ text: plain, ...style });
    plain = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      const ticks = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(ticks, i + ticks.length);
      if (end >= 0) {
        flush();
        out.push({ text: s.slice(i + ticks.length, end), ...style, code: true });
        i = end + ticks.length;
        continue;
      }
    } else if (c === '*' || c === '_') {
      const double = s[i + 1] === c;
      const mark = double ? c + c : c;
      const opens = !/\s/.test(s[i + mark.length] ?? ' ') && (c === '*' || !WORD.test(s[i - 1] ?? ''));
      const end = opens ? closing(s, mark, i + mark.length) : -1;
      if (end > 0) {
        flush();
        out.push(...spans(s.slice(i + mark.length, end), { ...style, ...(double ? { bold: true } : { italic: true }) }));
        i = end + mark.length;
        continue;
      }
    } else if (c === '[') {
      const m = LINK.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ text: m[1], ...style, href: m[2] });
        i += m[0].length;
        continue;
      }
    } else if (c === '<') {
      const m = ANGLED.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ text: m[1], ...style, href: m[1] });
        i += m[0].length;
        continue;
      }
    } else if (c === 'h' || c === 'w') {
      const url = address(s, i);
      if (url) {
        flush();
        out.push({ text: url, ...style, href: hrefOf(url) });
        i += url.length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

// Plain text with only its addresses picked out: what the user typed is not Markdown.
export function linkSpans(s: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const url = (s[i] === 'h' || s[i] === 'w') && address(s, i);
    if (!url) continue;
    if (i > from) out.push({ text: s.slice(from, i) });
    out.push({ text: url, href: hrefOf(url) });
    i += url.length - 1;
    from = i + 1;
  }
  if (from < s.length || out.length === 0) out.push({ text: s.slice(from) });
  return out;
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => spans(c.trim()));

const isTable = (lines: string[], i: number) => lines[i].includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-');

const startsBlock = (lines: string[], i: number) =>
  FENCE.test(lines[i]) || HEADING.test(lines[i]) || RULE.test(lines[i]) || QUOTE.test(lines[i]) || ITEM.test(lines[i]) || isTable(lines, i);

export function markdownBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, indent, mark, lang] = fence;
      // A fence indented under a list item has its lines indented as far, which are not part of the code.
      const unindent = new RegExp(`^[ \\t]{0,${indent.length}}`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && !lines[i].trim().replace(/[`~]/g, '')))
        body.push(lines[i++].replace(unindent, ''));
      i++;
      out.push({ k: 'code', lang, text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ k: 'heading', level: heading[1].length, spans: spans(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ k: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      out.push({ k: 'quote', spans: spans(body.join('\n')) });
      continue;
    }
    if (ITEM.test(line)) {
      const items: { depth: number; marker: string; lines: string[] }[] = [];
      while (i < lines.length && lines[i].trim()) {
        const item = ITEM.exec(lines[i]);
        if (item) {
          const marker = /\d/.test(item[2]) ? item[2].replace(')', '.') : '•';
          items.push({ depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2), marker, lines: [item[3]] });
        } else if (startsBlock(lines, i)) break;
        else items.at(-1)!.lines.push(lines[i].trim());
        i++;
      }
      out.push({ k: 'list', items: items.map((it) => ({ depth: it.depth, marker: it.marker, spans: spans(it.lines.join('\n')) })) });
      continue;
    }
    if (isTable(lines, i)) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ k: 'table', rows });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && (!body.length || !startsBlock(lines, i))) body.push(lines[i++].trimStart());
    out.push({ k: 'paragraph', spans: spans(body.join('\n')) });
  }
  return out;
}

// What a reply reads as once drawn, as plain text to select from: the words without the Markdown that
// shaped them.
export function renderedText(markdown: string): string {
  const words = (sp: Span[]) => sp.map((x) => x.text).join('');
  const text = (b: Block): string | null => {
    switch (b.k) {
      case 'paragraph':
      case 'heading':
      case 'quote':
        return words(b.spans);
      case 'code':
        return b.text;
      case 'list':
        return b.items.map((it) => `${'  '.repeat(it.depth)}${it.marker} ${words(it.spans)}`).join('\n');
      case 'table':
        return b.rows.map((row) => row.map(words).join('\t')).join('\n');
      case 'rule':
        return null;
    }
  };
  return markdownBlocks(markdown)
    .map(text)
    .filter((x) => x !== null)
    .join('\n\n');
}
