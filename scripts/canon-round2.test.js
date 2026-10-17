'use strict';

// Round 2 of the editor's reading (READING.md §12): the failure types the
// held-out evaluation found, each held to a rule in code, on the builder's
// own dev2 stories (scripts/fixtures/canon-editor/dev2). No reader: these are
// the deterministic parts (cast identity, the narrator, whose a claim is,
// introductions, kin, open-fact clashes, speech, profiles).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const { shelfSources } = require('./canon-eval.js');

const E = Canon.Editor;
const DEV2 = path.join(__dirname, 'fixtures', 'canon-editor', 'dev2');
const chapter = (fx, book, ch) => E.chapterModel(Canon.sourceParas(fs.readFileSync(path.join(DEV2, fx, 'library', book, 'chapters', ch + '.html'), 'utf8')));
const castOf = (ch, proposals, entries = []) => {
  const cast = E.castGate({ proposals, ch, entries, names: Canon.shelfNames([ch.text]) });
  cast.forEach((c, i) => { c.key = i; });
  return cast;
};
const person = (name, aliases = [], sex = null) => ({ ...Canon.newEntry(name, 'person'), aliases, facts: sex ? [{ attr: 'sex', value: sex, as: '', state: 'yours', sources: [{ written: true }] }] : [] });

test('no entry for a month, a day, a holiday, a language, "Someone" or a title alone; a month that is a person may be one', () => {
  for (const w of ['July', 'March', 'Sundays', 'Easter', 'Welsh', 'Someone', 'Commander', 'Good Friday', 'Boxing Day']) assert.equal(Canon.nonEntity(w), true, w);
  for (const w of ['Moss', 'Tobiah', 'Halden Deep', 'the Salt House']) assert.equal(Canon.nonEntity(w), false, w);
  assert.equal(Canon.nonEntity('April'), true);
  assert.equal(Canon.nonEntity('April', 'person'), false);
  const ch = chapter('salt-house', 'book-the-salt-house-sh1', 'c1');
  const names = castOf(ch, [{ name: 'July', kind: 'thing' }, { name: 'Welsh', kind: 'thing' }, { name: 'Moss', kind: 'creature' }]).map((c) => c.name);
  assert.deepEqual(names, ['Moss']);
});

test('one person by the text\'s own words: a title off, a number for a name, an epithet given by "called her", a rank\'s role; never the one who does the calling', () => {
  const ch = chapter('ninth-watch', 'book-ninth-watch-hd1', 'c1');
  const cast = castOf(ch, [{ name: 'Teodora Kask', kind: 'person' }, { name: 'Nine', kind: 'person' }, { name: 'Ada', kind: 'person', aliases: ['Fourteen'] }, { name: 'Okafor', kind: 'person' },
    { name: 'Commander Okafor', kind: 'person' }, { name: 'Marek Voss', kind: 'person' }, { name: 'Voss', kind: 'person' }, { name: 'the commander', kind: 'person' }]);
  const by = Object.fromEntries(cast.map((c) => [c.name, c.aliases]));
  assert.deepEqual(by['Teodora Kask'], ['Nine']); // "Teodora Kask had been Nine for three years"
  assert.ok(by.Ada.includes('Fourteen'));
  assert.ok(by['Commander Okafor'].includes('Okafor') && by['Commander Okafor'].includes('the Old Woman')); // "The cadets called her the Old Woman"
  assert.deepEqual(by['Marek Voss'], ['Voss']);
  assert.equal(cast.length, 4);
  // "Constance called him Arthur": Arthur is the doctor's, not Constance's; "Mrs Haddon" and "Dr Haddon" are two people
  const br = chapter('brennock', 'book-the-doctor-br1', 'c1');
  const c2 = castOf(br, [{ name: 'Dr Haddon', kind: 'person' }, { name: 'Constance', kind: 'person' }, { name: 'Mrs Haddon', kind: 'person' }, { name: 'the doctor', kind: 'person' }, { name: 'Arthur', kind: 'person' }, { name: 'Old Man', kind: 'person', aliases: ['Dr Haddon'] }]);
  const doc = c2.find((c) => c.name === 'Dr Haddon');
  assert.ok(doc && doc.aliases.includes('Arthur') && doc.aliases.includes('the Old Man'), JSON.stringify(c2.map((c) => [c.name, c.aliases])));
  assert.ok(c2.find((c) => c.name === 'Constance').aliases.every((a) => !/Arthur|Haddon/.test(a)));
  assert.ok(c2.some((c) => c.name === 'Mrs Haddon'));
});

test('the narrator of a first-person story: found by the narration, named by "called me" and a name said to her face', () => {
  const ch = chapter('salt-house', 'book-the-salt-house-sh1', 'c1');
  assert.equal(E.firstPerson(ch), true);
  const cast = castOf(ch, [{ name: 'Granny Ruth', kind: 'person' }, { name: 'Tobiah', kind: 'person' }]);
  assert.deepEqual(E.narratorNames(ch, cast, Canon.shelfNames([ch.text]).lower), { name: 'Nell', aliases: ['Eleanor'] });
  // a third-person story has none, whatever its dialogue says
  for (const [fx, b] of [['ninth-watch', 'book-ninth-watch-hd1'], ['gull-street', 'book-gull-street-gs1'], ['brennock', 'book-the-doctor-br1']]) assert.equal(E.firstPerson(chapter(fx, b, 'c1')), false, fx);
});

test('whose a claim is: the clause\'s subject or a possessive just before it, an apposition, "called Moss"; never a neighbour in the sentence', () => {
  const owner = (fx, b, proposals, who, value, words) => {
    const ch = chapter(fx, b, 'c1');
    const cast = castOf(ch, proposals);
    const hits = E.chapterHits(ch, cast);
    const c = cast.find((x) => x.name === who);
    const s = ch.sents.find((x) => x.text.includes(words));
    const k = E.claimOwner({ s, why: 'name' }, E.content(value), c, { ch, hits, cast });
    return k == null ? null : cast[k].name;
  };
  const br = ['brennock', 'book-the-doctor-br1', [{ name: 'Brennock', kind: 'place' }, { name: 'the Sare', kind: 'place' }, { name: 'Dr Haddon', kind: 'person' }, { name: 'Constance', kind: 'person' }, { name: 'the Corn Exchange', kind: 'place' }, { name: 'Long Gallery', kind: 'place' }]];
  assert.equal(owner(...br, 'the Sare', 'grey slate town', 'grey slate'), 'Brennock');
  assert.equal(owner(...br, 'the Sare', 'three steep streets', 'grey slate'), 'Brennock'); // ("above the Sare": an object)
  assert.equal(owner(...br, 'Dr Haddon', 'a head taller', 'His wife'), 'Constance');
  assert.equal(owner(...br, 'the Corn Exchange', 'cold panelled room', 'clinic was'), null); // (after "in its Long Gallery": the reader's choice)
  const sh = ['salt-house', 'book-the-salt-house-sh1', [{ name: 'Tobiah', kind: 'person' }, { name: 'Moss', kind: 'creature' }, { name: 'the Salt House', kind: 'place' }, { name: 'Saltby', kind: 'place' }]];
  assert.equal(owner(...sh, 'Moss', 'black-and-white collie', 'collie'), 'Moss');
  assert.equal(owner(...sh, 'Tobiah', 'black-and-white collie', 'collie'), 'Moss');
  assert.equal(owner(...sh, 'the Salt House', 'brick, low and long', 'house itself'), 'the Salt House');
});

test('an introduction read by code: build, height, age, hair, marks, what they wear; never where they are or what they do there', () => {
  const ch = chapter('ninth-watch', 'book-ninth-watch-hd1', 'c1');
  const cast = castOf(ch, [{ name: 'Teodora Kask', kind: 'person' }, { name: 'Ada', kind: 'person' }, { name: 'Commander Okafor', kind: 'person' }]);
  const hits = E.chapterHits(ch, cast);
  const facts = (who, words) => {
    const c = cast.find((x) => x.name === who);
    const s = ch.sents.find((x) => x.text.includes(words));
    return E.introFacts({ s, why: /^(?:He|She)\b/.test(s.text) ? 'chain' : 'name' }, c, hits[s.pi], ch.paras[s.pi]).map((x) => `${x.a}: ${x.v}`);
  };
  assert.deepEqual(facts('Teodora Kask', 'She was nineteen'), ['age: nineteen', 'build: narrow', 'hair: a shaved head', 'mark: a burn scar across the back of her right hand']);
  assert.deepEqual(facts('Commander Okafor', 'grey-haired woman'), ['age: sixty', 'height: tall', 'hair: grey-haired', 'sex: woman']);
  assert.deepEqual(facts('Ada', 'Ada was in the galley'), []);
  assert.ok(!facts('Ada', 'Ada was Fourteen').some((x) => /^age/.test(x))); // (a number for a name is no age)
});

test('kin by the text\'s own words, each pair held to its first reading: the side (mother\'s, father\'s), the kind (brother, cousin); the notes against the prose wait', async () => {
  const run = async (fx, ents, narrators = {}) => {
    const sources = shelfSources(path.join(DEV2, fx, 'library'));
    const entries = ents.map(([n, a, s]) => person(n, a, s));
    const kin = Canon.kinMentions(sources, entries, narrators);
    const { slips } = await Canon.checkSources({ sources: sources.filter((s) => !s.notes), entries, kin, narrators });
    return { kin: kin.map((k) => `${k.b} is ${k.a}'s ${k.chain.join(' ')}${k.side ? ' (' + k.side + ')' : ''}${k.age ? ' [' + k.age + ']' : ''}`), slips: slips.map((s) => `${s.span}→${s.to}`) };
  };
  const sh = await run('salt-house', [['Nell', ['Eleanor'], 'female'], ['Uncle Tobiah', ['Tobiah'], 'male'], ['Granny Ruth', ['Ruth'], 'female']], { 'book-the-salt-house-sh1': 'nell' });
  assert.deepEqual(sh.kin, ["granny-ruth is nell's mother mother (mother)", "uncle-tobiah is nell's uncle", "uncle-tobiah is nell's mother brother (mother) [younger]", "uncle-tobiah is nell's father brother (father)"]);
  assert.deepEqual(sh.slips, ['father→mother']);
  const gs = await run('gull-street', [['Danny Fell', ['Danny'], 'male'], ['Kieran', [], 'male']]);
  assert.deepEqual(gs.slips, ['cousin→brother']);
  // the notes say elder, the prose younger: no slip (a question for the writer instead)
  const li = await run('lisle', [['Ivo Marchetti', ['Ivo'], 'male'], ['Tamsin Marchetti', ['Tamsin'], 'female']]);
  assert.equal(li.kin.length, 2);
  assert.deepEqual(li.slips, []);
  assert.ok(Canon.kinClash(...Canon.kinMentions(shelfSources(path.join(DEV2, 'lisle', 'library')), [person('Ivo Marchetti', ['Ivo'], 'male'), person('Tamsin Marchetti', ['Tamsin'], 'female')])));
});

test('open facts said otherwise: an age, a colour or a material of the same thing; never what is only said', () => {
  const d = (f, a, b, names) => (E.clashDetail({ attr: 'other', as: '', ...f }, a, b, names) || {}).span || null;
  assert.equal(d({ label: 'Age', value: 'twenty-six' }, 'He was twenty-six, by his file', 'At six o’clock Danny Fell, all twenty-nine years of him, asked to speak to her.', ['Danny Fell']), 'twenty-nine');
  assert.equal(d({ label: 'Age', value: 'twenty-six' }, 'He was twenty-six', 'Danny Fell was twenty-six that spring.', ['Danny Fell']), null);
  assert.equal(d({ label: 'Possessions', value: 'old Rover, a green P6 with a cracked windscreen' }, 'his old Rover', 'Dr Haddon drove his blue Rover down Bridge Street.', ['Dr Haddon']), 'blue');
  assert.equal(d({ label: 'Description', value: 'a sandstone hall on the market square' }, 'a sandstone hall', 'The red-brick Corn Exchange stood on the high side of the square.', ['the Corn Exchange']), 'red-brick');
  assert.equal(d({ label: 'Description', value: 'a stone barn with a tin roof' }, 'a stone barn with a tin roof', 'The barn smelt of apples and wet stone.', ['the press-house']), null);
  // the pass reads a reported clause as talk: "he was thirty-one, not twenty-six" is no slip
  const t = 'He told her that the old woman was blind as a bat and that he was thirty-one, not twenty-six, and could prove it.';
  assert.ok(Canon.reportedSpans(t).some(([a, b]) => a <= t.indexOf('thirty-one') && b >= t.indexOf('thirty-one')));
  const u = 'She was the clever one, their mother used to say; Ivo was the good one.';
  assert.deepEqual(Canon.reportedSpans(u).map(([a, b]) => u.slice(a, b)), ['She was the clever one, their mother used to say']);
});

test('a profile sentence uses only its facts\' values and labels, and names only what they name', () => {
  const facts = [{ label: 'Build', value: 'small, straight-backed', sources: [{ quote: 'She was a small, straight-backed woman with white hair' }] }];
  const e = { name: 'Granny Ruth', aliases: ['Ruth'] };
  assert.equal(E.profileOk('Granny Ruth is small and straight-backed', facts, e), true);
  // "white hair" is in the quote, not the fact: not hers to say from this fact
  assert.equal(E.profileOk('Granny Ruth is small, with white hair', facts, e), false);
  assert.equal(E.profileOk('Granny Ruth is small, like Tobiah', facts, e), false);
});
