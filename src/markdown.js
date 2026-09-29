/**
 * Just enough of GitHub's Markdown for issue descriptions and comments:
 * headings, lists with checkboxes, quotes, code, bold, italic and links.
 * It returns plain data, never HTML, so a body can't inject anything.
 */

/** @typedef {{ type: 'text' | 'code' | 'strong' | 'em', text: string } | { type: 'link', text: string, href: string }} Inline */
/**
 * `task` is null for a plain list item, else whether it is ticked;
 * `taskIndex` counts checkboxes in the body, for `toggleTask`.
 * @typedef {(
 *   | { type: 'paragraph', lines: Inline[][] }
 *   | { type: 'heading', level: number, inline: Inline[] }
 *   | { type: 'item', ordered: boolean, depth: number, task: boolean | null, taskIndex: number | null, inline: Inline[] }
 *   | { type: 'quote', inline: Inline[] }
 *   | { type: 'code', text: string }
 * )} Block
 */

const FENCE = /^\s*```/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/;
const TASK_MARK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/**
 * Walks the lines of a body, telling apart what is inside fenced code.
 * Both the parser and `toggleTask` use it, so they count checkboxes alike.
 * @param {string[]} lines
 * @param {(line: string, i: number, inFence: boolean, fenceEdge: boolean) => void} visit
 */
function eachLine(lines, visit) {
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      visit(line, i, inFence, true);
      inFence = !inFence;
    } else {
      visit(line, i, inFence, false);
    }
  });
}

/** @param {string} text @returns {Block[]} */
export function parseMarkdown(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  /** @type {Block[]} */
  const blocks = [];
  /** @type {Inline[][] | null} */
  let paragraph = null;
  /** @type {string[] | null} */
  let code = null;
  let taskIndex = 0;

  eachLine(lines, (line, _i, inFence, fenceEdge) => {
    if (fenceEdge) {
      paragraph = null;
      if (inFence) {
        blocks.push({ type: 'code', text: /** @type {string[]} */ (code).join('\n') });
        code = null;
      } else {
        code = [];
      }
      return;
    }
    if (inFence) {
      /** @type {string[]} */ (code).push(line);
      return;
    }
    if (line.trim() === '') {
      paragraph = null;
      return;
    }
    let m;
    if ((m = line.match(HEADING))) {
      paragraph = null;
      blocks.push({ type: 'heading', level: m[1].length, inline: parseInline(m[2].trim()) });
    } else if ((m = line.match(ITEM))) {
      paragraph = null;
      const task = m[3] === undefined ? null : m[3] !== ' ';
      blocks.push({
        type: 'item',
        ordered: /\d/.test(m[2]),
        depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
        task,
        taskIndex: task === null ? null : taskIndex++,
        inline: parseInline(m[4].trim()),
      });
    } else if ((m = line.match(QUOTE))) {
      paragraph = null;
      blocks.push({ type: 'quote', inline: parseInline(m[1].trim()) });
    } else if (paragraph) {
      paragraph.push(parseInline(line.trim()));
    } else {
      paragraph = [parseInline(line.trim())];
      blocks.push({ type: 'paragraph', lines: paragraph });
    }
  });
  // A fence that is never closed still shows its code.
  if (code) blocks.push({ type: 'code', text: /** @type {string[]} */ (code).join('\n') });
  return blocks;
}

/**
 * The body with checkbox number `n` ticked or unticked, and every other
 * character, line endings included, left as it was.
 * @param {string} body @param {number} n
 */
export function toggleTask(body, n) {
  const parts = body.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  let seen = 0;
  eachLine(lines, (line, i, inFence, fenceEdge) => {
    if (inFence || fenceEdge || !ITEM.exec(line)?.[3]) return;
    if (seen++ === n) {
      parts[i * 2] = line.replace(TASK_MARK, (_, lead, mark) => `${lead}[${mark === ' ' ? 'x' : ' '}]`);
    }
  });
  return parts.join('');
}

const INLINE = new RegExp(
  [
    /`([^`]+)`/.source,
    /\*\*(.+?)\*\*|__(.+?)__/.source,
    /\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w)/.source,
    /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.source,
    /(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/.source,
  ].join('|'),
  'g',
);

/** @param {string} href */
const isSafe = (href) => /^(https?:|mailto:)/i.test(href);

/** @param {string} text @returns {Inline[]} */
function parseInline(text) {
  /** @type {Inline[]} */
  const out = [];
  /** @param {Inline} token */
  const push = (token) => {
    const last = out[out.length - 1];
    if (token.type === 'text' && last?.type === 'text') last.text += token.text;
    else if (token.type !== 'text' || token.text) out.push(token);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    push({ type: 'text', text: text.slice(at, m.index) });
    const [, code, strong1, strong2, em1, em2, label, href, url] = m;
    if (code !== undefined) push({ type: 'code', text: code });
    else if (strong1 ?? strong2) push({ type: 'strong', text: strong1 ?? strong2 });
    else if (em1 ?? em2) push({ type: 'em', text: em1 ?? em2 });
    else if (label !== undefined) push(isSafe(href) ? { type: 'link', text: label, href } : { type: 'text', text: label });
    else push({ type: 'link', text: url, href: url });
    at = /** @type {number} */ (m.index) + m[0].length;
  }
  push({ type: 'text', text: text.slice(at) });
  return out;
}
