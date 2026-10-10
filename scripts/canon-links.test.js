'use strict';

// Links, backlinks and the world's graph (docs/semantics/IDE.md §2), on the
// Ashfall Road fixture and its IDE additions (scripts/fixtures/canon/ide).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
const SALT_LAWS = Canon.parseEntry(fs.readFileSync(path.join(FIXTURE, 'ide', 'the-salt-laws.md'), 'utf8'));

// expected.json's entries with their facts, and the Salt Laws
function world(without = []) {
  return [...EXPECTED.entries.filter((x) => !without.includes(x.id)).map((x) => {
    const e = Canon.newEntry(x.name, x.kind, x.id);
    for (const f of x.facts) e.facts.push({ attr: f.attr, value: f.value, as: f.as || '', state: f.state, sources: [] });
    return e;
  }), SALT_LAWS];
}
const sources = () => {
  const lib = path.join(FIXTURE, 'library');
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  return library.shelves[0].bookIds.flatMap((bookId) => {
    const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
    return meta.chapterOrder.map((chId, i) => ({ bookId, chId, book: meta.title, label: meta.format === 'notebook' ? meta.chapterTitles[chId] : 'Ch ' + (i + 1),
      html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') }));
  });
};

test('parseLinks: plain and piped links, a [[ that never closes, links beside punctuation', () => {
  assert.deepEqual(Canon.parseLinks('[[Corwick]]\'s council; ([[Saltmere|the coast]]), [[Ilsa Varr]].').map((l) => [l.target, l.shown]),
    [['Corwick', 'Corwick'], ['Saltmere', 'the coast'], ['Ilsa Varr', 'Ilsa Varr']]);
  assert.deepEqual(Canon.parseLinks('[[Corwick and then [[Rook]]').map((l) => l.target), ['Rook']);
  assert.deepEqual(Canon.parseLinks('[[ ]] [[unclosed'), []);
  const text = 'by [[Rook|the black]].';
  const [l] = Canon.parseLinks(text);
  assert.equal(text.slice(l.start, l.end), '[[Rook|the black]]');
  assert.equal(SALT_LAWS.kind, 'rule');
});

test('links resolve by name, alias, part of a name and case, and curly quotes fold', () => {
  const entries = world();
  entries.find((e) => e.id === 'bramble').aliases.push('the grey mare', 'Brambles’ own');
  const index = Canon.mentionIndex(entries);
  assert.equal(Canon.resolveName('bramble', index), 'bramble');
  assert.equal(Canon.resolveName('The Grey Mare', index), 'bramble');
  assert.equal(Canon.resolveName("Brambles' own", index), 'bramble');
  assert.equal(Canon.resolveName('Ilsa', index), 'ilsa-varr');
  assert.equal(Canon.resolveName('Hale', index), null); // two Hales share it
  assert.equal(Canon.resolveName('Ashby', index), null);
});

test('entryLinks: relation facts and [[links]]; one to no entry comes back unresolved', () => {
  const index = Canon.mentionIndex(world(['saltmere']));
  assert.deepEqual(Canon.entryLinks(SALT_LAWS, index), [{ to: 'corwick', via: 'words' }, { to: null, name: 'Saltmere', via: 'words' }]);
  const all = Canon.mentionIndex(world());
  assert.deepEqual(Canon.entryLinks(SALT_LAWS, all).map((l) => l.to), ['corwick', 'saltmere']);
});

test('linkGraph on the fixture: Tamsin–Bramble (Owner), Tamsin–Oren (Sibling), Ilsa–Saltmere (Born in); backlinks', () => {
  const entries = world();
  const g = Canon.linkGraph(entries, Canon.mentionIndex(entries), { mentions: { bramble: 9 }, together: [['bramble', 'tamsin-hale', 6], ['rook', 'nobody', 2]] });
  assert.equal(g.nodes.length, 8);
  assert.equal(g.nodes.find((n) => n.id === 'bramble').mentions, 9);
  const has = (a, b, attr) => g.edges.some((x) => x.a === a && x.b === b && x.why === 'fact' && x.attr === attr);
  assert.ok(has('bramble', 'tamsin-hale', 'owner'));
  assert.ok(has('tamsin-hale', 'oren-hale', 'sibling'));
  assert.ok(has('ilsa-varr', 'saltmere', 'birthplace'));
  assert.ok(g.edges.some((x) => x.a === 'the-salt-laws' && x.b === 'corwick' && x.why === 'words'));
  assert.deepEqual(g.edges.filter((x) => x.why === 'together').map((x) => [x.a, x.b, x.n]), [['bramble', 'tamsin-hale', 6]]); // an unknown id is dropped
  assert.deepEqual(Canon.backlinks(g, 'tamsin-hale').map((x) => [x.a, x.attr]), [['bramble', 'owner']]);
  assert.deepEqual(Canon.backlinks(g, 'corwick').map((x) => x.a), ['the-salt-laws']);
});

test('a rename keeps links resolving: the old name becomes an alias', () => {
  const entries = world();
  const tamsin = entries.find((e) => e.id === 'tamsin-hale');
  tamsin.aliases.push(tamsin.name); // what the entry page does on a rename
  tamsin.name = 'Tamsin Ashe';
  const g = Canon.linkGraph(entries, Canon.mentionIndex(entries));
  assert.deepEqual(Canon.backlinks(g, 'tamsin-hale').map((x) => [x.a, x.attr]), [['bramble', 'owner']]);
});

test('paraEntries on Book 2 Ch 1 lists Bramble and Ilsa, in order of appearance', () => {
  const src = sources().find((s) => s.bookId === 'book-the-salt-crown-salt2' && s.chId === 'c1');
  const per = Canon.paraEntries(Canon.sourceParas(src.html), Canon.mentionIndex(world()));
  const seen = [...new Set(per.flat())];
  assert.ok(seen.includes('bramble') && seen.includes('ilsa-varr'));
  assert.deepEqual(per[1], ['bramble', 'tamsin-hale']);
  assert.deepEqual(per[0], ['corwick', 'ilsa-varr', 'tamsin-hale']);
});

test('worldIndex: mentions by paragraph, together only for pairs sharing two paragraphs, who is in each chapter', () => {
  const idx = Canon.worldIndex(sources(), world());
  assert.ok(idx.mentions.bramble >= 10);
  const pair = (a, b) => idx.together.find((x) => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a));
  assert.ok(pair('bramble', 'tamsin-hale')[2] >= 2);
  // Rook and Ilsa share one paragraph (Ember Ch 3, the ambush): no edge
  assert.equal(pair('ilsa-varr', 'rook'), undefined);
  for (const [, , n] of idx.together) assert.ok(n >= 2);
  assert.deepEqual(idx.byChapter['book-field-notes-notes3/p3'], ['ilsa-varr', 'corwick']);
});

test('mentionPassages: reading order, 12 words either side, the name as written', () => {
  const r = Canon.mentionPassages(sources(), world(), 'bramble', { limit: 3 });
  assert.equal(r.books, 3);
  assert.equal(r.passages.length, 3);
  assert.ok(r.total > 3);
  const [first] = r.passages;
  assert.deepEqual([first.book, first.label], ['Ember and Thorn', 'Ch 2']);
  assert.equal(first.snippet, '…to be in autumn, and brown with the rain off the hills. Bramble, the grey mare, would not cross the ford. She planted her feet…');
  assert.equal(first.snippet.slice(first.at, first.at + first.span.length), 'Bramble');
});

test('searchPassages: normalised words anywhere on the shelf, three letters at least, twenty at most', () => {
  const found = Canon.searchPassages(sources(), 'GREY MARE');
  assert.deepEqual(found.map((x) => x.book + ', ' + x.label), ['Ember and Thorn, Ch 2', 'Ember and Thorn, Ch 3']);
  assert.equal(found[0].snippet.slice(found[0].at, found[0].at + found[0].span.length), 'grey mare');
  assert.deepEqual(Canon.searchPassages(sources(), 'gr'), []);
  assert.equal(Canon.searchPassages(sources(), 'the').length, 20);
});
