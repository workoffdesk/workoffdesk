import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { highlightHtml } from '@workoffdesk/client/chat/highlight';

// Code in a reply is coloured by its language, guessed when the reply does not name one.
const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    code({ text, lang }) {
      const html = highlightHtml(text, lang ?? '');
      return `<div class="code-block"><pre><code class="hljs">${html}</code></pre></div>\n`;
    },
  },
});

// Claude's replies as HTML. They quote whatever it read, so the result is sanitized: no scripts, no
// handlers, and no images, which would load from wherever the text points.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function markdownHtml(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'style', 'form', 'input', 'button'] });
}
