import { el } from './dom.js';

/** @typedef {import('./markdown.js').Block} Block */
/** @typedef {import('./markdown.js').Inline} Inline */

/**
 * Builds the DOM for parsed Markdown, with text only ever set as text.
 * Checkboxes can be ticked when `onToggle` is given.
 * @param {Block[]} blocks
 * @param {((taskIndex: number) => void) | null} onToggle
 */
export function renderMarkdown(blocks, onToggle) {
  const root = el('div', 'markdown');
  /** @type {HTMLElement | null} */
  let list = null;
  for (const block of blocks) {
    if (block.type !== 'item') list = null;
    switch (block.type) {
      case 'paragraph': {
        const p = el('p');
        block.lines.forEach((line, i) => {
          if (i > 0) p.append(el('br'));
          p.append(...line.map(inline));
        });
        root.append(p);
        break;
      }
      case 'heading':
        root.append(withInline(el(`h${Math.min(block.level + 3, 6)}`), block.inline));
        break;
      case 'quote':
        root.append(withInline(el('blockquote'), block.inline));
        break;
      case 'code':
        root.append(withInline(el('pre'), [{ type: 'code', text: block.text }]));
        break;
      case 'item': {
        const tag = block.ordered ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = el(tag);
          root.append(list);
        }
        const li = el('li');
        li.style.marginLeft = `${block.depth * 1.25}rem`;
        if (block.task !== null) {
          li.className = 'task';
          const box = /** @type {HTMLInputElement} */ (el('input'));
          box.type = 'checkbox';
          box.checked = block.task;
          box.disabled = !onToggle;
          const index = /** @type {number} */ (block.taskIndex);
          box.addEventListener('change', () => onToggle?.(index));
          const label = el('label');
          label.append(box, ' ');
          li.append(withInline(label, block.inline));
        } else {
          withInline(li, block.inline);
        }
        list.append(li);
        break;
      }
    }
  }
  return root;
}

/** @param {HTMLElement} node @param {Inline[]} tokens */
function withInline(node, tokens) {
  node.append(...tokens.map(inline));
  return node;
}

/** @param {Inline} token @returns {Node} */
function inline(token) {
  switch (token.type) {
    case 'text':
      return document.createTextNode(token.text);
    case 'code':
      return el('code', undefined, token.text);
    case 'strong':
      return el('strong', undefined, token.text);
    case 'em':
      return el('em', undefined, token.text);
    case 'link': {
      const a = /** @type {HTMLAnchorElement} */ (el('a', undefined, token.text));
      a.href = token.href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }
  }
}
