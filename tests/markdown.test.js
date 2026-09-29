import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, toggleTask } from '../src/markdown.js';

test('paragraphs are split by blank lines and keep their line breaks', () => {
  assert.deepEqual(parseMarkdown('Eerste regel\ntweede regel\n\nNieuwe alinea'), [
    { type: 'paragraph', lines: [[{ type: 'text', text: 'Eerste regel' }], [{ type: 'text', text: 'tweede regel' }]] },
    { type: 'paragraph', lines: [[{ type: 'text', text: 'Nieuwe alinea' }]] },
  ]);
});

test('reads Windows line endings as GitHub sends them', () => {
  assert.deepEqual(parseMarkdown('a\r\n\r\nb'), [
    { type: 'paragraph', lines: [[{ type: 'text', text: 'a' }]] },
    { type: 'paragraph', lines: [[{ type: 'text', text: 'b' }]] },
  ]);
});

test('headings', () => {
  assert.deepEqual(parseMarkdown('## Boodschappen'), [
    { type: 'heading', level: 2, inline: [{ type: 'text', text: 'Boodschappen' }] },
  ]);
});

test('bullet, numbered and task list items, with their depth', () => {
  const blocks = parseMarkdown('- los\n1. eerste\n- [ ] schroeven\n  - [x] pluggen\n* [X] boor');
  assert.deepEqual(
    blocks.map((b) => b.type === 'item' && [b.ordered, b.depth, b.task, b.taskIndex, b.inline[0]]),
    [
      [false, 0, null, null, { type: 'text', text: 'los' }],
      [true, 0, null, null, { type: 'text', text: 'eerste' }],
      [false, 0, false, 0, { type: 'text', text: 'schroeven' }],
      [false, 1, true, 1, { type: 'text', text: 'pluggen' }],
      [false, 0, true, 2, { type: 'text', text: 'boor' }],
    ],
  );
});

test('fenced code is kept as is, and task markers inside it are not tasks', () => {
  const blocks = parseMarkdown('```\n- [ ] geen taak\n**niet vet**\n```\n- [ ] wel');
  assert.deepEqual(blocks[0], { type: 'code', text: '- [ ] geen taak\n**niet vet**' });
  assert.deepEqual(blocks[1].type === 'item' && blocks[1].taskIndex, 0);
});

test('quotes', () => {
  assert.deepEqual(parseMarkdown('> let op'), [{ type: 'quote', inline: [{ type: 'text', text: 'let op' }] }]);
});

test('inline code, bold, italic and links', () => {
  const [block] = parseMarkdown('Zie **dit** en _dat_, `code` of [de Kennisbank](https://drive.google.com/x) en https://example.com/a.');
  assert.deepEqual(block.type === 'paragraph' && block.lines[0], [
    { type: 'text', text: 'Zie ' },
    { type: 'strong', text: 'dit' },
    { type: 'text', text: ' en ' },
    { type: 'em', text: 'dat' },
    { type: 'text', text: ', ' },
    { type: 'code', text: 'code' },
    { type: 'text', text: ' of ' },
    { type: 'link', text: 'de Kennisbank', href: 'https://drive.google.com/x' },
    { type: 'text', text: ' en ' },
    { type: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
    { type: 'text', text: '.' },
  ]);
});

test('only web and mail links become links', () => {
  const [block] = parseMarkdown('[klik](javascript:alert(1))');
  assert.deepEqual(block.type === 'paragraph' && block.lines[0], [{ type: 'text', text: 'klik' }]);
});

test('ticking a checkbox changes only that line of the body', () => {
  const body = 'Nodig:\r\n- [ ] schroeven\r\n- [x] pluggen\r\n```\n- [ ] code\n```\n- [ ] boor';
  assert.equal(toggleTask(body, 0), 'Nodig:\r\n- [x] schroeven\r\n- [x] pluggen\r\n```\n- [ ] code\n```\n- [ ] boor');
  assert.equal(toggleTask(body, 1), 'Nodig:\r\n- [ ] schroeven\r\n- [ ] pluggen\r\n```\n- [ ] code\n```\n- [ ] boor');
  assert.equal(toggleTask(body, 2), 'Nodig:\r\n- [ ] schroeven\r\n- [x] pluggen\r\n```\n- [ ] code\n```\n- [x] boor');
});

test('ticking a checkbox that no longer exists leaves the body alone', () => {
  assert.equal(toggleTask('- [ ] a', 5), '- [ ] a');
});
