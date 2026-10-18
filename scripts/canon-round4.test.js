'use strict';

// Round 4 (READING.md §14): the real Careful reader on four unseen stories
// kept a later value as a second fact under another label, kept moments as
// traits, gave a pet a man's "he", believed a group chat, split a nurse from
// her nickname and three generations into one, and wrote profiles that said
// more than their facts. The dev3 stories (scripts/fixtures/canon-editor/dev3)
// were written for those types, and canon-perfect.js's drift reader fails the
// same way on purpose; these tests hold the engine to what it must still do.

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const P = require('./canon-perfect.js');

const S = Canon.Slots;
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const N = (s) => Canon.norm(s);
const entry = (entries, name) => entries.find((e) => [e.name, ...e.aliases].some((n) => N(n) === N(name)));
const lines = (e) => (e ? e.facts.map((f) => `${Canon.labelOf(f)}: ${f.value} · ${f.state}`) : []);
const shown = (e) => (e ? e.facts.filter((f) => ['verified', 'yours', 'reading'].includes(f.state)) : []);

const runs = new Map();
async function run(name, mode = 'drift') {
  const k = name + '|' + mode;
  if (!runs.has(k)) runs.set(k, await P.runSheet(path.join(FIX, name), { mode, setting: P.SETTINGS[name] || '' }));
  return runs.get(k);
}
const slipOn = (r, words) => r.slips.find((s) => N(s.sentence).includes(N(words)));
const lookOn = (r, words) => r.asks.find((s) => N(s.sentence).includes(N(words)));

/* ---------- 1 · slots ---------- */

test('slots: a value\'s own shape says what it is a value of, whatever the label', () => {
  const got = (t, o) => S.claims(t, o).map((x) => `${x.slot}=${x.val}${x.sure ? '' : '?'}`);
  assert.deepEqual(got('Larch Ward was on the second floor of the east wing, a long room'), ['floor=2', 'wing=east']);
  assert.deepEqual(got('on the third-floor landing'), ['floor=3']);
  assert.deepEqual(got('Kerr’s Mill stood on the west bank of the Hobb'), ['bank=west']);
  assert.deepEqual(got('the bakery on Mill Lane'), ['street=mill lane']);
  assert.deepEqual(got('Her shift started at ten every night and ended at six'), ['time:start=600', 'time:end=360']);
  assert.deepEqual(got('Raff came on at eight, as she did every night'), ['time:start=480']);
  assert.deepEqual(got('Assembly in the Great Hall was at ten to nine every morning'), ['time:assembly=530']);
  assert.deepEqual(got('form tutor to Year Eleven'), ['year=11?']);
  assert.deepEqual(got('Hester Pell: teaches chemistry'), ['teaches=chemistry?']);
  assert.deepEqual(got('The science block stood next to the chapel, a red-brick building'), ['near=chapel?']);
  // a bare value, by its label: "Shift start: eight"
  assert.deepEqual(got('eight', { label: 'Shift start', bare: true }), ['time:start=480']);
  // no hour for "at ten years old", no floor for "nine floors"
  assert.deepEqual(got('at ten years old she left'), []);
  assert.deepEqual(got('The Lantern House had nine floors'), []);
});

test('slots: two values in one slot clash — sure when they can\'t both hold, a look when they may; an hour only between routines', () => {
  const c = (a, b) => { const x = S.clashOf(S.claims(a), S.claims(b)); return x ? (x.sure ? 'sure' : 'look') : null; };
  assert.equal(c('on the second floor of the east wing', 'on the third floor of the west wing'), 'sure');
  assert.equal(c('on the east bank', 'on the west bank'), 'sure');
  assert.equal(c('on Mill Lane', 'on Quay Road'), 'sure');
  assert.equal(c('by the ford', 'on Mill Lane'), null, 'a landmark and a street are two claims');
  assert.equal(c('next to the chapel', 'next to the sports hall'), 'look');
  assert.equal(c('Her shift started at ten every night', 'Raff came on at eight, as she did every night'), 'sure');
  assert.equal(c('Her shift started at ten every night', 'That night she came on at eight'), null, 'one late night is no routine');
  assert.equal(c('rose every morning at five', 'Her shift started at ten every night'), null, 'waking and a shift are two hours');
  assert.equal(c('teaches chemistry', 'taught biology'), 'look');
  // a person's floors are many things': only a place stands on one
  assert.deepEqual(S.factClaims({ label: 'Origin', value: 'born on the third floor' }, '', 'person'), []);
  // a sentence's claim is the entity's only in the clause it starts, with no one else between
  const about = (t, name, other = null) => {
    const at = [[t.indexOf(name), t.indexOf(name) + name.length]];
    const o = other ? [[t.indexOf(other), t.indexOf(other) + other.length]] : [];
    return S.claimsAbout(t, at, o, 'place').map((x) => `${x.slot}=${x.val}`);
  };
  assert.deepEqual(about('Larch Ward was on the third floor of the west wing.', 'Larch Ward'), ['floor=3', 'wing=west']);
  assert.deepEqual(about('Larch Ward was quiet; the third floor above it was empty.', 'Larch Ward'), []);
  assert.deepEqual(about('Larch Ward faced Rose Ward, on the third floor of the west wing.', 'Larch Ward', 'Rose Ward'), []);
  assert.deepEqual(about('Larch Ward had moved to the third floor of the west wing.', 'Larch Ward'), [], 'a change is no slip');
});

test('slots in a read: a later value under another label is never a second fact; the pass finds it (the drift reader says no to every slip question)', async () => {
  const nw = await run('dev3/night-ward');
  const ward = entry(nw.entries, 'Larch Ward');
  assert.ok(!shown(ward).some((f) => /third floor|west wing/.test(f.value)), lines(ward).join('\n'));
  assert.ok(slipOn(nw, 'Larch Ward was on the third floor'), 'the floor and wing slip');
  const km = await run('dev3/kerrs-mill');
  const mill = entry(km.entries, 'Kerr’s Mill');
  assert.ok(!shown(mill).some((f) => /west bank/.test(f.value)), lines(mill).join('\n'));
  assert.ok(slipOn(km, 'stood on the west bank'), 'the bank slip');
  const fr = await run('dev3/form-room');
  const hall = entry(fr.entries, 'the Great Hall');
  assert.ok(!shown(hall).some((f) => /half past eight/.test(f.value)), lines(hall).join('\n'));
  assert.ok(slipOn(fr, 'was at half past eight'), 'the assembly slip');
  // the science block's other neighbour: worth a look, never a slip
  assert.ok(!slipOn(fr, 'next to the sports hall'));
  assert.ok(lookOn(fr, 'next to the sports hall'), 'worth a look');
});

/* ---------- 2 · deeds ---------- */

test('deeds by rule: one done once, given later to another (a generation, a relative clause) is a slip with no question asked; done again, together, denied or said is none', () => {
  const mk = (id, name, kind, aliases = []) => ({ ...Canon.newEntry(name, kind, id), aliases });
  const ents = [mk('elder', 'Absalom Kerr the Elder', 'person', ['the Elder']), mk('younger', 'Absalom Kerr the Younger', 'person', ['the Younger']), mk('hester', 'Hester Pell', 'person', ['Hester']), mk('wilde', 'Jonah Wilde', 'person', ['Mr Wilde'])];
  const src = (id, ps) => ({ bookId: 'b', chId: id, book: 'B', label: id, html: ps.map((p) => `<p>${p}</p>`).join('') });
  const shelf = [
    src('c1', ['Absalom Kerr the Elder built the mill race at Hobb’s Ford in the spring of 1871.', 'Mr Wilde had planted the cedar on the front lawn.', 'The Younger kept the ledgers.']),
    src('c2', [
      'Visitors came to see the mill race, which Absalom Kerr the Younger had built in the spring of 1871.',
      'Nobody had touched the cedar that Hester Pell had planted on the front lawn.',
      'Hester planted a cedar of her own.',
      'The Younger built the mill race again after the flood.',
      'The Younger and the Elder built the mill race together, Sal thought.',
      '“The Younger built the mill race,” Sal said.',
      'Hester kept the ledgers that year.',
      'The Younger never built the mill race.'
    ])
  ];
  const slips = Canon.deedIndex(shelf, ents).filter((d) => d.against).map((d) => `${d.doer} ← ${d.against.doer}: ${d.sentence}`);
  assert.deepEqual(slips, [
    'younger ← elder: Visitors came to see the mill race, which Absalom Kerr the Younger had built in the spring of 1871.',
    'hester ← wilde: Nobody had touched the cedar that Hester Pell had planted on the front lawn.'
  ]);
});

test('deeds in a read: the drift reader (no to every who-did-it question) still meets both dev3 deed slips, and none is kept as the new doer\'s history', async () => {
  const km = await run('dev3/kerrs-mill');
  const s = slipOn(km, 'which Absalom Kerr the Younger had built');
  assert.ok(s && s.kind === 'event' && s.span === 'Absalom Kerr the Younger' && s.to === 'Absalom Kerr the Elder', JSON.stringify(s));
  const fr = await run('dev3/form-room');
  assert.ok(slipOn(fr, 'the cedar that Hester Pell had planted'));
  assert.ok(!shown(entry(fr.entries, 'Hester Pell')).some((f) => /cedar/.test(f.value)), lines(entry(fr.entries, 'Hester Pell')).join('\n'));
});

/* ---------- 3 · moments ---------- */

test('moments: a feeling, a posture or one scene\'s state is never a fact; one that recurs, lasts or describes the kind they are is', async () => {
  const nw = await run('dev3/night-ward');
  assert.ok(!shown(entry(nw.entries, 'Mrs Abbott')).some((f) => /cold|frightened/.test(f.value)), lines(entry(nw.entries, 'Mrs Abbott')).join('\n'));
  assert.ok(shown(entry(nw.entries, 'Maud Rafferty')).some((f) => /always early/.test(f.value)), 'always early stays: ' + lines(entry(nw.entries, 'Maud Rafferty')).join('\n'));
  const km = await run('dev3/kerrs-mill');
  assert.ok(!shown(entry(km.entries, 'Smut')).some((f) => /asleep|chest/.test(f.value)), lines(entry(km.entries, 'Smut')).join('\n'));
  assert.ok(!shown(entry(km.entries, 'Absalom Kerr the Younger')).some((f) => /cold|tired/.test(f.value)), lines(entry(km.entries, 'Absalom Kerr the Younger')).join('\n'));
  const fr = await run('dev3/form-room');
  assert.ok(!shown(entry(fr.entries, 'Hester Pell')).some((f) => /furious|folded/.test(f.value)), lines(entry(fr.entries, 'Hester Pell')).join('\n'));
  assert.ok(!shown(entry(fr.entries, 'Jonah Wilde')).some((f) => /frightened/.test(f.value)), 'the girls\' fear is no fact of his: ' + lines(entry(fr.entries, 'Jonah Wilde')).join('\n'));
  // QA's "He was quiet for a long while": no height, no nature, whatever the label
  const qa = await run('qa');
  assert.ok(!shown(entry(qa.entries, 'Tobias')).some((f) => /^(?:long|quiet)$/.test(f.value)), lines(entry(qa.entries, 'Tobias')).join('\n'));
});

test('moments by rule, word by word: the clause, the condition, the kind of one they are', () => {
  const ch = Canon.Editor.chapterModel(Canon.sourceParas([
    '<p>Mara was frightened of thunder, and always had been.</p>',
    '<p>Mara was cold and tired.</p>',
    '<p>Mara was a nervous woman with a nervous laugh.</p>',
    '<p>Mara rubbed her eyes when she was tired.</p>',
    '<p>Mara stood at the orchard gate.</p>',
    '<p>Mara sat very upright.</p>'
  ].join('')));
  const cast = [{ key: 0, name: 'Mara', kind: 'person', aliases: [] }];
  const hits = Canon.Editor.chapterHits(ch, cast);
  Canon.Editor.resolveRefs(ch, hits, cast, () => 'female');
  const pack = Canon.Editor.packFor(ch, hits, cast, cast[0], () => 'female');
  const part = Canon.Editor.packParts(pack)[0];
  const gate = (n, g, a, v) => Canon.Editor.gateFact({ g, a, v, s: [n] }, part, cast[0], { ch, text: ch.text, cast, hits, sexOf: () => 'female' }).why || 'kept';
  const at = (start) => part.lines.findIndex((l) => l.s.text.startsWith(start)) + 1;
  assert.equal(gate(at('Mara was frightened'), 'personality', 'fear', 'frightened of thunder'), 'kept');
  const gone = (why) => ['moment', 'once'].includes(why);
  assert.equal(gate(at('Mara was cold'), 'state', 'mood', 'cold and tired'), 'moment');
  assert.equal(gate(at('Mara was a nervous'), 'personality', 'nature', 'nervous'), 'kept');
  assert.ok(gone(gate(at('Mara rubbed'), 'state', 'condition', 'tired')));
  assert.ok(gone(gate(at('Mara stood'), 'state', 'mood', 'the orchard gate')));
  assert.notEqual(gate(at('Mara sat'), 'appearance', 'posture', 'sits very upright'), 'moment', 'a manner of sitting is no moment by this rule');
});

/* ---------- 4 · whose pronoun ---------- */

test('wrong subject: a man\'s he and his beside an animal never give it a sex; its own she does', async () => {
  const E = Canon.Editor;
  const ch = E.chapterModel(Canon.sourceParas('<p>The Younger sat late over the ledgers, and Smut, the mill cat, fell asleep on his chest. He was cold and tired.</p><p>Biscuit slept under the stove in winter, and she would let no one but the Younger lift her.</p>'));
  const cast = [{ key: 0, name: 'the Younger', kind: 'person', aliases: ['Younger'] }, { key: 1, name: 'Smut', kind: 'creature', aliases: [] }, { key: 2, name: 'Biscuit', kind: 'creature', aliases: [] }];
  const hits = E.chapterHits(ch, cast);
  E.resolveRefs(ch, hits, cast, () => null);
  const who = (pi, word) => { const p = ch.paras[pi]; const at = p.text.indexOf(word); const r = p.refs.get(at); return r ? cast[r.key].name : null; };
  assert.equal(who(0, 'his chest'), 'the Younger');
  assert.equal(who(0, 'He was'), 'the Younger');
  assert.equal(who(1, 'she would'), 'Biscuit');
  // in a read, with a reader that gives the cat the nearest he (the drift reader)
  const km = await run('dev3/kerrs-mill');
  assert.ok(!entry(km.entries, 'Smut').facts.some((f) => f.attr === 'sex'), lines(entry(km.entries, 'Smut')).join('\n'));
  assert.ok(entry(km.entries, 'Biscuit').facts.some((f) => f.attr === 'sex' && f.value === 'female' && f.state === 'verified'), lines(entry(km.entries, 'Biscuit')).join('\n'));
  // (and Moss, "a collie bitch called Moss", is still the she of the sentences after: Lyle's dog, never the narrator)
  const sh = await run('dev2/salt-house', 'adversarial');
  for (const name of ['Nell', 'Uncle Tobiah']) assert.ok(!shown(entry(sh.entries, name)).some((f) => /range|come to/.test(f.value)), lines(entry(sh.entries, name)).join('\n'));
});

/* ---------- 5 · speech with no quotation marks ---------- */

test('speech: a chat line, a letter and a radio call are someone\'s words, though no quotation mark says so; the writer\'s notes are not', async () => {
  const src = (chId, ps, extra = {}) => ({ bookId: 'b', chId, book: 'B', label: chId, html: ps.map((p) => `<p>${p}</p>`).join(''), ...extra });
  const story = src('c1', [
    'At half past ten the desk phone lit up with the night team’s chat.',
    'Okoro: Abbott’s son rang. The barrister. Coming at nine tomorrow',
    'Raff: She’s ninety-one, she won’t remember',
    'Mrs Abbott was eighty-seven.',
    'Dear girls, the school has never once closed its doors. Yours in faith, Bishop Crane.',
    'Bravo Two, this is Control, the bridge is down, over.',
    'Note: the lift was broken.'
  ]);
  const notes = src('n1', ['Ivo Marchetti: thirty-four, foreman of the Lisle orchard.', 'Clem: Ivo’s grey mare.'], { notebook: true });
  const talk = Canon.proseTalk([story, notes]);
  for (const t of ['Okoro: Abbott’s son rang. The barrister. Coming at nine tomorrow', 'Raff: She’s ninety-one, she won’t remember', 'Dear girls, the school has never once closed its doors. Yours in faith, Bishop Crane.', 'Bravo Two, this is Control, the bridge is down, over.']) assert.ok(talk.has(t), t);
  for (const t of ['Mrs Abbott was eighty-seven.', 'Ivo Marchetti: thirty-four, foreman of the Lisle orchard.', 'Clem: Ivo’s grey mare.', 'Note: the lift was broken.', 'At half past ten the desk phone lit up with the night team’s chat.']) assert.ok(!talk.has(t), t);
  // a single "Name: words" line in a story, with nothing about a phone or a chat, is no chat
  assert.equal(Canon.proseTalk([src('c9', ['Rain all week.', 'Ivo: he would remember this.', 'The orchard was quiet.'])]).size, 0);
  // in a read: the chat's barrister and ninety-one are what's said (never checked); the narration's are the facts
  const nw = await run('dev3/night-ward');
  const gerald = entry(nw.entries, 'Gerald Abbott');
  assert.ok(!gerald.facts.some((f) => /barrister/i.test(f.value) && f.state === 'verified'), lines(gerald).join('\n'));
  assert.ok(gerald.facts.some((f) => /insurance/.test(f.value) && f.state === 'verified'), lines(gerald).join('\n'));
  const ida = entry(nw.entries, 'Mrs Abbott');
  assert.ok(!ida.facts.some((f) => /ninety-one/.test(f.value) && f.state === 'verified'), lines(ida).join('\n'));
  const fr = await run('dev3/form-room');
  const school = entry(fr.entries, 'Saint Aldhelm’s');
  assert.ok(!school.facts.some((f) => /never once closed/.test(f.value) && f.state === 'verified'), lines(school).join('\n'));
  assert.ok(!slipOn(fr, 'Dear girls'), 'no slip in the letter');
});

/* ---------- 6 · who is who ---------- */

test('identity: a surname\'s nickname joins its one full name; generations of one name stay apart by their epithets; a breed is an animal', async () => {
  const nw = await run('dev3/night-ward');
  const raff = entry(nw.entries, 'Raff');
  assert.ok(raff && /Rafferty/.test(raff.name), raff && raff.name);
  assert.ok(shown(raff).some((f) => /tall, rawboned/.test(f.value)) && shown(raff).some((f) => /ten every night/.test(f.value)), lines(raff).join('\n'));
  const km = await run('dev3/kerrs-mill');
  assert.ok(!entry(km.entries, 'Absalom Kerr') && !entry(km.entries, 'Absalom'), km.entries.map((e) => e.name).join(', '));
  const elder = entry(km.entries, 'the Elder');
  const younger = entry(km.entries, 'the Younger');
  assert.equal(elder.name, 'Absalom Kerr the Elder');
  assert.equal(younger.name, 'Absalom Kerr the Younger');
  assert.ok(!elder.aliases.includes('Elder') && !younger.facts.some((f) => /^(?:Elder|Younger)$/.test(f.value)), lines(younger).join('\n'));
  assert.ok(shown(elder).some((f) => f.attr === 'eyes' && f.value === 'grey') && shown(younger).some((f) => f.attr === 'eyes' && f.value === 'blue'));
  assert.equal(entry(km.entries, 'Biscuit').kind, 'creature', 'a wire-haired terrier, though the reader said person');
  // one name the reader gave as one person: the text's own forms are the people
  const E = Canon.Editor;
  const ch = E.chapterModel(Canon.sourceParas('<p>Absalom Kerr the Elder built the race.</p><p>His son, Absalom Kerr the Younger, kept the ledgers. The Younger was impatient.</p><p>Absalom Kerr was a name the valley knew.</p>'));
  const cast = E.castGate({ proposals: [{ name: 'Absalom Kerr', kind: 'person', aliases: [] }], ch, entries: [], names: Canon.shelfNames([ch.text]) });
  assert.deepEqual(cast.map((c) => c.name).sort(), ['Absalom Kerr the Elder', 'Absalom Kerr the Younger']);
  assert.ok(cast.find((c) => c.name === 'Absalom Kerr the Younger').aliases.includes('the Younger'));
  // a nickname beside two names it could be is no one's
  const ch2 = E.chapterModel(Canon.sourceParas('<p>Maud Rafferty and Lena Raffles worked nights.</p><p>Raff knew every patient.</p>'));
  const cast2 = E.castGate({ proposals: [{ name: 'Maud Rafferty', kind: 'person' }, { name: 'Lena Raffles', kind: 'person' }, { name: 'Raff', kind: 'person' }], ch: ch2, entries: [], names: Canon.shelfNames([ch2.text]) });
  assert.ok(cast2.some((c) => c.name === 'Raff'), cast2.map((c) => c.name).join(', '));
});

test('identity: a number turned round is no new place but a slip on the kept one when the text ties them, worth a look when it doesn\'t; both written, two places', async () => {
  const nw = await run('dev3/night-ward');
  assert.ok(!entry(nw.entries, 'Room 41'), nw.entries.map((e) => e.name).join(', '));
  const s = slipOn(nw, 'Room 41');
  assert.ok(s && s.kind === 'name' && s.to === 'Room 14' && !s.ask, JSON.stringify(s));
  assert.ok(!shown(entry(nw.entries, 'Mrs Abbott')).some((f) => /41/.test(f.value)));
  const room = { ...Canon.newEntry('Room 14', 'place', 'room-14'), facts: [{ attr: 'other', label: 'Residents', value: 'Mrs Abbott', state: 'verified', sources: [{ label: 'B, c1', quote: 'Mrs Abbott had been in Room 14', book: 'b', ch: 'c1' }] }] };
  const abbott = { ...Canon.newEntry('Mrs Abbott', 'person', 'abbott'), aliases: [] };
  const src = (ps) => ({ bookId: 'b', chId: 'c2', book: 'B', label: 'c2', html: ps.map((p) => `<p>${p}</p>`).join('') });
  assert.equal(Canon.turnedNumbers(src(['Gerald went up to Room 41.']), [room, abbott])[0].tied, null, 'untied: worth a look');
  assert.equal(Canon.turnedNumbers(src(['Room 14 was empty, and Room 41 was full.']), [room, abbott]).length, 0, 'both written: two rooms');
  assert.ok(Canon.turnedNumbers(src(['She took Mrs Abbott her tea in Room 41.']), [room, abbott])[0].tied);
});

/* ---------- 7 · profiles ---------- */

test('profiles say only what their facts say: no word picked out of a value, no "never" dropped or added, a look keeps its word, a where its preposition, a deed is no "is"', () => {
  const E = Canon.Editor;
  const e = { name: 'Ivo Marchetti', aliases: ['Ivo'] };
  const F = (label, value, as = '') => ({ attr: 'other', label, value, as });
  const ok = (t, facts) => E.profileOk(t, facts, e) && E.profileEntailed(t, facts, e);
  assert.equal(ok('Ivo Marchetti is the foreman of the Lisle orchard', [F('Work', 'foreman of the Lisle orchard')]), true);
  assert.equal(ok('Ivo Marchetti is a foreman', [F('Work', 'foreman of the Lisle orchard')]), true, 'a value\'s head may stand for it');
  assert.equal(ok('Ivo Marchetti is the Lisle orchard', [F('Work', 'foreman of the Lisle orchard')]), false, 'its complement never does');
  assert.equal(ok('Ivo has never touched a drop of the cider', [F('Habit', 'has never touched a drop of the cider')]), true);
  assert.equal(ok('Ivo has touched a drop of the cider', [F('Habit', 'has never touched a drop of the cider')]), false, 'a never dropped');
  assert.equal(ok('Ivo never drinks the cider', [F('Habit', 'drinks the cider')]), false, 'a never added');
  assert.equal(ok('Ivo Marchetti is green', [F('Eye look', 'green')]), false, 'the eyes\' colour is no person\'s');
  assert.equal(ok('Ivo Marchetti has green eyes', [F('Eye look', 'green')]), true);
  assert.equal(ok('Ivo Marchetti is the end', [F('Location', 'at the end of the row')]), false);
  assert.equal(ok('Ivo Marchetti is the accident', [F('History', 'the accident')]), false);
  assert.equal(ok('Ivo Marchetti is male (man)', [F('Sex', 'male', 'man')]), false, 'no brackets');
  assert.equal(ok('Tamsin is thirty-four', [F('Age', 'thirty-four')]), false, 'it opens with whom it is about');
});

test('profiles in a read: the drift reader\'s sentences that say more than their facts are left out; the reader is asked both ways', async () => {
  let kept = 0;
  let bad = 0;
  for (const fx of [...P.FIXTURES, ...P.DEV3]) {
    const r = await P.runSheet(fx, { mode: 'drift', setting: P.SETTINGS[path.relative(FIX, fx)] || '' });
    const x = P.summary(r);
    kept += x.profOf;
    bad += x.profBad;
  }
  assert.ok(kept >= 40, 'profiles kept ' + kept);
  assert.equal(bad, 0);
  // a reader that says a sentence says more than its facts: left out
  const reader = Canon.fakeReader({ entails: ['Mara Venn is a thirty-four'] , ...JSON.parse(require('node:fs').readFileSync(path.join(FIX, 'qa', 'reader-answers.json'), 'utf8')) });
  const fs = require('node:fs');
  const os = require('node:os');
  const { folderIO } = require('./canon-eval.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-r4-'));
  const lib = path.join(root, 'library');
  fs.cpSync(path.join(FIX, 'qa', 'library'), lib, { recursive: true });
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  let cache = null;
  const io = { ...folderIO(lib, path.join(lib, library.shelves[0].canonId)), cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); } };
  await Canon.createEngine({ io, reader }).readShelf({});
  const mara = io.entries().map((x) => Canon.parseEntry(x.text)).find((x) => x.name === 'Mara Venn');
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(mara.profile && !/thirty-four/.test(mara.profile.text) && /Coldharbour/.test(mara.profile.text), mara.profile && mara.profile.text);
});
