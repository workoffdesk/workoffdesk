import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// Code in a reply is coloured by its language, guessed when the reply does not name one.

const LANGUAGES = { bash, css, diff, go, javascript, json, markdown, python, ruby, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rb'], { languageName: 'ruby' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The code as HTML: the text escaped, in spans of class hljs-<kind>.
export function highlightHtml(text: string, lang: string): string {
  const name = lang.trim().split(/\s/)[0];
  try {
    return name && hljs.getLanguage(name) ? hljs.highlight(text, { language: name }).value : hljs.highlightAuto(text).value;
  } catch {
    return escape(text);
  }
}

// The kinds the two themes colour (the web's .hljs-* rules); anything else is plain.
export type CodeKind = 'comment' | 'keyword' | 'string' | 'number' | 'title' | 'builtin' | 'deletion' | 'addition';
const KINDS: Record<string, CodeKind> = {
  comment: 'comment',
  quote: 'comment',
  keyword: 'keyword',
  'selector-tag': 'keyword',
  type: 'keyword',
  string: 'string',
  regexp: 'string',
  number: 'number',
  literal: 'number',
  attr: 'number',
  attribute: 'number',
  title: 'title',
  section: 'title',
  built_in: 'builtin',
  symbol: 'builtin',
  name: 'builtin',
  'selector-class': 'builtin',
  deletion: 'deletion',
  addition: 'addition',
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, e: string) => ENTITIES[e]);

// The code as runs of text for a renderer without HTML; a run takes the kind of the innermost span that has one.
export function codeTokens(text: string, lang: string): { text: string; kind: CodeKind | null }[] {
  const out: { text: string; kind: CodeKind | null }[] = [];
  const stack: (CodeKind | null)[] = [];
  for (const m of highlightHtml(text, lang).matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
    if (m[0] === '</span>') stack.pop();
    else if (m[1] !== undefined) {
      const kind = m[1].split(' ').map((c) => KINDS[c.replace(/^hljs-/, '')]).find(Boolean);
      stack.push(kind ?? stack.at(-1) ?? null);
    } else {
      const kind = stack.at(-1) ?? null;
      const run = unescape(m[0]);
      const last = out.at(-1);
      if (last && last.kind === kind) last.text += run;
      else out.push({ text: run, kind });
    }
  }
  return out;
}
