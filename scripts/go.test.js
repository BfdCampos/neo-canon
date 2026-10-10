'use strict';

// Go to Anything's rules (GO TO ANYTHING in app.js), run on their own
// through vm, as snapshots.test.js does (docs/semantics/IDE.md §4).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const GO_WEIGHT'), app.indexOf('// (the rules above are plain functions: scripts/go.test.js)')), context);
vm.runInContext('this.api = { goScore, goRank, goFresh, goSnippet };', context);
const { goScore, goRank, goFresh, goSnippet } = context.api;
const keys = (r) => r.map((x) => x.key).join();

const bramble = { key: 'entry:bramble', group: 'entry', texts: ['Bramble', 'The Grey'] };
const items = [
  bramble,
  { key: 'entry:rook', group: 'entry', texts: ['Rook'] },
  { key: 'fact:bramble/sex', group: 'fact', entry: 'entry:bramble', texts: ['Sex: female (mare)', 'female', 'mare', 'Bramble, the grey mare, would not cross the ford.'] },
  { key: 'fact:rook/sex', group: 'fact', entry: 'entry:rook', texts: ['Sex: male (stallion)', 'male', 'stallion', 'Oren came down the bank behind them on Rook, a black stallion'] },
  { key: 'ch:c2', group: 'chapter', texts: ['Chapter 2'] },
  { key: 'cmd:File › Export › Paperback for KDP…', group: 'command', texts: ['Paperback for KDP…', 'Export › Paperback for KDP…'] },
  { key: 'cmd:File › Take Snapshot', group: 'command', texts: ['Take Snapshot', 'Take Snapshot'] },
  { key: 'cmd:View › Page › Paper', group: 'command', texts: ['Paper', 'Page › Paper'] }
];

test('"grey mare" ranks Bramble first: a fact that answers lifts its entry to the top', () => {
  const r = goRank('grey mare', items);
  assert.equal(r[0].key, 'entry:bramble');
  assert.equal(r[1].key, 'fact:bramble/sex');
  assert.ok(!r.some((x) => x.key === 'entry:rook'));
  // an alias answers for its entry as its name does
  assert.equal(goRank('the grey', items)[0].key, 'entry:bramble');
});

test('"pap kdp" finds Paperback for KDP…, and "snapshot" Take Snapshot', () => {
  assert.equal(goRank('pap kdp', items)[0].key, 'cmd:File › Export › Paperback for KDP…');
  assert.equal(goRank('snapshot', items)[0].key, 'cmd:File › Take Snapshot');
});

test('an exact match beats a prefix, which beats a word\'s start, anywhere, words in order, and letters in order', () => {
  const s = [goScore('paper', 'Paper'), goScore('paper', 'Paperback for KDP…'), goScore('kdp', 'Paperback for KDP…'),
    goScore('erba', 'Paperback for KDP…'), goScore('pap kdp', 'Paperback for KDP…'), goScore('pbk', 'Paperback for KDP…')];
  assert.deepEqual(s.map((x) => x > 0), [true, true, true, true, true, true]);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1] > s[i], `${i - 1}: ${s[i - 1]} > ${s[i]}`);
  assert.equal(goScore('zzz', 'Paperback'), 0);
  assert.equal(goScore('Zoë', 'zoe'), 1); // accents and case fold
  assert.equal(goScore('‘tis', "'Tis the season"), 0.8); // quotes fold
  // the closer the letters, the better
  assert.ok(goScore('pbk', 'Paperback') > goScore('pbk', 'Pale blue kettle'));
  // with the group's weight, an exact command name beats an exact chapter title
  const r = goRank('paper', [{ key: 'ch', group: 'chapter', texts: ['Paper'] }, { key: 'cmd', group: 'command', texts: ['Paper'] }]);
  assert.equal(keys(r), 'cmd,ch');
});

test('letters in order stay inside one word, and a better answer hides them', () => {
  assert.equal(goScore('canon', 'Spellcheck Language › Română'), 0);
  assert.equal(goScore('mare', 'Smaller Text'), 0);
  assert.equal(goScore('snap', 'Polski'), 0);
  assert.ok(goScore('spllchk', 'Spellcheck Pass') > 0);
  assert.equal(goScore('a', 'Paperback'), 0); // one letter: only a word's start
  const r = goRank('spel', [{ key: 'a', group: 'command', texts: ['Spellcheck Pass'] }, { key: 'b', group: 'command', texts: ['Sample Pellet'] }]);
  assert.equal(keys(r), 'a');
});

test('recent picks get a bonus, the most recent the most', () => {
  const two = [{ key: 'a', group: 'chapter', texts: ['Saltmere'] }, { key: 'b', group: 'chapter', texts: ['Saltmere'] }];
  assert.equal(keys(goRank('salt', two, ['b'])), 'b,a');
  assert.equal(keys(goRank('salt', two, ['a', 'b'])), 'a,b');
  const [a, b] = goRank('salt', two, ['a', 'b']);
  assert.ok(a.score > b.score && b.score > goRank('salt', two)[0].score);
});

test('a stale reply (an older sequence number) is dropped', () => {
  assert.equal(goFresh(3, { seq: 3, passages: [] }), true);
  assert.equal(goFresh(3, { seq: 2, passages: [] }), false);
  assert.equal(goFresh(3, null), false);
});

test('snippets: a few words either side, the words found where they are', () => {
  const text = 'The ford below Corwick was wider than it had any right to be in autumn, and brown with the rain.';
  const at = text.indexOf('right');
  const s = goSnippet(text, at, at + 5, 3);
  assert.equal(s.snippet, '…it had any right to be in…');
  assert.equal(s.snippet.slice(s.at, s.at + s.span.length), 'right');
});
