// Logbook's built-in markdown renderer. Zero dependencies, so the app always
// works; KaTeX and highlight.js enhance the output when their CDN scripts load.
//
// Supported: headings, paragraphs, bold/italic/strikethrough, inline code,
// fenced code blocks, blockquotes, hr, ordered/unordered/task lists, tables,
// links, images, autolinks, [[wiki-links]], $inline$ and $$block$$ math,
// YAML-ish front matter (status: ...).

// ---------- front matter ----------
export function parseFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

// ---------- helpers ----------
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Protect a span of text from further inline processing.
let stash = null;
function protect(html) {
  stash.push(html);
  return `\x00${stash.length - 1}\x00`;
}
function unprotect(html) {
  return html.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
}

// ---------- inline rendering ----------
function inline(text) {
  let out = esc(text);

  // math first, so its contents are never touched by other rules
  out = out.replace(/\$\$([^$]+?)\$\$/g, (_, tex) =>
    protect(renderMath(tex, true)));
  // Inline math, pandoc-style so prices don't become math: the opening $
  // must not be followed by a digit or space ("$50–70K" is currency), the
  // content can't start/end with whitespace, and the closing $ must not be
  // followed by a digit ("the ~$9–13K base").
  out = out.replace(/\$([^\s\d$][^$\n]*?[^\s$]|[^\s\d$])\$(?!\d)/g, (_, tex) =>
    protect(renderMath(tex, false)));

  // inline code
  out = out.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${code}</code>`));

  // the one HTML tag we honor: <br> (escaped above, and after code
  // protection so a literal `<br>` in backticks stays text) → line break
  out = out.replace(/&lt;br\s*\/?\s*&gt;/gi, () => protect('<br>'));

  // images ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    protect(`<img alt="${alt}" data-src="${src}">`));

  // wiki links [[Page Title]]
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_, t) =>
    protect(`<a class="wikilink" data-wiki="${t.trim()}" href="#/find/${encodeURIComponent(t.trim())}">${t.trim()}</a>`));

  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) =>
    protect(`<a href="${url}" target="_blank" rel="noopener">${t}</a>`));

  // autolinks
  out = out.replace(/(?<![">])(https?:\/\/[^\s<]+[^\s<.,)])/g, (_, url) =>
    protect(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`));

  // emphasis
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return out;
}

function renderMath(tex, display) {
  if (window.katex) {
    try {
      return window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch { /* fall through */ }
  }
  return display
    ? `<pre class="math-fallback">${esc(tex)}</pre>`
    : `<code class="math-fallback">${esc(tex)}</code>`;
}

// ---------- block rendering ----------
export function render(markdown) {
  const isRoot = stash === null;
  if (isRoot) stash = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(codeBlock(buf.join('\n'), fence[1]));
      continue;
    }

    // block math on its own lines: $$ ... $$
    if (/^\s*\$\$\s*$/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(renderMath(buf.join('\n'), true));
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    // hr
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const headerCells = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i++]));
      }
      const thead = `<tr>${headerCells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`;
      const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    // lists
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
      const [html, next] = list(lines, i, 0);
      out.push(html);
      i = next;
      continue;
    }

    // paragraph: gather until blank line or new block
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|```|>|(\s*)([-*+]|\d+\.)\s|\s*\$\$\s*$)/.test(lines[i])
    ) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('\n'))}</p>`);
  }

  const html = out.join('\n');
  if (!isRoot) return html; // nested call: the root render unprotects at the end
  const result = unprotect(html);
  stash = null;
  return result;
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

function codeBlock(code, lang) {
  if (window.hljs && lang && window.hljs.getLanguage(lang)) {
    try {
      const html = window.hljs.highlight(code, { language: lang }).value;
      return `<pre><code class="hljs language-${lang}">${html}</code></pre>`;
    } catch { /* fall through */ }
  }
  return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(code)}</code></pre>`;
}

function list(lines, start, depth) {
  const indent = lines[start].match(/^(\s*)/)[1].length;
  const ordered = /^\s*\d+\./.test(lines[start]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) break;
    const ind = m[1].length;
    if (ind < indent) break;
    // a marker-type switch at the same indent starts a new list
    if (ind === indent && i !== start && /^\d+\.$/.test(m[2]) !== ordered) break;
    if (ind > indent) {
      const [sub, next] = list(lines, i, depth + 1);
      items[items.length - 1] += sub;
      i = next;
      continue;
    }
    let content = m[3];
    // task list checkbox
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const checked = task[1] !== ' ';
      content = `<input type="checkbox" disabled${checked ? ' checked' : ''}> ${inline(task[2])}`;
      items.push(`<li class="task${checked ? ' done' : ''}">${content}`);
    } else {
      items.push(`<li>${inline(content)}`);
    }
    i++;
  }

  const closed = items.map((it) => `${it}</li>`).join('');
  return [`<${ordered ? 'ol' : 'ul'}>${closed}</${ordered ? 'ol' : 'ul'}>`, i];
}
