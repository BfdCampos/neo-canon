'use strict';

// The answer-sheet scorer (scripts/canon-score.js): the sheets' quotes are
// verbatim, a perfect run scores 100%, and the matcher neither over- nor
// under-matches on the cases that matter (READING.md §9).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const Score = require('./canon-score.js');

const DEV = path.join(__dirname, 'fixtures', 'canon-editor', 'dev');
const answers = Score.readAnswers(path.join(DEV, 'answers.json'));
const texts = Score.textIndex(path.join(DEV, 'library'));

// how a reader might label each canonical attribute
const LABEL = { 'appearance.hair': 'Hair', 'appearance.height': 'Height', 'appearance.build': 'Build', 'appearance.mark': 'Distinguishing mark', 'appearance.other': 'Appearance', 'appearance.clothing': 'Clothing', occupation: 'Job', 'relationship.friend': 'Friend', 'location.home': 'Lives in', 'location.part': 'Parts', 'manner.speech': 'Speech' };
const label = (a) => LABEL[a] || a[0].toUpperCase() + a.slice(1);

// entries written as a perfect editor would, as Canon's files
function perfectRun(dir) {
  fs.mkdirSync(path.join(dir, 'entries'), { recursive: true });
  for (const a of answers.entities) {
    const e = Canon.newEntry(a.name, a.kind, a.id);
    e.aliases = a.aliases;
    for (const f of a.facts) {
      e.facts.push({ attr: 'other', label: label(f.attr), value: f.value, as: '', state: f.said ? 'unverified' : 'verified',
        sources: [{ label: 'Under the Line, ' + answers.chapters[f.ch], quote: f.quote, book: answers.book, ch: f.ch, said: f.said || undefined }] });
    }
    let text = Canon.serialiseEntry(e);
    if (a.profile) {
      const f = a.facts[0];
      text = text.replace('## Facts', `## Profile\n${a.name} is as the sheet says [1].\n- [1] Under the Line, Ch 1: "${f.quote}" {book:${answers.book}, ch:${f.ch}}\n\n## Facts`);
    }
    fs.writeFileSync(path.join(dir, 'entries', a.id + '.md'), text);
  }
  const slips = answers.slips.map((s) => ({ chId: s.ch, sentence: s.sentence, span: s.span }));
  fs.writeFileSync(path.join(dir, 'slips.json'), JSON.stringify({ slips, worthALook: [] }));
}

test('the dev answer sheet quotes its chapters verbatim', () => {
  assert.deepEqual(Score.checkAnswers(answers, texts), []);
});

test('a perfect run scores 100% on every count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-score-'));
  try {
    perfectRun(dir);
    const s = Score.score({ answers, run: Score.readRun(dir), texts, slips: JSON.parse(fs.readFileSync(path.join(dir, 'slips.json'), 'utf8')) });
    assert.equal(s.entities.found, answers.entities.length);
    // said facts are kept as unverified, so recall counts all but them
    const said = answers.entities.flatMap((a) => a.facts).filter((f) => f.said).length;
    assert.equal(s.facts.all.found, s.facts.all.of - said);
    assert.equal(s.facts.must.found, s.facts.must.of);
    assert.equal(s.precision.wrong.length, 0, s.precision.wrong.join('\n'));
    assert.equal(s.precision.review.length, 0);
    assert.equal(s.slips.found, s.slips.of);
    assert.equal(s.slips.false.length, 0);
    assert.equal(s.profiles.cited, s.profiles.want);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the matcher: the value decides between two claims on one quote; traps and speech are wrong', () => {
  const hesper = answers.entities.find((a) => a.id === 'hesper');
  const pf = (attr, value, quote) => ({ attr, value, as: '', quotes: [quote] });
  const hair = 'Her hair was cropped close to the skull and fair as wet straw';
  assert.equal(Score.matchFact(pf('appearance.hair', 'blonde', hair), hesper.facts).fact.value, 'fair');
  assert.equal(Score.matchFact(pf('appearance.hair', 'cropped short', hair), hesper.facts).fact.value, 'cropped close to the skull');
  assert.equal(Score.matchFact(pf('appearance.hair', 'black', 'She tucked her black hair behind her ears'), hesper.facts), null);
  // an open label, mapped to the canonical set
  assert.equal(Score.canonLabel('Hair colour'), 'appearance.hair');
  assert.equal(Score.canonLabel('Job'), 'occupation');
  assert.equal(Score.attrScore('occupation', 'role'), 0.8);
  assert.equal(Score.matchFact(pf(Score.canonLabel('Lives in'), 'the Long Room', 'listened to the Long Room breathe'), hesper.facts).fact.attr, 'location.home');
  // unrelated claims match nothing
  assert.equal(Score.matchFact(pf('personality', 'cruel and loud', 'She stepped onto the brass plate.'), hesper.facts), null);
});

test('a run with a trap, a misquote, a said fact kept as true and an unknown claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-score-'));
  try {
    fs.mkdirSync(path.join(dir, 'entries'));
    const src = (quote, ch = 'c1') => [{ label: 'Under the Line, Ch 1', quote, book: answers.book, ch }];
    const e = Canon.newEntry('Hesper', 'person', 'hesper');
    e.facts.push({ attr: 'hair', value: 'black', as: '', state: 'verified', sources: src('She tucked her black hair behind her ears', 'c2') });
    e.facts.push({ attr: 'other', label: 'Age', value: 'fifteen', as: '', state: 'verified', sources: src('Hesper was fifteen and the tallest girl') });
    e.facts.push({ attr: 'other', label: 'Habit', value: 'bites her nails', as: '', state: 'verified', sources: src('Hesper bit her nails') });
    e.facts.push({ attr: 'other', label: 'Position', value: 'stands at the foot of her bed', as: '', state: 'verified', sources: src('She stood at the foot of her bed with her arms at her sides and waited.') });
    fs.writeFileSync(path.join(dir, 'entries', 'hesper.md'), Canon.serialiseEntry(e));
    const v = Canon.newEntry('the valley', 'place', 'the-valley');
    v.facts.push({ attr: 'other', label: 'Description', value: 'a town with a mill and too many dogs', as: '', state: 'verified', sources: src('Coll, who had come from there, said it was only a town with a mill and too many dogs.') });
    fs.writeFileSync(path.join(dir, 'entries', 'the-valley.md'), Canon.serialiseEntry(v));
    const s = Score.score({ answers, run: Score.readRun(dir), texts, slips: null });
    assert.equal(s.precision.supported, 1); // fifteen
    assert.equal(s.precision.wrong.length, 3, s.precision.wrong.join('\n')); // black (trap), nails (misquote), the mill (said)
    assert.ok(s.precision.wrong.some((w) => /trap/.test(w)));
    assert.ok(s.precision.wrong.some((w) => /not in the text/.test(w)));
    assert.equal(s.precision.review.length, 1); // her bed: true, not on the sheet: a person decides
    assert.equal(s.facts.must.found, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an older fixture\'s expected.json reads as an answer sheet', () => {
  const legacy = Score.readAnswers(path.join(__dirname, 'fixtures', 'canon', 'expected.json'));
  assert.ok(legacy.legacy);
  const ilsa = legacy.entities.find((x) => x.id === 'ilsa-varr');
  assert.ok(ilsa.facts.some((f) => f.attr === 'appearance.eyes' && f.value === 'grey' && f.weight === 'must'));
  assert.equal(legacy.slips.length, 6);
});
