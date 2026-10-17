// NEO — Canon's editor reading (docs/semantics/READING.md): how a reader
// that can read a chapter at a time reads one, the way a story editor would.
//
//   1 CAST      the reader lists who and what the chapter names; code keeps
//               the names written as written, joins aliases the text ties
//   2 PACKS     code gathers each one's sentences: those naming it, the
//               pronouns after them, a place's paragraph, the setting's chapter
//   3 DOSSIERS  the reader lists facts about each one, citing sentence ids;
//               code copies the writer's words for the quote
//   4 GATES     cited, tied, grounded, not from a slip's sentence, then the
//               reader's yes (twice for what is read between the lines)
//   5 EDITOR    code merges and orders; the reader writes a short profile
//               from the kept facts, every word of it checked against them
//
// No I/O, like canon.js, which loads this with its own helpers (`C`) and
// runs it from the engine's Read the Shelf. The reader proposes, code
// decides; nothing here writes a word into a book.
'use strict';

module.exports = function canonEditor(C) {
  const { norm, normMap, textHash, sentences, speechSpans, reportedSpans, mentions, mentionIndex, wordsOf, slug, newEntry,
    findEntry, misspelt, gateQuote, PRONOUNS, SEX_WORDS, COLOURS, SPECIES, TITLES, LEADERS, canonLabel, labelFamily } = C;

  // bumped when a prompt or a gate that the cache keeps answers for changes
  const EDITOR_PROMPT = 1;

  /* ---------- words ---------- */

  const STOPW = new Set(('a an the and or but of to in on at by for with from into onto as is was were be been being are it its it\'s this that these those ' +
    'her his him he she they them their there here who whom which what when where while than then so very much more most some any all ' +
    'has have had do does did nor only own same such too can will would could should may might must just also each ' +
    'one once up down out over under again further about above below after before between through during without within ' +
    'i me my we our you your himself herself itself themselves s like how even still yet whose').split(' '));
  const NEGATORS = new Set(['no', 'not', 'never', 'none', 'nothing', 'nobody', 'nowhere', 'neither', 'nor', 'without', "n't", 'cannot', 'windowless']);
  const VARIANT = { gray: 'grey', colour: 'color', colored: 'color', coloured: 'color', blond: 'blonde' };
  // one word in a common form: plural, past, -ing, -ly off
  function stem(w) {
    w = VARIANT[w] || w;
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('ly')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  // Words a value may use for the text's own: "girl" says female, "tallest"
  // says tall, "not one window" says no windows. Each group's words stand for
  // each other; nothing here turns one claim into another.
  const LEXICON = [
    ['female', 'woman', 'girl', 'lady', 'she', 'her', 'mare', 'sister', 'mother', 'daughter', 'wife'],
    ['male', 'man', 'boy', 'gentleman', 'he', 'him', 'his', 'brother', 'father', 'son', 'husband'],
    ['tall', 'tallest', 'taller'], ['short', 'shorter', 'shortest'], ['old', 'older', 'oldest', 'elderly', 'aged'], ['young', 'younger', 'youngest'],
    ['thin', 'thinner', 'narrow', 'skinny', 'lean', 'slight'], ['fair', 'blonde', 'flaxen'], ['spectacle', 'glass', 'glasses'],
    ['no', 'not', 'none', 'never', 'without', 'nothing', 'windowless'], ['window', 'windowless'], ['every', 'each', 'always', 'daily'],
    ['morning', 'dawn', 'daybreak'], ['sick', 'ill'], ['gentle', 'gently'], ['friend', 'friendship'], ['born', 'birth', 'birthplace'],
    ['hum', 'humm', 'hummed'], ['lock', 'locked', 'unlock', 'unlocked'], ['weigh', 'weighing', 'weighed', 'weight', 'weigher'],
    ['child', 'children', 'kid'], ['number', 'numbered'], ['ink', 'inked', 'tattoo'], ['smell', 'smelled', 'smelt', 'scent'],
    ['light', 'lit', 'lamp'], ['forty', '40'], ['fifteen', '15'], ['twelve', '12'], ['six', '6'], ['three', '3'], ['two', '2'], ['one', '1'],
    ['hair', 'haired'], ['eye', 'eyes', 'eyed'], ['live', 'lives', 'lived', 'living', 'sleep', 'sleeps', 'slept'], ['wear', 'wore', 'worn', 'wearing'],
    ['carry', 'carried', 'carries'], ['write', 'wrote', 'written', 'writes'], ['drink', 'drank', 'drunk', 'drinking'], ['come', 'came'],
    ['say', 'said', 'says'], ['keep', 'kept', 'keeps'], ['learn', 'learned', 'learnt'], ['go', 'went', 'goes', 'gone'], ['run', 'ran', 'running'],
    ['give', 'gave', 'given'], ['take', 'took', 'taken'], ['see', 'saw', 'seen'], ['know', 'knew', 'known'], ['stand', 'stood'], ['sit', 'sat'],
    ['line', 'lined'], ['prick', 'pricked', 'pricks', 'needle'], ['blood', 'bead']
  ].map((g) => g.map(stem));
  const LEX = new Map();
  for (const [i, g] of LEXICON.entries()) for (const w of g) { if (!LEX.has(w)) LEX.set(w, new Set()); LEX.get(w).add(i); }
  const tokens = (s) => norm(s).replace(/['’]s\b/g, '').replace(/n't\b/g, ' not').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const content = (s) => tokens(s).filter((w) => !STOPW.has(w) || NEGATORS.has(w)).map(stem);
  // does `w` (a stem) stand in `bag` (a Set of stems), itself or through the lexicon
  const inBag = (w, bag) => bag.has(w) || [...(LEX.get(w) || [])].some((g) => LEXICON[g].some((x) => bag.has(x)));
  const negated = (s) => tokens(s).some((w) => NEGATORS.has(w));
  const NUMBER = /^(?:\d+(?:st|nd|rd|th)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twelfth)$/;

  /* ---------- a chapter's sentences ---------- */

  // Paragraphs and their sentences, numbered through the chapter, each
  // knowing what in it is speech (quoted) or talk (reported).
  function chapterModel(paras) {
    const all = [];
    const out = paras.map((p, pi) => {
      const talk = speechSpans(p.text).concat(reportedSpans(p.text));
      const speech = speechSpans(p.text);
      const sents = sentences(p.text).map((s) => {
        const said = speech.some(([a, b]) => s.start >= a && s.end <= b + 1);
        const x = { id: all.length + 1, pi, start: s.start, end: s.end, text: s.text, said, talk: talk.filter(([a, b]) => a < s.end && b > s.start) };
        all.push(x);
        return x;
      });
      return { pi, text: p.text, hash: p.hash, sents, talk };
    });
    return { paras: out, sents: all, text: paras.map((p) => p.text).join('\n') };
  }

  /* ---------- 1 · the cast ---------- */

  const KINDS = ['person', 'creature', 'place', 'group', 'thing', 'rule'];
  const ROOMS = /(?<![\p{L}])(?:room|hall|chamber|kitchen|cell|corridor|yard|office|attic|cellar|stair|stairs|landing|ward|dormitory|gate|door)s?$/iu;
  // nouns for many people, not one: never a role name
  const CROWD = new Set(['children', 'child', 'girls', 'boys', 'girl', 'boy', 'others', 'people', 'everyone', 'everybody', 'someone', 'nobody', 'crowd', 'men', 'women', 'man', 'woman', 'kids', 'line', 'rest', 'novices', 'students', 'pupils', 'class', 'family', 'one', 'ones', 'two', 'three', 'stranger', 'figure', 'voice']);
  // the parts and furniture of any room, and the stuff of every page: never an entry by themselves
  const FIXTURES = new Set(['door', 'doors', 'floor', 'floors', 'wall', 'walls', 'window', 'windows', 'ceiling', 'room', 'rooms', 'bed', 'beds', 'table', 'chair', 'corner', 'stairs', 'stair', 'roof', 'ground', 'light', 'air', 'cup', 'jug', 'plate', 'tray', 'hand', 'hands', 'face', 'head', 'eyes', 'hair', 'feet', 'thumb', 'aisle', 'sky', 'night', 'day', 'morning', 'bell', 'line', 'rules', 'rule', 'pocket', 'smock', 'blanket', 'cloth', 'way', 'end', 'side', 'top', 'feeling', 'turn', 'time']);
  const NAMING = /(?<![\p{L}])(?:name|names|named|called|calls|call|known as|nicknamed|nickname|went by)(?![\p{L}])/iu;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // how often the chapter writes `phrase`, as written (capitals kept) or,
  // for a role, with a capital The at a sentence's start
  function written(text, phrase) {
    const role = /^the\s/i.test(phrase) && /^\p{Ll}/u.test(phrase.replace(/^the\s+/i, ''));
    const body = role ? `[Tt]he\\s+[“"‘']?${escRe(phrase.replace(/^the\s+/i, ''))}[”"’']?` : escRe(phrase);
    return (text.match(new RegExp(`(?<![\\p{L}\\p{N}'’-])${body}(?![\\p{L}\\p{N}])`, 'gu')) || []).length;
  }
  // a cast name as Canon keeps it: as written; a role keeps its "the"
  function cleanName(n) {
    let name = String(n || '').replace(/[“”"«»]/g, '').replace(/\s+/g, ' ').trim();
    const lead = name.split(' ');
    while (lead.length > 1 && LEADERS.has(lead[0].toLowerCase()) && lead[0].toLowerCase() !== 'the') lead.shift();
    name = lead.join(' ');
    if (/^The\s+\p{Ll}/u.test(name)) name = 'the' + name.slice(3);
    return name;
  }
  // Is this a name the chapter gives someone or something? → 'proper',
  // 'role' (the warden: lower case, written twice or more) or null
  function nameKind(name, text, lower, kind) {
    if (!name || name.length < 2 || name.length > 40) return null;
    const bare = name.replace(/^the\s+/i, '');
    if (!bare || PRONOUNS[bare.toLowerCase()] || /^(?:i|we|you|they|it|them|us|me)$/i.test(bare)) return null;
    if (/^\p{Lu}/u.test(bare)) {
      // every word capitalised but the small ones inside ("House of Varr")
      const parts = bare.split(/\s+/);
      if (!parts.every((w, i) => /^[\p{Lu}\p{N}]/u.test(w) || (i > 0 && i < parts.length - 1 && /^(?:of|the|de|du|da|del|la|le|van|von|der|and|on|upon)$/.test(w)))) return null;
      if (!written(text, bare)) return null;
      // a word the shelf writes in lower case too: "Nobody", "Ponies"
      if (parts.length === 1 && lower && lower.has(bare.toLowerCase()) && !written(text, 'the ' + bare)) return null;
      if (parts.length === 1 && TITLES.has(bare.toLowerCase())) return null;
      return 'proper';
    }
    // a role: "the warden", one or two lower-case words with "the", written twice
    if (kind === 'rule') return null;
    const words = bare.split(/\s+/);
    if (words.length > 2 || words.some((w) => !/^\p{Ll}[\p{Ll}'’-]*$/u.test(w))) return null;
    if (CROWD.has(words[words.length - 1]) || FIXTURES.has(words[words.length - 1])) return null;
    if (written(text, 'the ' + bare) < 2) return null;
    return 'role';
  }


  // The capitalised names a chapter writes that aren't a sentence's first
  // word, a title or a word it also writes in lower case: Hesper, the Long
  // Room, the Weighhouse. Given to the reader so it overlooks none.
  function writtenNames(ch, names) {
    const out = new Map();
    const lower = (names && names.lower) || new Set();
    for (const p of ch.paras) {
      for (const s of p.sents) {
        for (const m of s.text.matchAll(/(?<![\p{L}\p{N}'’-])(\p{Lu}[\p{Ll}'’-]+(?:\s+(?:of\s+(?:the\s+)?)?\p{Lu}[\p{Ll}'’-]+)*)/gu)) {
          const lead = s.text.slice(0, m.index);
          if (!/[\p{L}\p{N}]/u.test(lead) || /[“"‘«:]\s*$/.test(lead)) continue; // a sentence's (or a quotation's) first word
          const w = m[1].replace(/['’]s$/, '');
          if (w.split(/\s+/).length === 1 && (lower.has(w.toLowerCase()) || TITLES.has(w.toLowerCase()) || PRONOUNS[w.toLowerCase()] || /^I$/.test(w))) continue;
          out.set(w, (out.get(w) || 0) + 1);
        }
      }
    }
    return [...out.keys()].slice(0, 30);
  }

  // The reader's cast, through the gates. → [{ key, name, kind, aliases, in, entry }]
  function castGate({ proposals, ch, entries, names, setting = '' }) {
    const text = ch.text;
    const lower = names && names.lower;
    const cast = [];
    const find = (n) => cast.find((c) => [c.name, ...c.aliases].some((a) => norm(a) === norm(n) || norm(a.replace(/^the\s+/i, '')) === norm(n.replace(/^the\s+/i, ''))));
    for (const p of proposals || []) {
      const kind = KINDS.includes(p.kind) ? p.kind : 'thing';
      const name = cleanName(p.name);
      const how = nameKind(name, text, lower, kind);
      if (!how || misspelt(name.replace(/^the\s+/i, ''), entries)) continue;
      // a thing or rule called only by a lower-case word, said once or twice, is no entry
      // (a proper name the text writes with "the": "the Weighhouse", "the Long Room")
      const named = how === 'proper' && !/^the\s/i.test(name) && written(text, 'the ' + name) && written(text, 'the ' + name) + written(text, 'The ' + name) >= written(text, name) ? 'the ' + name : name;
      let c = find(named);
      if (!c) {
        c = { key: cast.length, name: named, kind, aliases: [], in: '', proper: how === 'proper', wanted: [] };
        cast.push(c);
      }
      c.wanted.push(...(p.aliases || []).map(cleanName).filter((a) => a && norm(a) !== norm(name)));
      if (p.in && !c.in) c.in = cleanName(p.in);
    }
    // the scare-quoted capitalised term the chapter defines: the “Spared”
    for (const m of text.matchAll(/[“"]\s*(\p{Lu}[\p{Ll}]{2,}(?:\s\p{Lu}[\p{Ll}]{2,})?)\s*[”"]/gu)) {
      const w = m[1];
      if (find(w) || find('the ' + w) || written(text, w) < 2 || (lower && lower.has(w.toLowerCase()))) continue;
      cast.push({ key: cast.length, name: written(text, 'the ' + w) ? 'the ' + w : w, kind: 'group', aliases: [], in: '', proper: true, wanted: [] });
    }
    // aliases: the same one called otherwise ("Weighhouse" for "the
    // Weighhouse"), or a name the text gives the one its pronoun means ("The
    // children called him Brother Ink", "His name … was Anselm"): each tie
    // joins the name to the words the text last used for that one ("the
    // weigher"). Names the reader offered as aliases count only when so tied.
    const ties = namingTies(ch, cast);
    const bare = (n) => norm(String(n).replace(/^the\s+/i, ''));
    const tied = new Map(); // bare phrase → Set of bare phrases
    const link = (x, y) => { for (const [a, b] of [[x, y], [y, x]]) { if (!tied.has(a)) tied.set(a, new Set()); tied.get(a).add(b); } };
    for (const t of ties) link(bare(t.ref), bare(t.name));
    const group = (n) => { const seen = new Set([bare(n)]); const todo = [bare(n)]; while (todo.length) for (const x of tied.get(todo.pop()) || []) if (!seen.has(x)) { seen.add(x); todo.push(x); } return seen; };
    for (const c of cast) {
      if (c.gone) continue;
      const mine = new Set([...group(c.name), ...c.aliases.flatMap((a) => [...group(a)])]);
      for (const a of c.wanted) {
        if (!nameKind(a, text, lower, c.kind)) continue;
        if (bare(a) !== bare(c.name) && !mine.has(bare(a))) continue;
        const other = find(a);
        if (other && other !== c && !other.gone) mergeCast(cast, c, other);
        else if (!other && !c.aliases.some((x) => norm(x) === norm(a))) c.aliases.push(a);
      }
      // the names and roles the text ties to this one, as written
      for (const x of mine) {
        if (x === bare(c.name)) continue;
        const other = cast.find((y) => y !== c && !y.gone && [y.name, ...y.aliases].some((n) => bare(n) === x));
        if (other) { mergeCast(cast, c, other); continue; }
        const t = ties.find((y) => bare(y.name) === x || bare(y.ref) === x);
        const as = t ? (bare(t.name) === x ? t.name : t.ref) : null;
        if (as && nameKind(as, text, lower, c.kind) && !c.aliases.some((y) => bare(y) === x)) c.aliases.push(as);
      }
    }
    // the name the text gives a role is its name: "His name … was Anselm"
    for (const t of ties.filter((y) => y.given)) {
      const c = cast.find((y) => !y.gone && [y.name, ...y.aliases].some((n) => bare(n) === bare(t.name)));
      if (c && bare(c.name) !== bare(t.name)) { const was = c.name; c.name = t.name; c.aliases = [was, ...c.aliases.filter((x) => bare(x) !== bare(t.name))]; c.proper = true; }
    }
    // a role keeps its bare word as an alias too ("warden" for "the warden")
    for (const c of cast) {
      if (/^the\s/i.test(c.name) && !c.aliases.some((a) => norm(a) === norm(c.name.slice(4)))) c.aliases.push(c.name.slice(4));
      for (const a of [...c.aliases]) if (/^the\s/i.test(a) && !c.aliases.some((x) => norm(x) === norm(a.slice(4)))) c.aliases.push(a.slice(4));
      c.aliases = c.aliases.filter((a, i, all) => norm(a) !== norm(c.name) && all.findIndex((x) => norm(x) === norm(a)) === i);
    }
    const kept = cast.filter((c) => !c.gone);
    // joined to the Canon's entries by name or alias
    for (const c of kept) {
      c.entry = [c.name, ...c.aliases].map((n) => findEntry(entries, n)).find(Boolean) || null;
      if (c.entry && c.entry.locked) c.skip = true;
    }
    // the setting: the building, institution or town the reader says the
    // chapter is set in, when it is a place of the cast (else none). The
    // place proposed only as the setting joins the cast.
    if (setting) {
      const name = cleanName(setting);
      const bare = (n) => norm(String(n).replace(/^the\s+/i, ''));
      let c = kept.find((x) => [x.name, ...x.aliases].some((n) => bare(n) === bare(name)));
      if (!c && nameKind(name, text, lower, 'place') === 'proper' && !misspelt(name.replace(/^the\s+/i, ''), entries)) {
        c = { key: cast.length, name: written(text, 'the ' + name.replace(/^the\s+/i, '')) ? 'the ' + name.replace(/^the\s+/i, '') : name.replace(/^the\s+/i, ''), kind: 'place', aliases: [], in: '', proper: true, wanted: [] };
        if (/^the\s/i.test(c.name)) c.aliases.push(c.name.slice(4));
        kept.push(c);
        c.entry = [c.name, ...c.aliases].map((n) => findEntry(entries, n)).find(Boolean) || null;
      }
      // (a building, institution, town or ship: never one room of it)
      if (c && c.kind === 'place' && !ROOMS.test(c.name)) c.setting = true;
    }
    return kept.filter((c) => !c.skip);
  }
  function mergeCast(cast, into, from) {
    for (const a of [from.name, ...from.aliases]) if (!into.aliases.some((x) => norm(x) === norm(a)) && norm(a) !== norm(into.name)) into.aliases.push(a);
    if (!into.proper && from.proper) { const was = into.name; into.name = from.name; into.aliases = [was, ...into.aliases.filter((x) => norm(x) !== norm(from.name))]; into.proper = true; }
    if (!into.in && from.in) into.in = from.in;
    from.gone = true;
    from.name = '\u0000';
    from.aliases = [];
  }
  // "His name, Hesper had once heard the warden say, was Anselm"; "The
  // children called him Brother Ink"; "known as the Hound": a name the text
  // gives the one its pronoun means (the last named before it, in narration)
  function namingTies(ch, cast) {
    const out = [];
    const plain = (xs) => xs.flatMap((a) => /^the\s/i.test(a) ? [a, a.slice(4)] : [a]);
    const idx = mentionIndex(cast.filter((c) => !c.gone).map((c) => ({ id: c.key, name: c.name, kind: c.kind, aliases: plain([c.name, ...c.aliases, ...c.wanted]) })));
    for (const p of ch.paras) {
      const hits = mentions(p.text, idx).map((m) => ({ key: m.id, start: m.start, end: m.end }));
      for (const s of p.sents) {
        if (!NAMING.test(s.text)) continue;
        const pats = [
          [/(?<![\p{L}])([Hh]is|[Hh]er|[Ii]ts)\s+(?:real\s+|true\s+|own\s+)?name\b[\s\S]*?\b(?:was|is)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, true],
          [/(?<![\p{L}])(?:called|named|call|calls|nicknamed)\s+(him|her|it)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, false],
          [/(?<![\p{L}])([Hh]e|[Ss]he|[Ii]t)\s+(?:was|is)\s+(?:called|named|known as)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, true]
        ];
        for (const [re, given] of pats) {
          const m = re.exec(s.text);
          if (!m) continue;
          const pos = s.start + m.index;
          const persons = new Set(cast.filter((c) => !c.gone && ['person', 'creature'].includes(c.kind)).map((c) => c.key));
          const before = hits.filter((h) => h.end <= pos && persons.has(h.key));
          if (!before.length) continue;
          const h = before[before.length - 1];
          let ref = p.text.slice(h.start, h.end);
          if (/^\p{Ll}/u.test(ref) && /\bthe\s+$/i.test(p.text.slice(0, h.start))) ref = 'the ' + ref;
          const name = m[2].replace(/['’]s$/, '');
          if (norm(ref) === norm(name)) continue;
          out.push({ key: h.key, ref, name, given, sentence: s.text });
        }
      }
    }
    return out;
  }

  /* ---------- 2 · passage packs ---------- */

  // Where each cast member is named in the chapter: its names and aliases,
  // and for a place with a name of two words or more, "the <last word>"
  // when nothing else has that word and nothing qualifies it ("the room",
  // not "the room with the green tiles")
  function chapterHits(ch, cast) {
    const idx = mentionIndex(cast.map((c) => ({ id: c.key, name: c.name, kind: c.kind, aliases: c.aliases })));
    const heads = new Map();
    for (const c of cast) {
      if (c.kind !== 'place' || c.name.split(/\s+/).length < 2) continue;
      const head = c.name.split(/\s+/).pop().toLowerCase();
      if (head.length < 3 || cast.some((x) => x !== c && [x.name, ...x.aliases].some((n) => n.split(/\s+/).pop().toLowerCase() === head))) continue;
      heads.set(head, c.key);
    }
    return ch.paras.map((p) => {
      const hits = mentions(p.text, idx).map((m) => ({ key: m.id, start: m.start, end: m.end, via: m.via }));
      for (const [head, key] of heads) {
        for (const m of p.text.matchAll(new RegExp(`(?<![\\p{L}])the\\s+${escRe(head)}(?![\\p{L}])(?!\\s+(?:with|of|that|where|which|on|in|at|behind|beside|across)\\b)`, 'giu'))) {
          if (hits.some((h) => h.start < m.index + m[0].length && h.end > m.index)) continue;
          hits.push({ key, start: m.index, end: m.index + m[0].length, via: 'head' });
        }
      }
      return hits.sort((a, b) => a.start - b.start);
    });
  }
  // Who is he and who is she, by the chapter's own narration: a sentence
  // that opens with he or she after one naming a single person, and "Hesper
  // was on her feet" (an owning his or her a few words after the name, no
  // one else named between). Two votes or more, none against. → key → sex
  function sexHints(ch, hits, cast) {
    const living = new Set(cast.filter((x) => ['person', 'creature'].includes(x.kind)).map((x) => x.key));
    const votes = new Map();
    const vote = (key, sex) => { if (!votes.has(key)) votes.set(key, { male: 0, female: 0 }); votes.get(key)[sex]++; };
    for (const p of ch.paras) {
      const free = (h) => !p.talk.some(([a, b]) => h.start < b && h.end > a);
      const ph = hits[p.pi].filter((h) => living.has(h.key) && free(h));
      p.sents.forEach((s, si) => {
        const here = ph.filter((h) => h.start >= s.start && h.end <= s.end);
        const people = [...new Set(here.map((h) => h.key))];
        if (people.length === 1) {
          const h = here[0];
          const after = p.text.slice(h.end, s.end);
          // "Hesper made herself look"; "Hesper had been born …, and she had never"
          const m = /(?<![\p{L}])(himself|herself)(?![\p{L}])|(?:,\s*|(?<![\p{L}])and\s+|(?<![\p{L}])then\s+)(he|she)(?![\p{L}])/u.exec(after);
          if (m && !p.talk.some(([a, b]) => h.end + m.index < b && h.end + m.index + m[0].length > a)) vote(people[0], (m[1] || m[2]) === 'himself' || (m[1] || m[2]) === 'he' ? 'male' : 'female');
          const next = p.sents[si + 1];
          const n = next && /^(he|she)\b/i.exec(next.text);
          if (n && !ph.some((x) => x.start >= next.start && x.end <= next.end)) vote(people[0], n[1].toLowerCase() === 'he' ? 'male' : 'female');
        }
      });
    }
    const out = new Map();
    for (const [k, v] of votes) if (v.male + v.female >= 2 && (!v.male || !v.female)) out.set(k, v.male ? 'male' : 'female');
    out.votes = votes;
    return out;
  }
  const SUBJECT = /^(?:[“"‘']?\s*)(?:(?:then|and|but|so|now|still|later|once|when|after|before|there|here|yet)\s*,?\s+)?(he|she|his|her|it|its|they|their)\b/i;
  const PERSONAL = { he: 'male', his: 'male', she: 'female', her: 'female' };
  // The sentences about one cast member, each with why it is there:
  // 'name' (it is named), 'chain' (the pronoun after it), 'para' (a place's
  // or thing's paragraph, after it is named), 'setting' (the chapter's place)
  function packFor(ch, hits, cast, c, sexOf) {
    const out = new Map();
    const living = new Set(cast.filter((x) => ['person', 'creature'].includes(x.kind)).map((x) => x.key));
    const add = (s, why) => { if (!out.has(s.id) || (out.get(s.id) === 'setting' && why !== 'setting')) out.set(s.id, why); };
    let carry = []; // the ones a paragraph opening with a pronoun may mean: the last named before it, latest last
    for (const p of ch.paras) {
      const ph = hits[p.pi];
      for (const [si, s] of p.sents.entries()) {
        const here = ph.filter((h) => h.start >= s.start && h.end <= s.end);
        if (here.some((h) => h.key === c.key)) { add(s, 'name'); continue; }
        if (living.has(c.key)) {
          const m = !s.said && SUBJECT.exec(s.text);
          if (m && PERSONAL[m[1].toLowerCase()]) {
            const pos = s.start + m.index + m[0].length - m[1].length;
            const seen = ph.filter((h) => h.end <= pos && living.has(h.key) && !p.talk.some(([a, b]) => h.start < b && h.end > a));
            const sex = PERSONAL[m[1].toLowerCase()];
            // the last one named before whose sex (if known) agrees
            let who = null;
            for (let i = seen.length - 1; i >= 0; i--) { const k = sexOf(seen[i].key); if (!k || k === sex) { who = seen[i].key; break; } }
            if (who == null && !seen.length && si === 0) for (let i = carry.length - 1; i >= 0; i--) { const k = sexOf(carry[i]); if (!k || k === sex) { who = carry[i]; break; } }
            if (who === c.key && !here.some((h) => living.has(h.key) && h.start < pos)) { add(s, 'chain'); continue; }
          }
        } else {
          // a place's (or group's, thing's) paragraph: after it's named,
          // until something else of its kind is
          const before = ph.filter((h) => h.end <= s.start && cast[h.key] && cast[h.key].kind === c.kind);
          if (before.length && before[before.length - 1].key === c.key && !here.some((h) => cast[h.key] && cast[h.key].kind === c.kind)) { add(s, 'para'); continue; }
        }
        if (c.setting && !s.said) add(s, 'setting');
      }
      const named = ph.filter((h) => living.has(h.key) && !p.talk.some(([a, b]) => h.start < b && h.end > a));
      for (const h of named) carry = [...carry.filter((k) => k !== h.key), h.key].slice(-3);
    }
    const ids = [...out.keys()].sort((a, b) => a - b);
    return ids.map((id) => ({ s: ch.sents[id - 1], why: out.get(id) }));
  }
  // A pack as the reader sees it, split where it runs long (~1,500 tokens):
  // [{ lines: [{ n, s, why }], text }], sentences numbered from 1 in each part
  const PACK_CHARS = 5600;
  function packParts(pack) {
    const parts = [];
    let cur = [];
    let size = 0;
    for (const x of pack) {
      const len = x.s.text.length + 6;
      if (cur.length && size + len > PACK_CHARS && cur[cur.length - 1].s.pi !== x.s.pi) { parts.push(cur); cur = []; size = 0; }
      cur.push(x);
      size += len;
    }
    if (cur.length) parts.push(cur);
    return parts.map((xs) => {
      const lines = xs.map((x, i) => ({ n: i + 1, s: x.s, why: x.why }));
      let text = '';
      lines.forEach((l, i) => { text += (i && lines[i - 1].s.pi !== l.s.pi ? '\n\n' : i ? ' ' : '') + `[${l.n}] ${l.s.text}`; });
      return { lines, text };
    });
  }

  /* ---------- 3 · gates on a fact ---------- */

  const GROUPS = ['appearance', 'age', 'sex', 'role', 'personality', 'habit', 'relationship', 'origin', 'history', 'state', 'possession', 'description', 'location', 'rule', 'membership', 'other'];
  // what may be one moment rather than a lasting fact: asked whether it lasts
  const LASTING = new Set(['habit', 'state', 'possession', 'personality', 'other']);
  // read between the lines, by nature: asked twice
  const INTERPRETIVE = new Set(['personality', 'relationship', 'opinion', 'manner', 'manner.speech']);
  const GROUP_KEY = { appearance: 'appearance', age: 'age', sex: 'sex', role: 'role', personality: 'personality', habit: 'habit', relationship: 'relationship',
    origin: 'origin', history: 'history', state: 'state', possession: 'possession', description: 'description', location: 'location', rule: 'rule', membership: 'membership', other: 'other' };
  // a label's canonical key: the label's own if the table knows it, else the group's
  function keyOf(group, label) {
    const k = canonLabel(label || '');
    if (C.KNOWN_KEYS.has(k)) return k;
    return GROUP_KEY[group] || 'other';
  }
  // the clause of a sentence that holds the words, when it stands alone:
  // cut at commas and semicolons, the run of segments holding every matched
  // word; a clause that starts the sentence keeps its start
  function clauseOf(s, words) {
    const text = s.text;
    const low = norm(text);
    if (!words.length) return text;
    const cuts = [0];
    for (const m of text.matchAll(/[,;:]\s+|\s+[—–]\s+/g)) cuts.push(m.index + m[0].length);
    cuts.push(text.length + 1);
    const segs = cuts.slice(0, -1).map((a, i) => ({ a, b: Math.min(text.length, cuts[i + 1]) }));
    // (a word written as the value writes it beats one the lexicon allows: "too tall", not "tallest")
    const bags = segs.map((seg) => new Set(content(norm(text.slice(seg.a, seg.b)))));
    const has = bags.map((t) => new Set(words.filter((w) => t.has(w) || (!bags.some((x) => x.has(w)) && inBag(w, t)))));
    const all = new Set(has.flatMap((x) => [...x]));
    if (!all.size) return fit(text, words);
    // the fewest segments holding every word the value shares with the sentence
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const got = new Set();
      for (let j = i; j < segs.length; j++) {
        for (const w of has[j]) got.add(w);
        if (got.size === all.size) { if (!best || j - i < best[1] - best[0]) best = [i, j]; break; }
      }
    }
    let [first, last] = best;
    // (the sentence's start, who it is about, stays unless it runs long)
    if (first > 0 && text.slice(0, segs[first].a).split(/\s+/).length <= 12) first = 0;
    const cut = text.slice(segs[first].a, segs[last].b).replace(/[\s,;:—–]+$/, '');
    // too short to stand alone, or a clause that leans on the one before: the sentence
    if (cut.split(/\s+/).length < 4 || (first > 0 && /^(?:and|but|or|which|who|that|as|with|than)\b/i.test(cut))) return fit(low.length ? text : cut, words);
    return fit(cut, words);
  }
  // "no", "not", "never" just before one of the value's words in the text
  function localNeg(text, words) {
    const ts = tokens(text);
    const st = ts.map(stem);
    for (let i = 0; i < ts.length; i++) {
      if (!words.some((w) => w === st[i] || inBag(w, new Set([st[i]])))) continue;
      if (NEGATORS.has(ts[i]) && words.includes(st[i])) return true; // ("never" is the value's own word)
      if (ts.slice(Math.max(0, i - 5), i).some((w) => NEGATORS.has(w))) return true;
    }
    return false;
  }
  const HABITUAL = /(?<![\p{L}])(?:always|every|each|never|usually|often|ever|would|used to|whenever|daily|nightly|kept|keeps|keep|the same|again and again|by height|the way it|habit|rules?|allowed|nobody|no one|all|any)(?![\p{L}])/iu;
  // at most 30 words (the quote gate's limit): the 30 around the value's words
  function fit(text, words) {
    const ws = text.split(/\s+/);
    if (ws.length <= 30) return text;
    const at = ws.findIndex((w) => words.some((x) => inBag(x, new Set(content(w)))));
    const from = Math.max(0, Math.min(ws.length - 30, (at < 0 ? 0 : at) - 8));
    return ws.slice(from, from + 30).join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '');
  }
  // Cited, tied, grounded: the gates a proposal passes before the reader
  // is asked about it. → { why } or { quote, said, key, label, value, ... }
  function gateFact(x, part, c, ctx) {
    let g = GROUPS.includes(x && x.g) ? x.g : null;
    if (g && ['sex', 'age'].includes(g) && !['person', 'creature'].includes(c.kind)) g = 'description';
    // (who belongs is a group's; a place's or thing's "membership" is what it's like)
    if (g === 'membership' && ['place', 'thing'].includes(c.kind)) g = 'description';
    const value = String((x && x.v) || '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
    const label = String((x && x.a) || '').replace(/\s+/g, ' ').trim();
    if (!g || !value || value.length > 110 || value.split(' ').length > 16 || label.split(' ').length > 4) return { why: 'shape' };
    // 1 cited: every id one of the part's sentences
    const ids = [...new Set((Array.isArray(x.s) ? x.s : [x.s]).map((n) => +n).filter((n) => Number.isInteger(n)))];
    if (!ids.length || ids.length > 3 || ids.some((n) => n < 1 || n > part.lines.length)) return { why: 'cited' };
    const cited = ids.map((n) => part.lines[n - 1]);
    // 2 tied: each cited sentence names it, follows on with its pronoun, is
    // its place's paragraph, or the chapter is set in it
    if (cited.some((l) => !l.why)) return { why: 'tied' };
    // the words it's about, and the value's words in the text
    const own = new Set([c.name, ...c.aliases].flatMap((n) => content(n)));
    const valueWords = content(value).filter((w) => !own.has(w));
    const text = cited.map((l) => l.s.text).join(' ');
    const bag = new Set(content(text));
    // 3 grounded: half the value's words (all its names and numbers) in the sentences
    const grounded = valueWords.filter((w) => inBag(w, bag));
    const caps = (value.match(/(?<![\p{L}])\p{Lu}[\p{L}'’-]+/gu) || []).filter((w, i) => i > 0 || !STOPW.has(w.toLowerCase()));
    if (caps.some((w) => !norm(text).includes(norm(w.replace(/['’]s$/, ''))) && !own.has(stem(norm(w))))) return { why: 'invented' };
    if (valueWords.filter((w) => NUMBER.test(w)).some((w) => !inBag(w, bag))) return { why: 'invented' };
    const key = keyOf(g, label);
    // about someone (or something) else: a place's, group's or thing's fact
    // whose label or value names another of the cast ("Weigher's nickname"
    // on the Weighhouse), or names itself ("not one of the Spared" is
    // someone's, not the Spared's)
    const others = (ctx.cast || []).filter((o) => o !== c && !o.gone);
    const namesOther = (t) => others.some((o) => [o.name, ...o.aliases].some((n) => { const b = norm(n.replace(/^the\s+/i, '')); return b.length >= 3 && new RegExp(`(?<![\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(norm(t)); }));
    if (c.kind !== 'person' && c.kind !== 'creature' && !['relationship', 'location'].includes(g) && !['residents', 'members'].includes(key)) {
      if (namesOther(label + ' ' + value)) return { why: 'someone else' };
      if ([c.name, ...c.aliases].some((n) => { const b = norm(n.replace(/^the\s+/i, '')); return b.length >= 3 && norm(value).includes(b); })) return { why: 'someone else' };
    }
    // a place's, group's or thing's sentence found by its paragraph (not its
    // name) that is about a person ("Hesper had been born…", "his neck")
    // is that person's; and how anyone looks is never another of the cast
    if (c.kind !== 'person' && c.kind !== 'creature' && !['relationship', 'location'].includes(g) && cited.some((l) => l.why !== 'name')) {
      const people = others.filter((o) => ['person', 'creature'].includes(o.kind));
      const personal = (t) => /(?<![\p{L}])(?:he|she|his|her|him|hers)(?![\p{L}])/iu.test(t) || people.some((o) => [o.name, ...o.aliases].some((n) => { const b = norm(n.replace(/^the\s+/i, '')); return b.length >= 3 && new RegExp(`(?<![\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(norm(t)); }));
      if (cited.some((l) => l.why !== 'name' && personal(l.s.text))) return { why: 'someone else' };
    }
    if (labelFamily(keyOf(g, label)) === 'appearance' && namesOther(value)) return { why: 'someone else' };
    // the setting's own: how it works (its routines and rules, who belongs),
    // from a clause that names no one and nothing else of the cast
    const bySetting = cited.some((l) => l.why === 'setting');
    if (bySetting && !['habit', 'rule', 'membership'].includes(g)) return { why: 'setting' };
    const interpretive = INTERPRETIVE.has(key) || INTERPRETIVE.has(labelFamily(key)) || g === 'personality';
    const ratio = valueWords.length ? grounded.length / valueWords.length : 0;
    if (!valueWords.length) return { why: 'empty' };
    if (ratio < 0.5 && !(interpretive && ratio > 0)) return { why: 'ungrounded' };
    // polarity: "not one of the Spared" isn't "one of the Spared"
    const clauses = cited.map((l) => clauseOf(l.s, grounded));
    if (localNeg(clauses.join(' '), grounded) !== negated(value) && !(negated(value) && /less|out\b|\bun/i.test(value))) return { why: 'polarity' };
    // a habit or routine is what is done more than once: the words must say so
    // (always, every, never, kept, the same…); one moment is the story's, not the bible's
    if ((g === 'habit' || labelFamily(key) === 'habit') && !HABITUAL.test(value + ' ' + cited.map((l) => l.s.text).join(' '))) return { why: 'once' };
    // an appearance is how they look, not what they did ("slid the weight", "did not turn round")
    if (labelFamily(key) === 'appearance' && /^(?:did|was|were|went|tried|kept|got|had|has|made|took|gave|came|stood|sat|looked|turned|peered|slid|walked|ran|said|felt)\b/i.test(value)) return { why: 'once' };
    // a personality is a word or two, or a way they always are
    if (g === 'personality' && value.split(/\s+/).length > 4 && !HABITUAL.test(value + ' ' + cited.map((l) => l.s.text).join(' '))) return { why: 'once' };
    // the quote: the cited sentence (its clause), as the writer wrote it
    const quotes = cited.map((l, i) => gateQuote(clauses[i], ctx.text) || gateQuote(l.s.text, ctx.text)).filter(Boolean);
    if (quotes.length !== cited.length) return { why: 'quote' };
    // said: inside speech or reported speech, whatever the reader marked
    const said = !!x.x || cited.every((l) => { const q = clauseOf(l.s, grounded); return talkOf(l.s, q, ctx); });
    if (bySetting && quotes.some((q) => namesOther(q) || others.some((o) => o.kind === 'place' && o.name.split(/\s+/).length > 1 && new RegExp(`(?<![\\p{L}])${o.name.split(/\s+/).pop()}s?(?![\\p{L}])`, 'iu').test(q)))) return { why: 'setting' };
    // not from a sentence a slip stands on (a later value that differs)
    if (cited.some((l) => ctx.suspect && ctx.suspect.has(l.s.id))) return { why: 'suspect' };
    return { g, key, label, value, quotes, cited, said, interpretive: interpretive && ratio < 0.5, strong: cited.every((l) => l.why === 'name'),
      setting: bySetting, lasting: LASTING.has(g) || ['habit', 'routine', 'custom', 'state', 'possession', 'personality'].includes(labelFamily(key)) || ['habit', 'routine', 'custom', 'state', 'possession'].includes(key) };
  }
  // is the clause `q` of sentence `s` talk (speech, or reported)
  function talkOf(s, q, ctx) {
    const p = ctx.ch.paras[s.pi];
    const at = normMap(p.text);
    const i = at.text.indexOf(norm(q), s.start === 0 ? 0 : Math.max(0, at.map.findIndex((m) => m >= s.start) - 1));
    if (i < 0) return s.said;
    const a = at.map[i];
    const b = at.map[i + norm(q).length - 1] + 1;
    return p.talk.some(([x, y]) => a < y && b > x) && !(p.talk.every(([x, y]) => b <= x + 1 || a >= y - 1));
  }

  /* ---------- hard traits read from open facts ---------- */

  // A trait the reader read (Hair: fair as wet straw; Sex: woman) is a
  // proposal of the closed kind, for the trait gates to decide: the colour
  // or the sex word must be in the quote (canon.js rule 2 then wants the
  // text's own tie, or the pronoun's referent).
  function traitOf(key, value, quote) {
    const w = wordsOf(value + ' ' + quote);
    const vw = wordsOf(value);
    if (key === 'sex') {
      const word = vw.find((x) => SEX_WORDS[x]) || (['female', 'male'].includes(norm(value)) ? norm(value) : null);
      if (!word) return null;
      const v = SEX_WORDS[word] ? SEX_WORDS[word][0] : word;
      if (!w.some((x) => (SEX_WORDS[x] && SEX_WORDS[x][0] === v))) return { attr: 'sex', value: v, as: '' }; // (a pronoun's: the rule decides)
      return { attr: 'sex', value: v, as: SEX_WORDS[word] ? word : '' };
    }
    if (key === 'appearance.hair' || key === 'appearance.eyes') {
      const c = vw.find((x) => COLOURS[x]);
      if (!c || !wordsOf(quote).includes(c)) return null;
      return { attr: key === 'appearance.hair' ? 'hair' : 'eyes', value: COLOURS[c], as: norm(value) === c ? '' : value };
    }
    if (key === 'species') {
      const s = vw.find((x) => SPECIES[x]);
      return s && wordsOf(quote).includes(s) ? { attr: 'species', value: SPECIES[s], as: '' } : null;
    }
    return null;
  }

  /* ---------- 5 · open-fact slips: candidates (code) ---------- */

  const ANTONYMS = [['thin', 'fat'], ['thin', 'stout'], ['thin', 'plump'], ['narrow', 'wide'], ['narrow', 'broad'], ['tall', 'short'], ['old', 'young'], ['cold', 'warm'], ['cold', 'hot'],
    ['dark', 'bright'], ['quiet', 'loud'], ['empty', 'full'], ['inside', 'outside'], ['locked', 'unlocked'], ['always', 'never'], ['high', 'low'], ['heavy', 'light'],
    ['clean', 'dirty'], ['rich', 'poor'], ['kind', 'cruel'], ['gentle', 'rough'], ['calm', 'angry']].map((p) => p.map(stem));
  const ANT = new Map();
  for (const [a, b] of ANTONYMS) { if (!ANT.has(a)) ANT.set(a, new Set()); if (!ANT.has(b)) ANT.set(b, new Set()); ANT.get(a).add(b); ANT.get(b).add(a); }

  // Does sentence B say otherwise of a kept fact? Code finds the candidates:
  // the same head noun with "no/not/never" on one side only ("not one
  // window" / "high windows"), a word against one of the value's (thin /
  // stout), or another number of the same thing. → the words of B to mark, or null
  const UNREAL = /(?<![\p{L}])(?:pretend\w*|imagin\w*|wish\w*|dream\w*|as if|as though|seem\w*|felt like|feels like|remember\w*|thought of|if only|would have|could have)(?![\p{L}])/iu;
  // the words of B to mark, or null (clashDetail also says what to ask)
  const clashCandidate = (f, quote, sentence, names = []) => (clashDetail(f, quote, sentence, names) || {}).span || null;
  // …and the one question each passage is asked on its own, whose answers
  // must differ: "does the Long Room have windows?", "is the weigher stout?"
  function clashDetail(f, quote, sentence, names = []) {
    const who = names[0] || 'it';
    const rawAt = (i) => { const raw = [...sentence.matchAll(/[\p{L}\p{N}'’-]+/gu)]; const j = raw.findIndex((m) => stem(norm(m[0]).replace(/['’]s$/, '')) === stem(tokens(sentence)[i] || '')); return j < 0 ? null : raw[j][0].replace(/['’]s$/, ''); };
    const b = tokens(sentence);
    const bs = b.map(stem);
    const vs = content(f.value + ' ' + (f.as || ''));
    const qs = content(quote);
    const own = new Set([...vs, ...qs]);
    // (a clause that only pretends, remembers or supposes says nothing of the story)
    const unreal = (i) => {
      const raw = [...sentence.matchAll(/[\p{L}\p{N}'’-]+/gu)];
      const j = raw.findIndex((m) => stem(norm(m[0]).replace(/['’]s$/, '')) === bs[i]);
      if (j < 0) return false;
      const at = raw[j].index;
      const a = Math.max(sentence.lastIndexOf(',', at), sentence.lastIndexOf(';', at)) + 1;
      const z = [sentence.indexOf(',', at), sentence.indexOf(';', at)].filter((x) => x >= 0);
      return UNREAL.test(sentence.slice(a, z.length ? Math.min(...z) : sentence.length));
    };
    const mark = (i) => {
      if (unreal(i)) return null;
      // the noun phrase around B's word: the words before it back to a determiner
      const raw = [...sentence.matchAll(/[\p{L}\p{N}'’-]+/gu)];
      const j = raw.findIndex((m) => stem(norm(m[0]).replace(/['’]s$/, '')) === bs[i]);
      if (j < 0) return null;
      let a = j;
      while (a > 0 && !/^(?:the|a|an|its|his|her|their|our|my|your|this|that|those|these|of|in|on|at|through|and|with)$/i.test(raw[a - 1][0]) && !/['’]s$/.test(raw[a - 1][0]) && j - a < 2) a--;
      return sentence.slice(raw[a].index, raw[j].index + raw[j][0].length);
    };
    // polarity on a shared noun
    const nouns = vs.filter((w) => !NEGATORS.has(w) && w.length >= 4 && !NUMBER.test(w) && qs.includes(w));
    for (const n of nouns) {
      const i = bs.indexOf(n);
      if (i < 0) continue;
      const near = (arr, k) => arr.slice(Math.max(0, k - 4), k).some((w) => NEGATORS.has(w));
      const qi = qs.indexOf(n);
      const qTokens = tokens(quote).map(stem);
      const fNeg = near(qTokens, qTokens.indexOf(n)) || (negated(f.value) && qi >= 0);
      const bNeg = near(bs, i);
      if (fNeg !== bNeg && mark(i)) return { span: mark(i), q: `does ${who} have ${rawAt(i)}?` };
    }
    // a word against one of the value's, of the same one (near a word the two share)
    const named = new Set(names.flatMap((n) => content(n)));
    const shared = new Set(bs.filter((w, k) => w.length >= 3 && !STOPW.has(b[k]) && !NEGATORS.has(w) && (own.has(w) || named.has(w))));
    for (const [i, w] of bs.entries()) {
      const against = ANT.get(w);
      if (!against || ![...against].some((x) => vs.includes(x)) || vs.includes(w)) continue;
      if (vs.length > 1 && !bs.slice(Math.max(0, i - 6), i + 7).some((x) => x !== w && shared.has(x))) continue;
      const m = mark(i);
      if (m) return { span: m, q: `is ${who} ${rawAt(i)}?` };
    }
    // another number of the same thing (forty beds / thirty beds)
    for (const [i, w] of bs.entries()) {
      if (!NUMBER.test(w) || own.has(w)) continue;
      const next = bs[i + 1];
      if (next && own.has(next) && vs.some((x) => NUMBER.test(x)) && mark(i + 1)) {
        const span = sentence.slice(sentence.toLowerCase().indexOf(b[i]), sentence.toLowerCase().indexOf(b[i]) + b[i].length + 1 + (b[i + 1] || '').length).trim();
        return { span, q: `does ${who} have ${span.toLowerCase()}?` };
      }
    }
    return null;
  }

  /* ---------- 4 · the editor: merge, order, profile ---------- */

  // Facts of one entry that say the same thing: the same family and value
  // words that overlap by 0.6 or more → one fact, the earliest wording, every
  // source. → the facts, merged
  function overlap(a, b) {
    const x = new Set(content(a));
    const y = new Set(content(b));
    if (!x.size || !y.size) return 0;
    let n = 0;
    for (const w of x) if (inBag(w, y)) n++;
    return n / Math.min(x.size, y.size);
  }
  // Every content word of a profile sentence stands in its facts (their
  // values, labels and quotes), is a function word, or names the entry.
  function profileOk(sentence, facts, e) {
    const allowed = new Set(content([...facts.map((f) => `${f.label || ''} ${f.value} ${f.as || ''} ${(f.sources || []).map((s) => s.quote).join(' ')}`), e.name, ...(e.aliases || [])].join(' ')));
    const extra = new Set(['also', 'who', 'whose', 'which', 'where', 'there', 'here', 'has', 'have', 'is', 'was', 'are', 'were', 'and', 'person', 'place', 'group', 'thing', 'one', 'year', 'old', 'named', 'called', 'known']);
    const words = content(sentence).filter((w) => !extra.has(w) && !STOPW.has(w));
    if (!words.length) return false;
    if (/["“”«»]/.test(sentence) || sentence.split(/\s+/).length > 36) return false;
    return words.every((w) => inBag(w, allowed));
  }

  /* ---------- reading one chapter ---------- */

  // A pool of `n` at a time over `items`; `fn(item, i)`; stops between items
  async function pool(items, n, fn, stop) {
    const out = new Array(items.length);
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        if (stop && stop()) return;
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n || 1, items.length)) }, run));
    return out;
  }

  // One chapter (or notes page) read the editor's way. Proposals go into
  // `entries` (new ones made as needed) the way canon.js's accept() puts
  // them: open facts with their passages, `verified` marks the ones the
  // reader said yes to (the engine's gates read it), traits as proposals.
  // → { calls, dropped: [{ entity, label, value, why }], told }
  const KIND = { cast: 'cast', dossier: 'dossier', verdict: 'verify', profile: 'profile' };
  async function readChapter({ src, paras, entries, reader, cache, names, stop, tell, suspect, sexOf: sexKnown, timed = null }) {
    const ch = chapterModel(paras);
    const book = `${src.book}, ${src.label}`;
    const dropped = [];
    let calls = 0;
    const ask = async (bucket, key, fn) => {
      if (cache[bucket] && cache[bucket][key] !== undefined) return cache[bucket][key];
      const t0 = Date.now();
      const r = await fn();
      if (timed) timed(KIND[bucket], Date.now() - t0);
      calls++;
      (cache[bucket] = cache[bucket] || {})[key] = r === undefined ? null : r;
      return r;
    };
    const H = (...xs) => textHash(JSON.stringify([reader.id, EDITOR_PROMPT, ...xs]));
    // 1 · cast
    const near = entries.filter((e) => !e.locked && mentions(ch.text, mentionIndex([e])).length);
    const known = near.slice(0, 40).map((e) => ({ name: e.name, kind: e.kind, aliases: e.aliases }));
    if (tell) tell({ phase: 'cast' });
    const found = writtenNames(ch, names);
    const castAnswer = await ask('cast', H('cast', ch.text, known, found), () => reader.cast({ text: ch.paras.map((p) => `¶${p.pi + 1} ${p.text}`).join('\n'), known, names: found }));
    if (stop && stop()) return { calls, dropped, stopped: true };
    const answer = Array.isArray(castAnswer) ? { cast: castAnswer, setting: '' } : castAnswer || { cast: [], setting: '' };
    const cast = castGate({ proposals: answer.cast || [], setting: answer.setting, ch, entries: entries.filter((e) => !e.locked), names });
    // known entries the chapter names, if the reader left them out
    for (const e of near) {
      if (cast.some((c) => c.entry === e)) continue;
      cast.push({ key: cast.length, name: e.name, kind: e.kind, aliases: [...e.aliases], in: '', proper: /^\p{Lu}/u.test(e.name), wanted: [], entry: e });
    }
    cast.forEach((c, i) => { c.key = i; });
    const hits = chapterHits(ch, cast);
    const hinted = sexHints(ch, hits, cast);
    const sexOf = (key) => { const c = cast[key]; return (c && c.entry && sexKnown && sexKnown(c.entry)) || hinted.get(key) || null; };
    // 2 · packs, 3 · dossiers
    const jobs = [];
    for (const c of cast) {
      if (c.kind === 'rule' && !c.proper) continue;
      const pack = packFor(ch, hits, cast, c, sexOf);
      if (!pack.some((x) => x.why === 'name')) continue;
      for (const part of packParts(pack)) jobs.push({ c, part });
    }
    const ctx = { ch, text: ch.text, suspect, cast };
    const proposals = [];
    let done = 0;
    await pool(jobs, reader.parallel || 1, async ({ c, part }) => {
      if (tell) tell({ phase: 'dossier', name: c.name, n: ++done, of: jobs.length });
      const facts = await ask('dossier', H('dossier', c.name, c.kind, c.aliases, part.text), () => reader.dossier({ name: c.name, kind: c.kind, aliases: c.aliases, text: part.text, n: part.lines.length }));
      for (const x of facts || []) {
        const gt = gateFact(x, part, c, ctx);
        if (gt.why) { dropped.push({ entity: c.name, label: x && x.a, value: x && x.v, why: gt.why }); continue; }
        proposals.push({ c, part, ...gt });
      }
    }, stop);
    if (stop && stop()) return { calls, dropped, stopped: true };
    // 3 · the verifier: the claim against the paragraphs it cites
    const passageOf = (p) => [...new Set(p.cited.map((l) => l.s.pi))].sort((a, b) => a - b).map((pi) => ch.paras[pi].text).join('\n\n');
    // (ordered by passage, so a passage asked about twice is read once)
    const order = proposals.map((p, i) => ({ p, i, passage: passageOf(p) })).sort((a, b) => a.passage.localeCompare(b.passage) || a.i - b.i);
    let checked = 0;
    await pool(order, reader.parallel || 1, async ({ p, passage }) => {
      if (tell) tell({ phase: 'verify', n: ++checked, of: order.length });
      const claim = { name: p.c.name, kind: p.c.kind, label: p.label || p.key, value: p.value, passage, ...(p.setting ? { setting: true } : {}) };
      const first = await ask('verdict', H('verify', claim), () => reader.verify(claim));
      p.verdict = first;
      // read between the lines: asked again, whether it is stated, not guessed
      if (p.verdict === 'yes' && p.interpretive) p.verdict = await ask('verdict', H('stated', claim), () => reader.verify({ ...claim, strict: true }));
      // tied by a pronoun or a paragraph, not a name: is it someone else's?
      if (p.verdict === 'yes' && !p.strong) {
        const other = await ask('verdict', H('other', claim), () => reader.verify({ ...claim, other: true }));
        if (other !== 'no') p.verdict = other === 'yes' ? 'no' : 'unclear';
      }
      // one moment, or lasting?
      if (p.verdict === 'yes' && p.lasting) p.verdict = await ask('verdict', H('lasting', claim), () => reader.verify({ ...claim, lasting: true }));
    }, stop);
    if (stop && stop()) return { calls, dropped, stopped: true };
    // into the entries: open facts (and what is only said) and trait proposals
    const made = new Map();
    const entryOf = (c) => {
      if (c.entry) return c.entry;
      if (made.has(c.key)) return made.get(c.key);
      let e = [c.name, ...c.aliases].map((n) => findEntry(entries, n)).find(Boolean);
      if (!e) {
        let id = slug(c.name.replace(/^the\s+/i, ''));
        for (let k = 2; entries.some((x) => x.id === id); k++) id = slug(c.name.replace(/^the\s+/i, '')) + '-' + k;
        e = newEntry(c.name, c.kind, id);
        entries.push(e);
      }
      for (const a of c.aliases) if (norm(a) !== norm(e.name) && !e.aliases.some((x) => norm(x) === norm(a))) e.aliases.push(a);
      made.set(c.key, e);
      return e;
    };
    const kept = [];
    for (const p of proposals) {
      if (p.verdict !== 'yes') { dropped.push({ entity: p.c.name, label: p.label, value: p.value, why: 'verifier: ' + (p.verdict || 'none') }); continue; }
      const e = entryOf(p.c);
      const sources = p.quotes.map((q) => ({ label: book, quote: q, book: src.bookId, ch: src.chId, ...(p.said ? { said: true } : {}) }));
      const trait = ['sex', 'species', 'appearance.hair', 'appearance.eyes'].includes(p.key) ? traitOf(p.key, p.value, p.quotes.join(' ')) : null;
      if (trait) {
        kept.push({ e, f: { attr: trait.attr, value: trait.value, as: trait.as, state: 'unverified', sources }, trait: true, p });
        continue;
      }
      // a trait the rules can't read (hair "cropped close"): an open fact under its own label
      if (['sex', 'species'].includes(p.key)) { dropped.push({ entity: p.c.name, label: p.label, value: p.value, why: 'trait' }); continue; }
      kept.push({ e, f: { attr: 'other', label: C.openLabel(p.key, p.label), value: p.value, as: '', state: 'unverified', sources }, p });
    }
    // a person the text calls by a role ("the weigher", "the warden") has
    // that role: the text's own word, from the first sentence of narration
    // that calls them so (code's, like the shelf's own kin)
    for (const c of cast) {
      if (c.kind !== 'person') continue;
      const role = [c.name, ...c.aliases].find((n) => /^the\s+\p{Ll}[\p{Ll}-]+$/u.test(n) && !CROWD.has(n.slice(4)));
      if (!role) continue;
      const re = new RegExp(`(?<![\\p{L}])[Tt]he\\s+${escRe(role.slice(4))}(?![\\p{L}])`, 'u');
      const s = ch.sents.find((x) => re.test(x.text) && !x.said && !ch.paras[x.pi].talk.some(([a, b]) => a < x.end && b > x.start));
      const quote = s && gateQuote(fit(s.text, [stem(role.slice(4))]), ch.text);
      if (!quote) continue;
      const e = entryOf(c);
      kept.push({ e, f: { attr: 'other', label: 'Role', value: role.slice(4), as: '', state: 'unverified', sources: [{ label: book, quote, book: src.bookId, ch: src.chId }] } });
    }
    // every cast member is an entry once something about it is kept, or the chapter names it often
    for (const c of cast) {
      if (c.entry || made.has(c.key)) continue;
      const n = hits.reduce((k, ph) => k + ph.filter((h) => h.key === c.key && h.via !== 'head').length, 0);
      if (n >= 2 && (c.proper || ['person', 'creature', 'place', 'group'].includes(c.kind))) entryOf(c);
    }
    return { calls, dropped, kept, cast, ch };
  }

  return { EDITOR_PROMPT, clashDetail, chapterModel, castGate, namingTies, chapterHits, sexHints, packFor, packParts, gateFact, clauseOf, traitOf, clashCandidate, overlap, profileOk, readChapter, pool, stem, content, inBag, GROUPS, KINDS };
};
