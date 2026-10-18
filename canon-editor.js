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
    findEntry, misspelt, gateQuote, PRONOUNS, SEX_WORDS, COLOURS, SPECIES, TITLES, LEADERS, canonLabel, labelFamily, nonEntity, stripTitles } = C;

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
  // the common nouns a named place or thing is called by (a reader's alias "the river")
  const CATEGORY = new Set(['river', 'stream', 'brook', 'canal', 'town', 'village', 'city', 'hamlet', 'house', 'cottage', 'farm', 'orchard', 'station', 'ship', 'boat', 'inn', 'pub', 'tavern',
    'mill', 'school', 'church', 'chapel', 'castle', 'tower', 'lighthouse', 'harbour', 'port', 'island', 'forest', 'wood', 'valley', 'lake', 'bay', 'market', 'academy', 'prison',
    'hospital', 'abbey', 'monastery', 'college', 'camp', 'base', 'manor', 'estate', 'palace', 'temple', 'shop', 'hotel', 'surgery', 'car', 'van', 'lorry', 'train', 'cart', 'barn', 'hangar', 'dock', 'plant', 'factory', 'yard']);
  const NAMING = /(?<![\p{L}])(?:name|names|named|called|calls|call|known as|nicknamed|nickname|went by)(?![\p{L}])/iu;
  // (round 4) what tells apart people of one name, generations mostly: never a role or a name alone
  const EPITHET_WORDS = 'Elder|Younger|Eldest|Youngest|Senior|Junior|First|Second|Third|Fourth|Fifth|Great|Less|Lesser|Greater';
  const EPITHET = new RegExp(`^the\\s+(?:${EPITHET_WORDS})$`, 'i');
  const EPITHET_AFTER = new RegExp(`\\s+(?:the\\s+(?:${EPITHET_WORDS})|Junior|Senior|Jr\\.?|Sr\\.?|II|III|IV)(?![\\p{L}])`, 'u');
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
    // (a family's possessive is no place: "the Haddons’ house")
    if (/s['’]$/.test(bare)) return null;
    if (/^\p{Lu}/u.test(bare)) {
      // every word capitalised but the small ones inside ("House of Varr")
      const parts = bare.split(/\s+/);
      if (!parts.every((w, i) => /^[\p{Lu}\p{N}]/u.test(w) || (i > 0 && i < parts.length - 1 && /^(?:of|the|de|du|da|del|la|le|van|von|der|and|on|upon)$/.test(w)))) return null;
      if (!written(text, bare)) return null;
      // a word the shelf writes in lower case too: "Nobody", "Ponies" (not
      // a number the text gives as a name, capitalised mid-sentence: "Nine")
      const asNumber = parts.length === 1 && NUMBER.test(bare.toLowerCase().split('-')[0]) && new RegExp(`[\\p{L},;]\\s+${escRe(bare)}(?![\\p{L}-])`, 'u').test(text);
      if (parts.length === 1 && lower && lower.has(bare.toLowerCase()) && !written(text, 'the ' + bare) && !asNumber) return null;
      if (parts.length === 1 && TITLES.has(bare.toLowerCase())) return null;
      // a month, a day, a holiday, a language, "Someone": nobody
      if (nonEntity(bare, kind)) return null;
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
          const w = m[1].replace(/['’]s$/, '');
          // a sentence's (or a quotation's) first word is capitalised anyway: not a
          // name unless two capitalised words neither of which the shelf writes in lower case
          if (!/[\p{L}\p{N}]/u.test(lead) || /[“"‘«:]\s*$/.test(lead)) {
            const ws = w.split(/\s+/);
            if (ws.length < 2 || ws.some((x) => lower.has(x.toLowerCase()) || LEADERS.has(x.toLowerCase()) || TITLES.has(x.toLowerCase()))) continue;
          }
          // (a number the text uses as a name, mid-sentence: "Nine")
          if (!w.includes(' ') && NUMBER.test(w.toLowerCase().split('-')[0]) && /[\p{L}\p{N}]/u.test(lead)) { out.set(w, (out.get(w) || 0) + 1); continue; }
          if (w.split(/\s+/).length === 1 && (lower.has(w.toLowerCase()) || TITLES.has(w.toLowerCase()) || PRONOUNS[w.toLowerCase()] || /^I$/.test(w))) continue;
          if (nonEntity(w) || /s['’]$/.test(w)) continue;
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
    // (a place's plural and singular are one place: "the Downs", "the Down")
    const singular = (x) => x.length > 4 && /[^s]s$/.test(x) ? x.slice(0, -1) : x;
    const sameName = (a, n, plural) => norm(a) === norm(n) || norm(a.replace(/^the\s+/i, '')) === norm(n.replace(/^the\s+/i, '')) || (plural && singular(norm(a.replace(/^the\s+/i, ''))) === singular(norm(n.replace(/^the\s+/i, ''))));
    const find = (n, kind = null) => cast.find((c) => !c.gone && [c.name, ...c.aliases].some((a) => sameName(a, n, kind === 'place' && c.kind === 'place')));
    for (const p of proposals || []) {
      const kind = KINDS.includes(p.kind) ? p.kind : 'thing';
      // (a person is "Daniel Fell", not "Daniel Fell of Mercer Row")
      const name = kind === 'person' ? cleanName(p.name).replace(/\s+of\s+(?:the\s+)?\p{Lu}.*$/u, '') : cleanName(p.name);
      const how = nameKind(name, text, lower, kind);
      if (!how || misspelt(name.replace(/^the\s+/i, ''), entries)) continue;
      // a thing or rule called only by a lower-case word, said once or twice, is no entry
      // (a proper name the text writes with "the": "the Weighhouse", "the Long Room")
      const named = how === 'proper' && !/^the\s/i.test(name) && written(text, 'the ' + name) && written(text, 'the ' + name) + written(text, 'The ' + name) >= written(text, name) ? 'the ' + name : name;
      let c = find(named, kind);
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
    // someone the reader left out whom the text names by a number ("Teodora
    // Kask had been Nine for three years"): a person, and the number theirs
    for (const m of text.matchAll(/(?<![\p{L}'’-])(\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+){0,2})\s+(?:had been|has been|was|is|became)\s+((?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Thirty|Forty|Fifty|Sixty|Seventy|Eighty|Ninety)(?:-[a-z]+)?)(?![\p{L}-])/gu)) {
      const who = m[1];
      if (nameKind(who, text, lower, 'person') !== 'proper' || LEADERS.has(who.split(/\s+/)[0].toLowerCase()) || find(who) || find(m[2])) continue;
      cast.push({ key: cast.length, name: who, kind: 'person', aliases: [], in: '', proper: true, wanted: [m[2]] });
    }
    // a name the reader gave only as another's alias is its own one until
    // the text ties the two ("Old Man", aliases "Dr Haddon")
    for (const c of [...cast]) {
      for (const a of c.wanted) {
        if (nameKind(a, text, lower, c.kind) === 'proper' && !find(a) && !misspelt(a.replace(/^the\s+/i, ''), entries)) cast.push({ key: cast.length, name: a, kind: c.kind, aliases: [], in: '', proper: true, wanted: [] });
      }
    }
    // a rank's role, written as such ("the doctor", twice or more), is the
    // one person the chapter gives that rank ("Dr Haddon")
    for (const [role, titles] of Object.entries(RANK)) {
      if (written(text, 'the ' + role) < 2) continue;
      const holders = cast.filter((c) => !c.gone && c.kind === 'person' && [c.name, ...c.aliases].some((y) => String(y).split(/\s+/).length > 1 && titles.includes(norm(String(y).replace(/^the\s+/i, '').split(/\s+/)[0]).replace(/\.$/, ''))));
      if (holders.length !== 1 || cast.some((c) => c !== holders[0] && !c.gone && [c.name, ...c.aliases].some((n) => norm(n) === 'the ' + role))) continue;
      if (!holders[0].aliases.some((a) => norm(a) === 'the ' + role)) holders[0].aliases.push('the ' + role);
    }
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
        // (a name the reader gave only as another's alias, with nothing in
        // the text to tie the two, is its own one: "Old Man", aliases "Dr Haddon")
        // (round 4: or the name's own title and surname, "Mrs Abbott" for "Mrs Ida Abbott", when no one else of the cast has them)
        if (bare(a) !== bare(c.name) && !mine.has(bare(a)) && !titleShort(a, c, cast)) continue;
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
    personMerges(cast, names);
    epithetSplits(cast, text, lower, entries);
    nicknames(cast, ch, names);
    numberedSlips(cast, text, entries);
    // (round 3) a group's, place's or thing's short name that one full name
    // opens with: "the Guild" for "the Guild of Wick-Trimmers" (never two:
    // "the Hall" beside "the Hall of Records" and "the Hall of Mirrors" is no one's)
    for (const a of cast.filter((x) => !x.gone && !['person', 'creature'].includes(x.kind))) {
      if (a.gone) continue;
      const short = norm(a.name.replace(/^the\s+/i, ''));
      const longer = cast.filter((b) => b !== a && !b.gone && b.kind === a.kind && [b.name, ...b.aliases].some((n) => { const l = norm(n.replace(/^the\s+/i, '')); return l.startsWith(short + ' of ') || l.startsWith(short + ' and '); }));
      if (longer.length === 1) mergeCast(cast, longer[0], a);
    }
    // (round 3) a place's or thing's common noun the reader gives as its
    // alias ("the river" for the Sare, "the orchard" for Lisle, "the station")
    // when the text first writes it just after the name (the same or the
    // next sentence) and nothing else of the cast is called so
    {
      const sents = ch.sents;
      for (const c of cast) {
        if (c.gone || !['place', 'thing'].includes(c.kind)) continue;
        for (const a of c.wanted) {
          const m = /^the\s+(\p{Ll}[\p{Ll}-]{2,})$/u.exec(cleanName(a));
          if (!m || !CATEGORY.has(m[1]) || norm(c.name).split(/\s+/).pop() === m[1]) continue;
          if (cast.some((o) => o !== c && !o.gone && [o.name, ...o.aliases, ...(o.wanted || [])].some((n) => norm(n).split(/\s+/).pop() === m[1]))) continue;
          const re = new RegExp(`(?<![\\p{L}])[Tt]he\\s+${escRe(m[1])}(?![\\p{L}])`, 'u');
          const at = sents.findIndex((x) => re.test(x.text));
          const named = (x) => !!x && [c.name, ...c.aliases].some((n) => written(x.text, n));
          if (at < 0 || !(named(sents[at]) || named(sents[at - 1]))) continue;
          if (!c.aliases.some((x) => norm(x) === norm('the ' + m[1]))) c.aliases.push('the ' + m[1]);
        }
      }
    }
    // a name the text calls an animal is a creature, whatever the reader said
    // ("Clem, his grey mare"; "a collie bitch called Moss")
    for (const c of cast) {
      if (c.gone || c.kind !== 'person' || !c.proper) continue;
      const n = escRe(c.name.replace(/^the\s+/i, ''));
      const re = new RegExp(`(?<![\\p{L}])${n}(?:\\s*[,:—–]\\s*(?:the|a|an|his|her|their|\\p{Lu}\\p{L}+['’]s)\\s+(?:[\\p{L}-]+\\s+){0,2}([\\p{Ll}]+)\\b)|(?:([\\p{Ll}]+)\\s+(?:called|named)\\s+${n}(?![\\p{L}]))`, 'u');
      const m = re.exec(text);
      const w = m && (m[1] || m[2]);
      if (w && ((SEX_WORDS[w] && SEX_WORDS[w][2]) || SPECIES[w])) c.kind = 'creature';
      // (round 4) any word of the apposition ("Biscuit, a wire-haired terrier with one torn ear"),
      // "The dog was Biscuit", or what only an animal has or does ("Biscuit wagged her tail")
      const kindOf = (x) => (SEX_WORDS[x] && SEX_WORDS[x][2]) || SPECIES[x];
      const ap = new RegExp(`(?<![\\p{L}])${n}\\s*[,:—–]\\s*(?:the|a|an|his|her|their|\\p{Lu}\\p{L}+['’]s)\\s+((?:[\\p{L}-]+\\s+){0,3}[\\p{L}-]+)`, 'u').exec(text);
      const was = new RegExp(`(?<![\\p{L}])[Tt]he\\s+([\\p{Ll}]+)\\s+(?:was|is)\\s+${n}(?![\\p{L}])|(?<![\\p{L}])${n}\\s+(?:was|is)\\s+(?:a|an|the)\\s+(?:[\\p{L}-]+\\s+){0,2}?([\\p{Ll}]+)(?![\\p{L}])`, 'u').exec(text);
      const does = new RegExp(`(?<![\\p{L}])${n}(?:['’]s\\s+(?:tail|paws?|collar|mane|hooves|hoof|whiskers|muzzle|snout|fur|leash|lead|kennel|stall|saddle|bridle)|\\s+(?:wagged|barked|purred|whinnied|neighed|pawed|growled|mewed|miaowed|snarled|yapped|whined|nickered|bleated|lowed|grazed))(?![\\p{L}])`, 'u').test(text);
      if ((ap && ap[1].split(/\s+/).map((x) => x.toLowerCase()).some(kindOf)) || (was && kindOf((was[1] || was[2] || '').toLowerCase())) || does) c.kind = 'creature';
    }
    // the name the text gives a role is its name: "His name … was Anselm"
    for (const t of ties.filter((y) => y.given)) {
      const c = cast.find((y) => !y.gone && [y.name, ...y.aliases].some((n) => bare(n) === bare(t.name)));
      if (c && bare(c.name) !== bare(t.name)) { const was = c.name; c.name = t.name; c.aliases = [was, ...c.aliases.filter((x) => bare(x) !== bare(t.name))]; c.proper = true; }
    }
    // a role keeps its bare word as an alias too ("warden" for "the warden")
    for (const c of cast) {
      if (/^the\s/i.test(c.name) && !EPITHET.test(c.name) && !c.aliases.some((a) => norm(a) === norm(c.name.slice(4)))) c.aliases.push(c.name.slice(4));
      for (const a of [...c.aliases]) if (/^the\s/i.test(a) && !EPITHET.test(a) && !c.aliases.some((x) => norm(x) === norm(a.slice(4)))) c.aliases.push(a.slice(4));
      c.aliases = c.aliases.filter((a, i, all) => norm(a) !== norm(c.name) && all.findIndex((x) => norm(x) === norm(a)) === i);
    }
    const kept = cast.filter((c) => !c.gone);
    // joined to the Canon's entries by name or alias; a full name to the one
    // entry called by a part of it ("Constance Haddon", "Constance")
    const coreOf = (n) => norm(stripTitles(String(n).replace(/^the\s+/i, '')));
    for (const c of kept) {
      c.entry = [c.name, ...c.aliases].map((n) => findEntry(entries, n)).find(Boolean) || null;
      if (!c.entry && c.kind === 'person' && coreOf(c.name).split(/\s+/).length > 1) {
        const ws = coreOf(c.name).split(/\s+/);
        // (a given name, or a surname written with no title: "Dr Haddon" is no "Constance Haddon")
        const titled = (n) => { const w = String(n).replace(/^the\s+/i, '').split(/\s+/); return w.length > 1 && TITLES.has(norm(w[0]).replace(/\.$/, '')); };
        const by = entries.filter((e) => e.kind === 'person' && !e.locked && [e.name, ...e.aliases].some((n) => { const w = coreOf(n); return w && !/\s/.test(w) && (w === ws[0] || (w === ws[ws.length - 1] && !titled(n))); }));
        if (by.length === 1 && !kept.some((o) => o !== c && o.kind === 'person' && coreOf(o.name).split(/\s+/).includes(coreOf(by[0].name)))) c.entry = by[0];
      }
      // (round 4) a given name's short form with the one surname: "Danny Fell" for the kept "Daniel Fell"
      if (!c.entry && c.kind === 'person' && coreOf(c.name).split(/\s+/).length === 2) {
        const [g, sn] = coreOf(c.name).split(/\s+/);
        const same = (n) => { const w = coreOf(n).split(/\s+/); return w.length === 2 && w[1] === sn && w[0] !== g && w[0].slice(0, 3) === g.slice(0, 3) && g.length >= 3; };
        const by = entries.filter((e) => e.kind === 'person' && !e.locked && [e.name, ...e.aliases].some(same));
        const other = entries.filter((e) => e.kind === 'person' && !e.locked && !by.includes(e) && [e.name, ...e.aliases].some((n) => coreOf(n).split(/\s+/).pop() === sn));
        if (by.length === 1 && !other.length && !kept.some((o) => o !== c && o.kind === 'person' && coreOf(o.name).split(/\s+/).pop() === sn)) c.entry = by[0];
      }
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
  // One person written several ways, by the text's own words (never by the
  // reader's say-so): "Commander Okafor" and "Okafor" (the same name but
  // the title); "Danny" or "Fell" and "Danny Fell" (the full name holds the
  // short one, and no one else's does: two Haddons, no "Haddon"); "the
  // commander", "the doctor" and the one person who holds that rank. Two
  // first names are never one person.
  const RANK = { doctor: ['dr', 'doctor'], commander: ['commander'], inspector: ['inspector'], captain: ['captain', 'capt'], sergeant: ['sergeant', 'sgt'], professor: ['professor', 'prof'],
    lieutenant: ['lieutenant', 'lt'], colonel: ['colonel', 'col'], major: ['major'], general: ['general'], admiral: ['admiral'], nurse: ['nurse'], constable: ['constable'], detective: ['detective'], reverend: ['reverend', 'rev'], judge: ['judge'], mayor: ['mayor'] };
  // "Mrs Abbott" is "Mrs Ida Abbott": the same title and surname, and no one
  // else of the cast holds both (round 4)
  function titleShort(a, c, cast) {
    if (c.kind !== 'person') return false;
    const w = String(a).replace(/^the\s+/i, '').split(/\s+/);
    if (w.length !== 2 || !TITLES.has(norm(w[0]).replace(/\.$/, ''))) return false;
    const holds = (x) => [x.name, ...x.aliases].some((n) => { const v = String(n).split(/\s+/); return v.length >= 3 && norm(v[0]).replace(/\.$/, '') === norm(w[0]).replace(/\.$/, '') && norm(v[v.length - 1]) === norm(w[1]); });
    return holds(c) && !cast.some((x) => x !== c && !x.gone && x.kind === 'person' && holds(x));
  }
  function personMerges(cast, names = null) {
    const people = () => cast.filter((c) => !c.gone && c.kind === 'person' && c.proper);
    const core = (n) => norm(stripTitles(String(n).replace(/^the\s+/i, '')).replace(/['’]s$/, ''));
    const longer = (a, b) => (b.name.split(/\s+/).length > a.name.split(/\s+/).length ? [b, a] : [a, b]);
    // the same name but the title (one with none, or both the same one:
    // "Dr Haddon" and "Mrs Haddon" are two people; "Haddon" beside both, no one)
    const title = (n) => { const w = String(n).replace(/^the\s+/i, '').split(/\s+/); return w.length > 1 && TITLES.has(norm(w[0]).replace(/\.$/, '')) ? norm(w[0]).replace(/\.$/, '') : ''; };
    const fits = (x, y) => core(x) && core(x) === core(y) && (!title(x) || !title(y) || title(x) === title(y));
    for (const a of people()) {
      if (a.gone) continue;
      // (round 3: two whose own names carry different titles are never one, whatever their aliases share: "Dr Haddon", "Mrs Haddon")
      const same = people().filter((b) => b !== a && !(title(a.name) && title(b.name) && title(a.name) !== title(b.name)) && [a.name, ...a.aliases].some((x) => [b.name, ...b.aliases].some((y) => fits(x, y))));
      if (same.length === 1) { const [into, from] = longer(a, same[0]); mergeCast(cast, into, from); }
      else if (same.length > 1 && !title(a.name)) { a.gone = true; a.name = '\u0000'; a.aliases = []; }
    }
    // (round 4) a given name and its short form, with one surname no one else
    // of the cast has: "Danny Fell" and "Daniel Fell"
    for (const a of people()) {
      if (a.gone) continue;
      const wa = core(a.name).split(/\s+/);
      if (wa.length !== 2) continue;
      for (const b of people()) {
        if (b === a || b.gone) continue;
        const wb = core(b.name).split(/\s+/);
        if (wb.length !== 2 || wb[1] !== wa[1] || wb[0] === wa[0] || wb[0].slice(0, 3) !== wa[0].slice(0, 3) || wa[0].length < 3 || wb[0].length < 3) continue;
        if (people().some((o) => o !== a && o !== b && core(o.name).split(/\s+/).length > 1 && core(o.name).split(/\s+/).pop() === wa[1])) continue;
        mergeCast(cast, a, b);
      }
    }
    // (round 4) the title and surname of one full name
    for (const a of people()) {
      if (a.gone) continue;
      const into = people().filter((b) => b !== a && titleShort(a.name, b, cast));
      if (into.length === 1) mergeCast(cast, into[0], a);
    }
    // a short form only one full name holds
    for (const a of people()) {
      if (a.gone) continue;
      const w = core(a.name);
      if (!w || /\s/.test(w)) continue;
      const holders = people().filter((b) => b !== a && [b.name, ...b.aliases].some((y) => core(y).split(/\s+/).length > 1 && core(y).split(/\s+/).includes(w)));
      // (round 3: and none other on the shelf — "Marchetti" beside "Tamsin Marchetti" in the notebook is no one's)
      const onShelf = names && names.get && names.get(w) ? new Set([...names.get(w)].map((n) => norm(n).split(/\s+/)[0]).filter((x) => x !== w)) : new Set();
      if (holders.length === 1 && onShelf.size > 1) { a.gone = true; a.name = '\u0000'; a.aliases = []; continue; }
      if (holders.length === 1) mergeCast(cast, holders[0], a);
      else if (holders.length > 1) { a.gone = true; a.name = '\u0000'; a.aliases = []; } // ("Haddon", with two Haddons: no one)
    }
    // a rank's role and the one who holds the rank (the role's own entry,
    // or the one the text has tied it to: "the doctor", called Arthur)
    for (const r of cast.filter((c) => !c.gone && c.kind === 'person')) {
      if (r.gone) continue;
      const role = [r.name, ...r.aliases].find((n) => /^the\s+\p{Ll}+$/u.test(n) && RANK[n.slice(4)]);
      if (!role) continue;
      const titles = RANK[role.slice(4)];
      const holders = people().filter((b) => b !== r && [b.name, ...b.aliases].some((y) => titles.includes(norm(String(y).replace(/^the\s+/i, '').split(/\s+/)[0]).replace(/\.$/, '')) && String(y).split(/\s+/).length > 1));
      if (holders.length === 1) mergeCast(cast, holders[0], r);
    }
  }
  // (round 4) One name, several people told apart by an epithet: "Absalom
  // Kerr the Elder", "Absalom Kerr the Younger", "Absalom the Third". The
  // text's own forms are the people; the bare name they share is no one's
  // (a reader that made one person of three generations gave every one's
  // eyes and deeds to all). "The Elder" alone is the one form that has it.
  function epithetSplits(cast, text, lower, entries) {
    for (const c of cast.filter((x) => !x.gone && x.kind === 'person' && x.proper)) {
      if (EPITHET_AFTER.test(c.name) || c.gone) continue;
      const base = c.name.replace(/^the\s+/i, '');
      const given = base.split(/\s+/)[0];
      const forms = new Map();
      for (const stem of [...new Set([base, given])]) {
        const re = new RegExp(`(?<![\\p{L}])${escRe(stem)}(${EPITHET_AFTER.source})`, 'gu');
        for (const m of text.matchAll(re)) { const f = stem + m[1]; if (!forms.has(norm(f))) forms.set(norm(f), f.replace(/\s+/g, ' ')); }
      }
      if (!forms.size) continue;
      // (a name written once with an epithet beside its own plain use is one person's grand name, unless two epithets tell two apart)
      const eps = new Set([...forms.values()].map((f) => norm(f.slice(f.search(EPITHET_AFTER)))));
      if (eps.size < 2 && !entries.some((e) => !e.locked && e.kind === 'person' && EPITHET_AFTER.test(e.name) && norm(e.name).startsWith(norm(given)))) continue;
      for (const f of forms.values()) {
        let o = cast.find((x) => !x.gone && [x.name, ...x.aliases].some((n) => norm(n) === norm(f)));
        if (!o) { o = { key: cast.length, name: f, kind: 'person', aliases: [], in: '', proper: true, wanted: [] }; cast.push(o); }
        // "the Elder" alone, when only this form has it and the text writes it so
        const ep = (EPITHET_AFTER.exec(f) || [''])[0].trim();
        if (/^the\s/i.test(ep) && written(text, ep.replace(/^the/, 'The')) + written(text, ep) > 0 && [...forms.values()].filter((g) => norm(g).endsWith(norm(ep))).length === 1 && !o.aliases.some((a) => norm(a) === norm(ep))) o.aliases.push(ep);
        o.aliases = o.aliases.filter((a) => !eps.has(norm(a)) || norm(f).endsWith(norm(a)));
      }
      // the shared name's own aliases that name one form stay that form's; the shared name is no one
      c.gone = true;
      c.name = '\u0000';
      c.aliases = [];
    }
  }
  // (round 4) A nickname the text never declares: "Raff" a line after
  // "Nurse Maud Rafferty" — the start of one person's surname or given
  // name, no other name on the shelf starting so, never written beside it
  // as another, and first used within two paragraphs of the name in full.
  function nicknames(cast, ch, names) {
    const people = cast.filter((c) => !c.gone && c.kind === 'person' && c.proper);
    for (const a of people) {
      if (a.gone || /\s/.test(a.name) || !/^\p{Lu}\p{Ll}{2,6}$/u.test(a.name) || TITLES.has(norm(a.name))) continue;
      const n = norm(a.name);
      const holders = people.filter((b) => b !== a && !b.gone && [b.name, ...b.aliases].some((x) => norm(x).split(/\s+/).some((w) => w.length > n.length + 1 && w.startsWith(n) && !TITLES.has(w))));
      if (holders.length !== 1) continue;
      const b = holders[0];
      // (no other name the shelf writes starts so: "Raff" beside "Rafferty" and "Raffaella" is no one's)
      const shelf = names && names.get ? [...(names.keys ? names.keys() : [])].filter((w) => String(w).startsWith(n) && String(w).length > n.length + 1) : [];
      if (new Set(shelf.map((w) => String(w).slice(0, n.length + 3))).size > 1) continue;
      const re = (x) => new RegExp(`(?<![\\p{L}])${escRe(x)}(?![\\p{L}])`, 'u');
      const full = [b.name, ...b.aliases].filter((x) => /\s/.test(x) || x.length > n.length + 1);
      const at = (pred) => ch.paras.findIndex((p) => pred(p.text));
      const nick = at((t) => re(a.name).test(t));
      const fullAt = at((t) => full.some((x) => re(x).test(t)));
      if (nick < 0 || fullAt < 0 || nick - fullAt > 2 || nick < fullAt) continue;
      if (ch.sents.some((s) => re(a.name).test(s.text) && full.some((x) => re(x).test(s.text)))) continue;
      mergeCast(cast, b, a);
    }
  }
  // (round 4) A numbered place or thing whose number is another's turned
  // round ("Room 41" in a chapter that never writes "Room 14", where Room 14
  // is kept): no new entry; the pass asks about the number.
  function numberedSlips(cast, text, entries) {
    for (const c of cast) {
      if (c.gone || c.entry) continue;
      const m = /^(.*\S)\s+(\d{2,4})$/.exec(c.name);
      if (!m) continue;
      const turned = entries.find((e) => !e.locked && new RegExp(`^${escRe(m[1])}\\s+(\\d{2,4})$`, 'i').test(e.name) && e.name !== c.name && [...e.name.match(/\d+$/)[0]].sort().join('') === [...m[2]].sort().join(''));
      if (turned && !written(text, turned.name)) { c.gone = true; c.name = '\u0000'; c.aliases = []; }
    }
  }
  function mergeCast(cast, into, from) {
    for (const a of [from.name, ...from.aliases]) if (!into.aliases.some((x) => norm(x) === norm(a)) && norm(a) !== norm(into.name)) into.aliases.push(a);
    // (a name before a role, and a person's own name before an epithet: "Dr Haddon", not "the Old Man")
    const numberName = (n) => NUMBER.test(norm(n).split('-')[0]);
    if ((!into.proper && from.proper) || (into.kind === 'person' && /^the\s/i.test(into.name) && !/^the\s/i.test(from.name) && from.proper) || (numberName(into.name) && !numberName(from.name) && from.proper)) { const was = into.name; into.name = from.name; into.aliases = [was, ...into.aliases.filter((x) => norm(x) !== norm(from.name))]; into.proper = true; }
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
      const persons = new Set(cast.filter((c) => !c.gone && ['person', 'creature'].includes(c.kind)).map((c) => c.key));
      const free = (a, b) => !p.talk.some(([x, y]) => a < y && b > x);
      const asWritten = (h) => { let ref = p.text.slice(h.start, h.end); if (/^\p{Ll}/u.test(ref) && /\bthe\s+$/i.test(p.text.slice(0, h.start))) ref = 'the ' + ref; return ref; };
      for (const s of p.sents) {
        // a number for a name, in narration: "Teodora Kask had been Nine for
        // three years", "Ada was Fourteen"
        for (const m of s.text.matchAll(/(?<![\p{L}])(?:had been|has been|was|is|became)\s+((?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Thirty|Forty|Fifty|Sixty|Seventy|Eighty|Ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?)(?![\p{L}-])/gu)) {
          const pos = s.start + m.index;
          const h = hits.find((x) => persons.has(x.key) && /^\s+$/.test(p.text.slice(x.end, pos)) && x.end <= pos);
          if (!h || !free(h.start, pos + m[0].length) || s.said) continue;
          out.push({ key: h.key, ref: asWritten(h), name: m[1], given: false, sentence: s.text });
        }
        // "The vicar, the Reverend Amos Lyle, came…": a role and a name side
        // by side, set off by commas (not a list: no "and" after)
        const inS = hits.filter((h) => h.start >= s.start && h.end <= s.end && persons.has(h.key));
        for (let i = 0; i + 1 < inS.length; i++) {
          const [a, b] = [inS[i], inS[i + 1]];
          if (a.key === b.key || !free(a.start, b.end)) continue;
          const gap = p.text.slice(a.end, b.start);
          if (!/^,\s+(?:the\s+)?(?:\p{Lu}[\p{L}.]*\s+)?$/u.test(gap)) continue;
          const after = p.text.slice(b.end, b.end + 8);
          if (!/^\s*[,.;—–]/u.test(after) || /^\s*,\s*(?:and|or|nor)\b/i.test(after)) continue;
          const ra = asWritten(a);
          const rb = asWritten(b);
          // (one a role in lower case, the other a name)
          if (/^the\s+\p{Ll}/u.test(ra) === /^the\s+\p{Ll}/u.test(rb)) continue;
          out.push({ key: a.key, ref: ra, name: rb, given: false, sentence: s.text, apposition: true });
        }
        if (!NAMING.test(s.text)) continue;
        const pats = [
          [/(?<![\p{L}])([Hh]is|[Hh]er|[Ii]ts)\s+(?:real\s+|true\s+|own\s+)?name\b[\s\S]*?\b(?:was|is)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, true],
          [/(?<![\p{L}])(?:called|named|call|calls|nicknamed)\s+(him|her|it)\s+((?:the\s+)?(?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, false],
          [/(?<![\p{L}])([Hh]e|[Ss]he|[Ii]t)\s+(?:was|is)\s+(?:called|named|known as)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+)?)/u, true]
        ];
        for (const [re, given] of pats) {
          const m = re.exec(s.text);
          if (!m) continue;
          const pos = s.start + m.index;
          // (not the one who does the calling: "Constance called him Arthur")
          const before = hits.filter((h) => h.end <= pos && persons.has(h.key) && !(given === false && /^[\s\p{Ll}]*$/u.test(p.text.slice(h.end, pos)) && h.end > s.start));
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

  /* ---------- the narrator ---------- */

  // A story told in the first person: "I", "me", "my" in the narration
  // (outside speech) five times or more. The lead is the narrator, who gets
  // an entry like anyone else: named when someone names them to their face
  // ("“You’ll be wanting your tea, Nell,” Granny Ruth said … in front of
  // me") or the narration does ("called me Nell", "my name was Ida", "At
  // home I was Eleanor"); else "the narrator".
  const SELF = /(?<![\p{L}'’])(I|me|my|myself|mine|Me|My|Myself|Mine)(?![\p{L}'’])/gu;
  function selfHits(p) {
    const out = [];
    for (const m of p.text.matchAll(SELF)) {
      if (p.talk.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
      out.push({ start: m.index, end: m.index + m[0].length, word: m[0].toLowerCase() });
    }
    return out;
  }
  function firstPerson(ch) {
    return ch.paras.reduce((n, p) => n + selfHits(p).length, 0) >= 5;
  }
  function narratorNames(ch, cast, lower) {
    const ok = (w) => w && /^\p{Lu}\p{Ll}/u.test(w) && !nonEntity(w, 'person') && !TITLES.has(w.toLowerCase()) && !(lower && lower.has(w.toLowerCase())) && !PRONOUNS[w.toLowerCase()];
    const strong = [];
    const weak = [];
    const voc = [];
    const asOther = new Set(); // a name the narration uses for someone else ("Nell said")
    for (const p of ch.paras) {
      const narr = (a, b) => !p.talk.some(([x, y]) => a < y && b > x);
      for (const m of p.text.matchAll(/(?<![\p{L}])(?:called|call|calls|named)\s+me\s+(\p{Lu}[\p{L}'’-]+)|(?<![\p{L}])[Mm]y\s+name\s+(?:is|was)\s+(\p{Lu}[\p{L}'’-]+)/gu)) {
        if (narr(m.index, m.index + m[0].length)) strong.push((m[1] || m[2]).replace(/['’]s$/, ''));
      }
      for (const m of p.text.matchAll(/(?<![\p{L}])I\s+(?:was|am|’m|'m)\s+(\p{Lu}[\p{L}'’-]+)(?=\s*[,.;!?]|\s+to\b)/gu)) {
        if (narr(m.index, m.index + m[0].length)) weak.push(m[1]);
      }
      // a name said to someone in a paragraph whose narration has "me" in the same sentence
      for (const s of p.sents) {
        const narration = selfHits(p).filter((h) => h.start >= s.start && h.end <= s.end && h.word === 'me');
        if (!narration.length) continue;
        for (const [a, b] of speechSpans(p.text)) {
          if (a < s.start || b > s.end + 1) continue;
          const said = p.text.slice(a, b);
          for (const m of said.matchAll(/(?:^[“"‘']\s*(\p{Lu}\p{Ll}+)\s*,|,\s*(\p{Lu}\p{Ll}+)\s*[,.!?]\s*[”"’']?\s*$|,\s*(\p{Lu}\p{Ll}+)\s*[,.!?])/gu)) voc.push(m[1] || m[2] || m[3]);
        }
      }
      for (const m of p.text.matchAll(/(?<![\p{L}])(\p{Lu}\p{Ll}+)\s+(?:said|asked|told|was|had|did|went|came|looked|turned|smiled|nodded|laughed)\b/gu)) if (narr(m.index, m.index + m[0].length)) asOther.add(m[1]);
    }
    const good = (w) => ok(w) && !asOther.has(w);
    // the narration's own word first, then a name said to the narrator's face
    const name = strong.find(good) || voc.find(good) || null;
    if (!name) return { name: null, aliases: [] };
    // ("At home I was Eleanor": a second name, beside the first)
    return { name, aliases: [...new Set([...strong, ...voc, ...weak])].filter((w) => w !== name && good(w)) };
  }

  /* ---------- 2 · passage packs ---------- */

  // Where each cast member is named in the chapter: its names and aliases,
  // and for a place with a name of two words or more, "the <last word>"
  // when nothing else has that word and nothing qualifies it ("the room",
  // not "the room with the green tiles")
  function chapterHits(ch, cast) {
    const idx = mentionIndex(cast.filter((c) => !c.narrator || c.proper).map((c) => ({ id: c.key, name: c.narrator && !c.proper ? '\u0000' : c.name, kind: c.kind, aliases: c.aliases })));
    const me = cast.find((c) => c.narrator);
    const heads = new Map();
    for (const c of cast) {
      if (c.kind !== 'place' || c.name.split(/\s+/).length < 2) continue;
      const head = c.name.split(/\s+/).pop().toLowerCase();
      if (head.length < 3 || cast.some((x) => x !== c && [x.name, ...x.aliases].some((n) => n.split(/\s+/).pop().toLowerCase() === head))) continue;
      heads.set(head, c.key);
    }
    // (round 3) the noun a place's, group's or thing's own description gives
    // it: "The Lantern House stood at the end of the breakwater, a round tower
    // of black stone" → "the tower"; "Dunmere itself was a small grey town" →
    // "the town" (when no one else of the cast is called so)
    const described = new Map();
    for (const p of ch.paras) {
      for (const m of mentions(p.text, idx)) {
        const c = cast.find((x) => x.key === m.id);
        if (!c || ['person', 'creature', 'rule'].includes(c.kind)) continue;
        const lead = p.text.slice(Math.max(0, m.start - 6), m.start);
        if (!/(?:^|[.!?”"]\s+|^\s*[Tt]he\s+)$/.test(p.text.slice(0, m.start)) && !/(?:^|\.\s+)(?:[Tt]he\s+)?$/.test(lead)) continue;
        const d = /^(?:\s+itself)?\s+(?:was|is|stood|stands|lay|lies|sat|sits)\b[^.;!?]*?(?:,\s+|\s)(?:a|an)\s+((?:[\p{L}-]+\s+){0,3}?)(\p{Ll}[\p{Ll}-]{2,})(?=\s+(?:of|with|that|which|where|who|built|on|in|at|for|by|under|above|below|near|beside|sunk|set|hung|\p{Ll}+ed)\b|\s*[,.;:]|$)/u.exec(p.text.slice(m.end, m.end + 160));
        if (!d) continue;
        const noun = d[2];
        if (FIXTURES.has(noun) || CROWD.has(noun) || described.has(noun) || noun.length < 3) { if (described.get(noun) !== c.key) described.set(noun, null); continue; }
        if (cast.some((x) => x !== c && [x.name, ...x.aliases].some((n) => norm(n).split(/\s+/).pop() === noun))) continue;
        described.set(noun, c.key);
      }
    }
    for (const [noun, key] of described) if (key != null && !heads.has(noun)) heads.set(noun, key);
    return ch.paras.map((p) => {
      const hits = mentions(p.text, idx).map((m) => ({ key: m.id, start: m.start, end: m.end, via: m.via }));
      // the narrator: "I", "me", "my" in the narration
      if (me) for (const h of selfHits(p)) if (!hits.some((x) => x.start < h.end && x.end > h.start)) hits.push({ key: me.key, start: h.start, end: h.end, via: 'self' });
      for (const [head, key] of heads) {
        // ("the house", and in the narration "my grandmother’s house")
        for (const m of p.text.matchAll(new RegExp(`(?<![\\p{L}])(?:[Tt]he|(?:(?:[Mm]y|[Hh]is|[Hh]er|[Tt]heir|[Oo]ur)\\s+)?\\p{Ll}+['’]s)\\s+${escRe(head)}(?![\\p{L}])(?!\\s+(?:with|of|that|where|which|on|in|at|behind|beside|across)\\b)`, 'gu'))) {
          if (!/^the\s/i.test(m[0]) && p.talk.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
          const at = /^the\s/i.test(m[0]) ? m.index : m.index + m[0].length - head.length;
          if (hits.some((h) => h.start < m.index + m[0].length && h.end > at)) continue;
          hits.push({ key, start: at, end: m.index + m[0].length, via: 'head' });
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
      const ph = hits[p.pi].filter((h) => living.has(h.key) && free(h) && h.via !== 'self');
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
  // Whom each he, she, his, her, it and its in the narration means (round 3:
  // a pack that followed only a sentence-opening pronoun lost "A white scar
  // ran through her left eyebrow" and a boy's whole introduction after a
  // line of his speech). Read in order, as a reader would:
  //   · a pronoun opening a sentence goes on with the last sentence's subject
  //     ("Juniper, the bay mare, had crossed the Saltings more times than Wren
  //     could count. She was fourteen": the mare, not Wren in the "than");
  //   · an owning his/her/its, the subject of its own clause ("Mara kept a
  //     key on a cord around her neck");
  //   · a him/her that is an object is never its clause's subject ("said
  //     Tobias, coming down to meet her": not Tobias);
  //   · otherwise the last one named whose sex (if known) agrees.
  // it/its/they mean a place, thing or group of the paragraph only. A choice
  // made by those rules, or with only one who agrees, is strong; else weak,
  // and the others who agree are `alt`. Each paragraph gets `refs`: start →
  // { key, strong, alt }. → per sentence id: { keys: Set, weak: Set }
  const PRON = { he: ['male', 's'], she: ['female', 's'], him: ['male', 'o'], himself: ['male', 'o'], his: ['male', 'p'], hers: ['female', 'o'], herself: ['female', 'o'], her: ['female', '?'],
    it: ['it', '?'], its: ['it', 'p'], itself: ['it', 'o'], they: ['they', 's'], them: ['they', 'o'], their: ['they', 'p'], themselves: ['they', 'o'] };
  const OPENERS = new Set(['then', 'and', 'but', 'so', 'now', 'still', 'later', 'once', 'yet', 'there', 'here', 'soon', 'afterwards', 'meanwhile', 'inside', 'outside', 'today', 'tonight']);
  const EXPLETIVE = /^\s*(?:was|is|had been|has been|would be|seemed|felt|took|came)\s+(?:a\s+|an\s+|the\s+)?(?:\p{Ll}+\s+){0,2}?(?:that|to|when|as if|odd|strange|clear|true|late|early|time|night|morning|evening|raining|snowing|no use|no good|said|thing)\b/iu;
  const refMemo = new WeakMap();
  const GROOM = /^(?:rubbed|rubs|rub|shook|shakes|scratched|wiped|bit|licked|closed|opened|narrowed|lifted|raised|lowered|bowed|tilted|cocked|touched|folded|crossed|clenched|shut|blinked|covered|pressed|tossed|nodded|shaded|squeezed|screwed|flattened|pricked|pinned|arched|swished|stamped)$/i;
  const BODY = /^(?:eyes?|head|hands?|face|hair|lips?|nose|brow|forehead|shoulders?|neck|arms?|knees?|teeth|mouth|chin|cheeks?|fists?|fingers?|ears?|temples?|eyebrows?|mane|tail|hooves?|hoof|feet|foot)$/i;
  function resolveRefs(ch, hits, cast, sexOf) {
    if (refMemo.has(hits)) return refMemo.get(hits);
    const byKey = new Map(cast.map((x) => [x.key, x]));
    const living = (k) => byKey.has(k) && ['person', 'creature'].includes(byKey.get(k).kind);
    const learned = new Map();
    // what the chapter's own nouns say ("Juniper, the bay mare"; "Old Hesketh, a
    // small weathered man"; "He was a thin boy"), and its pronoun votes
    const hinted = sexHints(ch, hits, cast);
    const nouns = new Map();
    for (const p of ch.paras) {
      for (const h of hits[p.pi] || []) {
        if (!living(h.key) || p.talk.some(([a, b]) => h.start < b && h.end > a)) continue;
        const m = /^\s*(?:,|\s(?:was|is))\s*(?:the|a|an|his|her|their|my|\p{Lu}\p{L}+['’]s)\s+((?:[\p{L}-]+,?\s+){0,3}[\p{L}-]+)/u.exec(p.text.slice(h.end, h.end + 60));
        const w = m && m[1].split(/[\s,]+/).find((x) => SEX_WORDS[x]);
        if (w && SEX_WORDS[w] && !nouns.has(h.key)) nouns.set(h.key, SEX_WORDS[w][0]);
        // ("a collie bitch called Moss": the noun before the name)
        const b = /(?:^|\s)(?:a|an|the|his|her|their|my)\s+(?:[\p{L}-]+\s+){0,2}?([\p{Ll}]+)\s+(?:called|named)\s+$/u.exec(p.text.slice(Math.max(0, h.start - 60), h.start));
        if (b && SEX_WORDS[b[1]] && !nouns.has(h.key)) nouns.set(h.key, SEX_WORDS[b[1]][0]);
      }
    }
    const sex = (k) => (k === -1 ? null : (sexOf && sexOf(k)) || nouns.get(k) || hinted.get(k) || learned.get(k) || null);
    const OTHER_NP = /(?:^|[,;]\s+|\b(?:and|but|then|when)\s+)(?:a|an|one|another|some)\s+(?:[\p{Ll}-]+\s+){0,2}?(woman|man|girl|boy|lad|lass|stranger|rider|soldier|child|figure|fellow|gentleman|lady|mare|stallion|gelding|horse|dog)\b/u;
    const agrees = (k, want) => {
      if (k === -1) return ['male', 'female'].includes(want);
      if (k === -2) return ['it', 'they'].includes(want);
      if (want === 'it') return !living(k) && byKey.has(k) && byKey.get(k).kind !== 'group';
      if (want === 'they') return byKey.has(k) && byKey.get(k).kind === 'group';
      if (!living(k)) return false;
      const s = sex(k);
      return !s || s === want;
    };
    const out = new Map();
    let carry = []; // the living named before this paragraph, latest last
    let lastSubject = null;
    for (const p of ch.paras) {
      p.refs = new Map();
      const talk = (a, b) => p.talk.some(([x, y]) => a < y && b > x);
      const ph = (hits[p.pi] || []).filter((h) => !talk(h.start, h.end) && h.via !== 'self');
      const seen = []; // { key, at, subj } in this paragraph
      let subjectBefore = lastSubject;
      for (const s of p.sents) {
        const info = { keys: new Set(), weak: new Set() };
        out.set(s.id, info);
        const items = [];
        for (const h of ph.filter((x) => x.start >= s.start && x.end <= s.end)) items.push({ at: h.start, end: h.end, key: h.key });
        for (const m of s.text.matchAll(/(?<![\p{L}'’-])(he|she|him|himself|his|hers|herself|her|it|its|itself|they|them|their|themselves)(?![\p{L}'’-])/giu)) {
          const at = s.start + m.index;
          if (talk(at, at + m[0].length) || items.some((x) => x.at <= at && x.end > at)) continue;
          items.push({ at, end: at + m[0].length, pron: m[1].toLowerCase() });
        }
        // "a woman from the Guild was counting the lamps": someone the cast doesn't hold yet
        const np = OTHER_NP.exec(s.text);
        if (np && !items.some((x) => x.at < s.start + np.index) && !PREP.has(((s.text.slice(0, np.index).match(/([\p{L}'’-]+)\s*$/u) || [])[1] || '').toLowerCase())) items.push({ at: s.start + np.index + np[0].length - np[1].length, end: s.start + np.index + np[0].length, key: -1 });
        // "The river was brown and fast…": a subject the cast doesn't hold, which an "it" after it may mean
        const thing = /^[\s“"‘']*(?:(?:then|and|but|so|now|later|inside|outside)[\s,]+)?((?:The|A|An|This|That|These|Those|Every|Each|No)\s+(?:[\p{Ll}-]+\s+){0,3}?)(?:was|were|is|are|had|has|stood|ran|lay|came|went|rose|fell|smelled|smelt|sounded|looked|seemed|sat|hung|\p{Ll}+ed)\b/u.exec(s.text);
        if (thing && !items.some((x) => x.key != null && x.at < s.start + thing.index + thing[0].length)) items.push({ at: s.start + thing.index + thing[0].indexOf(thing[1]), end: s.start + thing.index + thing[0].indexOf(thing[1]) + thing[1].length, key: -2 });
        items.sort((a, b) => a.at - b.at);
        let clauseSubject = null;
        let sentSubject = null;
        let lastEnd = s.start;
        for (const it of items) {
          const lead = p.text.slice(s.start, it.at);
          // (a clause ends at a comma, semicolon or dash before a conjunction, or at "when", "because"…)
          if (/(?:[;:—–]|(?<![\p{L}])(?:and|but|or|so|yet|while|when|because|though|although|until|before|after|since|than|whom|who|which|where))\s/iu.test(p.text.slice(lastEnd, it.at) + ' ') && lastEnd > s.start) clauseSubject = null;
          lastEnd = it.end;
          const words = (lead.match(/[\p{L}'’-]+/gu) || []).map((w) => w.toLowerCase());
          const prev = words[words.length - 1] || '';
          // a new clause: ", and she", "; he", "when she"
          const freshClause = /(?:[,;:—–]|(?<![\p{L}])(?:and|but|while|when|because|though|although|until|before|after|so|then|yet|as|since|where))\s*$/iu.test(lead);
          const object = PREP.has(prev) || prev === 'of';
          if (it.key != null) {
            // (the subject: the first one named not after a preposition, or a fresh clause's)
            if (!object && (sentSubject == null || freshClause)) { if (sentSubject == null) sentSubject = it.key; clauseSubject = it.key; }
            seen.push({ key: it.key, at: it.at, subj: clauseSubject === it.key });
            if (it.key >= 0) info.keys.add(it.key);
            continue;
          }
          const [want, role0] = PRON[it.pron];
          let role = role0;
          const next = (p.text.slice(it.end).match(/^\s*([\p{L}'’-]+)/u) || [])[1] || '';
          if (role === '?') {
            const nx = next.toLowerCase();
            if (it.pron === 'her') role = !nx || PREP.has(nx) || ['and', 'or', 'but', 'that', 'a', 'an', 'the', 'to', 'as', 'so', 'once', 'again', 'back', 'up', 'down', 'off', 'out', 'away', 'go', 'be', 'too', 'gently', 'there', 'here', 'now', 'then', 'herself', 'his', 'her', 'their', 'its', 'my'].includes(nx) || /[,.;:!?]/.test(p.text.slice(it.end, it.end + 1)) ? 'o' : 'p';
            else role = !words.length || freshClause || OPENERS.has(prev) || /^(?:inside|outside)$/.test(prev) ? 's' : 'o';
          }
          // ("It was an odd thing to say", "It was late": no one)
          if (it.pron === 'it' && role === 's' && EXPLETIVE.test(p.text.slice(it.end))) continue;
          const atStart = !words.filter((w) => !OPENERS.has(w)).length;
          // "Her name was Ines Garrow": the one named
          const naming = /^\s+(?:real\s+|full\s+|own\s+)?name\s+(?:was|is)\s*$/i.test(p.text.slice(it.end, (items.find((x) => x.at > it.at && x.key != null) || { at: -1 }).at));
          if (naming && role === 'p') {
            const named = items.find((x) => x.at > it.at && x.key != null);
            if (named && named.key !== -1) { p.refs.set(it.at, { key: named.key, strong: true, alt: [] }); info.keys.add(named.key); continue; }
          }
          // (an "it" that is an object means the paragraph's place only when it opened the paragraph)
          // (or a thing named just before: "The gift came… The warden poured it")
          const thingNear = want === 'it' && role === 'o' && seen.filter((x) => x.key >= 0 && byKey.get(x.key) && byKey.get(x.key).kind === 'thing' && (p.sents.findIndex((y) => x.at >= y.start && x.at < y.end) >= p.sents.indexOf(s) - 1)).pop();
          if (want === 'it' && role === 'o' && !thingNear && !(seen[0] && seen[0].subj && !living(seen[0].key) && seen[0].key !== -1)) continue;
          // (an it or its means a place or thing that was a subject here, never one only after a preposition)
          const pool = [...seen.filter((x) => x.at < it.at && (!['it', 'they'].includes(want) || x.subj || x.key === -2 || (thingNear && x === thingNear)))].reverse();
          const cands = [];
          const push = (k) => { if (k != null && agrees(k, want) && !cands.includes(k)) cands.push(k); };
          for (const x of pool) push(x.key);
          let pick = null;
          let strong = false;
          const exclude = role === 'o' ? clauseSubject : null;
          let fromCarry = false;
          if (['male', 'female'].includes(want) && !cands.filter((k) => k !== exclude).length) { fromCarry = true; for (const x of [...carry].reverse()) push(x.key); }
          const ok = cands.filter((k) => k !== exclude);
          // (round 4) an animal is "it" or its name: a he or she means one
          // whose sex the text has not given only when it goes on with the
          // animal as the subject and no person could be meant instead
          // ("Smut, the mill cat, fell asleep on his chest": the Younger's chest)
          if (['male', 'female'].includes(want)) {
            const subj = role === 's' ? (sentSubject != null ? sentSubject : subjectBefore) : null;
            const beast = (k) => k >= 0 && byKey.get(k) && byKey.get(k).kind === 'creature' && !sex(k);
            const gone = ok.filter(beast).filter((k) => !(subj === k && !ok.some((x) => x !== k && x >= 0 && byKey.get(x) && byKey.get(x).kind === 'person')));
            for (const k of gone) ok.splice(ok.indexOf(k), 1);
            // (the nearest was the animal: no one is sure, so no one)
            // (unless it owns something in a sentence whose subject is a person who agrees: "the Younger sat …, and Smut fell asleep on his chest")
            if (gone.length && gone.includes(cands[0]) && !(role === 'p' && sentSubject != null && ok.includes(sentSubject))) continue;
          }
          // (round 3) a body part a verb of the subject's own handles is the
          // subject's, whatever the pronoun says: "He rubbed her eyes with the
          // heel of her hand" (the boy's eyes, the pronoun a slip)
          // (and no one else named between: "Bramble, beside Rook, tossed his head" may be Rook's)
          const subjAt = Math.max(-1, ...seen.filter((x) => x.key === clauseSubject).map((x) => x.at));
          if (role === 'p' && clauseSubject != null && clauseSubject >= 0 && living(clauseSubject) && !seen.some((x) => x.at > subjAt && x.at < it.at && x.key !== clauseSubject && (x.key === -1 || living(x.key))) && GROOM.test(prev) && BODY.test((p.text.slice(it.end).match(/^\s+(?:(?:left|right|own|tired|sore|wet|cold)\s+)?([\p{L}]+)/u) || [])[1] || '')) {
            p.refs.set(it.at, { key: clauseSubject, strong: true, alt: [], body: true });
            info.keys.add(clauseSubject);
            continue;
          }
          // a subject goes on with this sentence's subject, else the last sentence's;
          // an owner is its clause's subject, else the same
          const prefer = role === 's' ? [sentSubject, sentSubject == null ? subjectBefore : null] : role === 'p' ? [clauseSubject, clauseSubject == null && sentSubject == null ? subjectBefore : null] : [];
          const pref = prefer.find((k) => k != null && ok.includes(k));
          if (pref != null) { pick = pref; strong = true; }
          else if (ok.length) {
            pick = ok[0];
            // (from paragraphs before: the latest who agrees, unless another who agrees was named as lately)
            const at = (k) => (carry.find((x) => x.key === k) || { pi: -9 }).pi;
            strong = ok.length === 1 || (fromCarry && ok.slice(1).every((k) => at(k) < at(pick) - 1));
          }
          if (pick == null) continue;
          if (pick === -2) { if (role === 's') { clauseSubject = -2; if (sentSubject == null) sentSubject = -2; } continue; }
          if (pick === -1) { if (role === 's') { clauseSubject = -1; if (sentSubject == null) sentSubject = -1; } seen.push({ key: -1, at: it.at, subj: role === 's' }); continue; }
          const alt = strong ? [] : ok.filter((k) => k !== pick && k !== -1);
          if (strong && !sex(pick) && ['male', 'female'].includes(want)) learned.set(pick, want);
          p.refs.set(it.at, { key: pick, strong, alt });
          (strong ? info.keys : info.weak).add(pick);
          for (const k of alt) info.weak.add(k);
          if (role === 's' || (role === 'p' && !sentSubject && atStart)) { if (!sentSubject) sentSubject = pick; clauseSubject = pick; }
          seen.push({ key: pick, at: it.at, subj: role === 's' });
        }
        if (sentSubject != null) subjectBefore = sentSubject;
      }
      for (const x of seen) if (x.key === -1 || living(x.key)) carry = [...carry.filter((y) => y.key !== x.key), { key: x.key, pi: p.pi }].slice(-4);
      lastSubject = subjectBefore != null && (subjectBefore === -1 || living(subjectBefore)) ? subjectBefore : lastSubject;
    }
    refMemo.set(hits, out);
    return out;
  }
  // The sentences about one cast member, each with why it is there (round
  // 3: a sentence belongs to every one it is about, not only the first
  // named): 'name' (named, by name, alias or "the tower" its own description
  // gave it), 'chain' (a pronoun meant for it), 'near' (a pronoun that may
  // be it, the rules unsure), 'para' (a place's, group's or thing's
  // paragraph: one that opens with it as the subject, until another of its
  // kind is), 'setting' (the chapter's place), 'context' (the sentence
  // before a pronoun's, when that isn't in the pack)
  function packFor(ch, hits, cast, c, sexOf) {
    const out = new Map();
    const refs = resolveRefs(ch, hits, cast, sexOf);
    const byKey = new Map(cast.map((x) => [x.key, x]));
    const living = (k) => byKey.has(k) && ['person', 'creature'].includes(byKey.get(k).kind);
    const add = (s, why) => { if (!out.has(s.id) || ['setting', 'context'].includes(out.get(s.id))) out.set(s.id, why); };
    for (const p of ch.paras) {
      const ph = hits[p.pi] || [];
      const talk = (a, b) => p.talk.some(([x, y]) => a < y && b > x);
      // the place (or thing, or group) a paragraph is about, sentence by
      // sentence: the one named as a subject, else the last named (not in
      // talk); kept while no one living is the subject and nothing else of
      // its kind is named
      let topic = null;
      const isObj = (h) => { const w = (p.text.slice(p.sents.find((x) => h.start >= x.start && h.start < x.end).start, h.start).match(/([\p{L}'’-]+)\s*(?:the\s+)?$/iu) || [])[1]; return !!w && (PREP.has(w.toLowerCase()) || w.toLowerCase() === 'of'); };
      for (const [si, s] of p.sents.entries()) {
        const here = ph.filter((h) => h.start >= s.start && h.end <= s.end);
        const r = refs.get(s.id) || { keys: new Set(), weak: new Set() };
        const livingSubject = /^[\s“"‘']*(?:(?:then|and|but|so|now|later|still)\s+)?(?:he|she|i|we|you)\b/i.test(s.text) || [...p.refs.entries()].some(([at, x]) => at >= s.start && at < s.end && x.strong && living(x.key) && /^(?:he|she)$/i.test(p.text.slice(at, at + 3).trim())) || (() => { const f = here.filter((h) => !talk(h.start, h.end))[0]; return !!f && living(f.key) && !isObj(f) && !/['’]s$/.test(p.text.slice(f.end, f.end + 2)); })();
        if (!living(c.key)) {
          // (a place becomes the topic as a subject; only after a preposition when there is none yet;
          // someone living as the subject ends it — "She was thirty-four…", then "A white scar ran through her…")
          const places = here.filter((h) => !talk(h.start, h.end) && byKey.has(h.key) && !living(h.key));
          const personal = [...p.refs.entries()].some(([at, x]) => at >= s.start && at < s.end && x.strong && living(x.key));
          if (livingSubject || (personal && !places.some((h) => !isObj(h)))) topic = null;
          else if (places.length) { const sub = places.find((h) => !isObj(h)); if (sub) topic = sub.key; else if (topic == null) topic = places[places.length - 1].key; }
        }
        if (here.some((h) => h.key === c.key)) {
          add(s, 'name');
          // (a little context: the sentence before, when it defines something of the cast this
          // one leans on — "The “Spared” were the ones born inside. Hesper had been born…")
          const prev = si > 0 && p.sents[si - 1];
          if (prev && !out.has(prev.id) && (ph.some((h) => h.start >= prev.start && h.end <= prev.end && h.key !== c.key && byKey.has(h.key) && ['group', 'thing'].includes(byKey.get(h.key).kind)) || /^(?:they|it)\b/i.test(prev.text))) add(prev, 'context');
          continue;
        }
        // a notes line that opens with the name: "Ivo Marchetti: thirty-four … Brown eyes. Never drinks."
        if (ch.notes && !here.length && ph[0] && ph[0].key === c.key && ph[0].start === 0 && /^\s*[:,—–]/.test(p.text.slice(ph[0].end))) { add(s, 'name'); continue; }
        if (r.keys.has(c.key)) { add(s, 'chain'); if (si > 0 && !out.has(p.sents[si - 1].id)) add(p.sents[si - 1], 'context'); continue; }
        if (r.weak.has(c.key)) { add(s, 'near'); continue; }
        if (topic === c.key && !livingSubject && !here.some((h) => !talk(h.start, h.end) && living(h.key))) { add(s, 'para'); continue; }
        if (c.setting && !s.said) add(s, 'setting');
      }
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
  // (round 3: in the clause that holds most of the value's words — "He did
  // not talk much, but on Sundays he took me out…" is no "not" on Sundays)
  function localNeg(text, words) {
    const segs = text.split(/[,;:—–]|\s(?=(?:but|yet|though|although|whereas)\s)/i);
    const count = (seg) => { const st = tokens(seg).map(stem); return st.filter((x) => words.some((w) => w === x || inBag(w, new Set([x])))).length; };
    const best = Math.max(...segs.map(count));
    if (!best) return false;
    for (const seg of segs.filter((x) => count(x) === best)) {
      const ts = tokens(seg);
      const st = ts.map(stem);
      for (let i = 0; i < ts.length; i++) {
        if (!words.some((w) => w === st[i] || inBag(w, new Set([st[i]])))) continue;
        if (NEGATORS.has(ts[i]) && words.includes(st[i])) return true; // ("never" is the value's own word)
        if (ts.slice(Math.max(0, i - 5), i).some((w, k, arr) => NEGATORS.has(w) && !(w === 'without' && arr.length - k > 2))) return true;
      }
    }
    return false;
  }
  // what is done more than once, in so many words (round 2: "all" and "any"
  // made one moment a habit)
  const HABITUAL = /(?<![\p{L}])(?:always|every|each|never|usually|often|ever|would|used to|whenever|daily|nightly|weekly|the same|again and again|by height|the way it|habit|habits|rules?|allowed|nobody|no one|seldom|rarely|sometimes|most days|on (?:mon|tues|wednes|thurs|fri|satur|sun)days|in the (?:mornings|evenings|afternoons)|at nights?|winter and summer|in (?:the )?(?:winter|summer|spring|autumn)s?|of an? (?:morning|evening|night)|after (?:the\s+)?\p{Ll}+ came|the (?:mon|tues|wednes|thurs|fri|satur|sun)day \p{Ll}+)(?![\p{L}])/iu;
  // a role that was, not one that is: "had been a soldier", "used to be",
  // "formerly" (but "had been the town's doctor for twenty-two years" still is)
  const PAST_ROLE = /(?<![\p{L}])(?:had been|used to be|was once|once was|formerly|former|ex-|retired|until)(?![\p{L}])/iu;
  const ONGOING = /(?<![\p{L}])(?:for (?:\S+\s+){0,2}(?:years?|months?|weeks?|decades?)|since)(?![\p{L}])/iu;
  // at most 30 words (the quote gate's limit): the 30 around the value's words
  function fit(text, words) {
    const ws = text.split(/\s+/);
    if (ws.length <= 30) return text;
    const at = ws.findIndex((w) => words.some((x) => inBag(x, new Set(content(w)))));
    const from = Math.max(0, Math.min(ws.length - 30, (at < 0 ? 0 : at) - 8));
    return ws.slice(from, from + 30).join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '');
  }
  // Whose is the claim in this sentence? (round 2: a fact must be tied to
  // its entity by the sentence's grammar, not by standing near it.) The
  // claim's first word is owned by a possessive just before it ("her green
  // eyes", "my father's grey eyes", "Mara's brother"), else by the clause's
  // subject: the last one named before it who is not the object of a
  // preposition ("above the Sare", "below her", "at Saltby") — or, when
  // a name follows "called"/"named" just after the claim ("a collie bitch
  // called Moss"), that one. A pronoun opening a sentence the pack tied to
  // `c` is `c`'s. → a cast key, or null when the sentence doesn't say.
  const PREP = new Set(['in', 'on', 'at', 'by', 'to', 'from', 'with', 'without', 'for', 'into', 'onto', 'over', 'under', 'above', 'below', 'beneath', 'beside', 'behind', 'near', 'past', 'through', 'across', 'along', 'around', 'among', 'between', 'toward', 'towards', 'off', 'up', 'down', 'than', 'like', 'about', 'after', 'before', 'beyond', 'inside', 'outside', 'upon', 'within', 'against', 'except', 'as']);
  const SKIP_DET = new Set(['the', 'a', 'an', 'old', 'young', 'little', 'poor', 'dear', 'all', 'both', 'each', 'his', 'her', 'their', 'its', 'my', 'our', 'your']);
  // a common noun, as far as a word alone can say: not a function word, a
  // verb's past or a saying verb, an adverb or a reflexive
  const nounish = (w) => !!w && /^\p{Ll}[\p{Ll}-]+$/u.test(w) && !STOPW.has(w) && !PREP.has(w) && !DYNAMIC.test(w) && !/^(?:since|until|unless|because|though|although|whether|whose|whom|where|when|while|which|who|that|if|and|but|or|nor|yet|so|itself|herself|himself|themselves)$/.test(w) && !/(?:ly|self|selves)$/.test(w) &&
    !/^(?:was|were|is|are|am|had|has|have|did|does|do|would|could|should|will|can|may|might|must|said|says|stands|lies|runs|went|came|got|kept|looked|seemed|became|began|never|always|often|still|already|too)$/.test(w);
  const POSS_PRON = new Set(['his', 'her', 'its', 'their', 'my']);
  const RELNOUN = new Set(['apprentice', 'friend', 'servant', 'maid', 'master', 'mistress', 'wife', 'husband', 'sister', 'brother', 'mother', 'father', 'son', 'daughter', 'cousin', 'uncle', 'aunt', 'niece', 'nephew',
    'grandmother', 'grandfather', 'granddaughter', 'grandson', 'partner', 'boss', 'assistant', 'deputy', 'secretary', 'pupil', 'student', 'teacher', 'tutor', 'lover', 'fiancé', 'fiancée', 'widow', 'ward', 'guardian',
    'heir', 'enemy', 'rival', 'neighbour', 'landlord', 'landlady', 'lodger', 'tenant', 'employer', 'employee', 'captain', 'mate', 'companion', 'twin', 'sweetheart']);
  const SUBJ_PRON = new Set(['he', 'she', 'it', 'they', 'i']);
  function claimOwner(l, words, c, ctx, key = null) {
    const s = l.s;
    const p = ctx.ch.paras[s.pi];
    const hits = ((ctx.hits || [])[s.pi] || []).filter((h) => h.start >= s.start && h.end <= s.end && !p.talk.some(([a, b]) => h.start < b && h.end > a));
    const toks = [...s.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => ({ w: m[0], lw: norm(m[0]).replace(/['’]s$/, ''), poss: /['’]s$/.test(m[0]), start: s.start + m.index, end: s.start + m.index + m[0].length }));
    if (!toks.length) return null;
    const inHit = (t) => hits.find((h) => h.start < t.end && h.end > t.start);
    // the claim: the first of its words in the sentence, outside any name
    const want = new Set(words);
    // (a hyphened word by its parts too: "seventy-three", "grey-haired")
    if (ctx.ch.notes) {
      const first = ((ctx.hits || [])[s.pi] || [])[0];
      if (first && first.start === 0 && /^\s*[:,—–]/.test(p.text.slice(first.end))) return first.key;
    }
    const isClaim = (t) => !inHit(t) && !STOPW.has(t.lw) && [t.lw, ...(t.lw.includes('-') ? t.lw.split('-') : [])].some((w) => want.has(stem(w)) || inBag(stem(w), want));
    // (round 3: in the clause that holds most of the claim's words — "They lined up by height,
    // which put Hesper near the back, behind Coll"; "…, and Tobiah sat by the window splicing rope")
    let ci = toks.findIndex(isClaim);
    {
      const segOf = [];
      let seg = 0;
      toks.forEach((t, i) => { if (i && /[,;:—–]/.test(s.text.slice(toks[i - 1].end - s.start, t.start - s.start))) seg++; segOf.push(seg); });
      const count = new Map();
      toks.forEach((t, i) => { if (isClaim(t)) count.set(segOf[i], (count.get(segOf[i]) || 0) + 1); });
      const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best && best[1] > (count.get(segOf[ci]) || 0)) ci = toks.findIndex((t, i) => segOf[i] === best[0] && isClaim(t));
    }
    if (ci < 0) return null;
    // the one each word stands for
    const cand = [];
    let lastHit = null;
    toks.forEach((t, i) => {
      const h = inHit(t);
      if (h) {
        if (h === lastHit) { cand[cand.length - 1].end = i; cand[cand.length - 1].poss = t.poss || /^['’]s/.test(p.text.slice(h.end, h.end + 2)); return; }
        lastHit = h;
        // (the narrator's "my" owns, "me" is an object, like any pronoun)
        if (h.via === 'self' && ['me', 'myself'].includes(t.lw)) return;
        cand.push({ key: h.key, i, end: i, poss: t.poss || /^['’]s/.test(p.text.slice(h.end, h.end + 2)) || (h.via === 'self' && ['my', 'mine'].includes(t.lw)), self: h.via === 'self' });
        return;
      }
      // (round 3) a place's, thing's or group's name before a noun of its
      // own is that noun's modifier, not a subject: "the Dunmere breakwater",
      // "the Salt Cod inn" (whose inn is the Salt Cod's)
      const prev = cand[cand.length - 1];
      if (lastHit && prev && prev.key !== undefined && !prev.pron && i === prev.end + 1 && !prev.poss && nounish(t.lw) && /^ $/.test(s.text.slice(toks[prev.end].end - s.start, t.start - s.start))
        && (ctx.cast || []).some((o) => o.key === prev.key && !['person', 'creature'].includes(o.kind))) prev.attributive = i;
      lastHit = null;
      if (POSS_PRON.has(t.lw) || SUBJ_PRON.has(t.lw) || ['him', 'them', 'me'].includes(t.lw)) {
        // whom the pronoun means, when the chapter's reading is sure of it
        // (resolveRefs); else, a sentence the pack tied to c by its opening pronoun: c's
        const ref = !ctx.noRefs && p.refs && p.refs.get(t.start);
        const key = ref ? (ref.strong ? ref.key : undefined) : !ctx.noRefs && i === 0 && ['chain', 'para'].includes(l.why) ? c.key : undefined;
        cand.push({ key, i, end: i, poss: POSS_PRON.has(t.lw) && !(t.lw === 'her' && toks[i + 1] && PREP.has(toks[i + 1].lw)), pron: true, maybe: ref ? [ref.key, ...ref.alt] : null, pw: t.lw });
      }
    });
    // (round 3) a pronoun that cannot be c: one the chapter's reading gives
    // to others only, "it" or "they" for a person, "he" for a woman
    const living = ['person', 'creature'].includes(c.kind);
    const cSex = ctx.sexOf ? ctx.sexOf(c.key) : null;
    const cannot = (x) => !!x.pron && x.key === undefined && ((x.maybe && !x.maybe.includes(c.key)) || (living && /^(?:it|its|they|them|their)$/.test(x.pw)) || (!!cSex && !!PRONOUNS[x.pw] && PRONOUNS[x.pw] !== cSex));
    const ownerOf = (x) => (x.key !== undefined ? x.key : cannot(x) ? -1 : null);
    // (a place's: what is at it — "since the accident at Dock Three")
    if (c.kind === 'place') { const px = cand.find((x) => x.key === c.key && !x.pron && x.i > ci && x.i - ci <= 3 && /^(?:at|in|on|inside)$/.test(toks[x.i - 1].lw) || (x.key === c.key && !x.pron && x.i > ci && x.i - ci <= 4 && toks[x.i - 1].lw === 'the' && /^(?:at|in|on|inside)$/.test((toks[x.i - 2] || {}).lw))); if (px && !cand.some((y) => y.i > ci && y.i < px.i)) return c.key; }
    // ("The rule of the Weighhouse was…": the claim's noun is the possessor's)
    if (toks[ci + 1] && toks[ci + 1].lw === 'of' && ci <= 2 && toks.slice(0, ci).every((t) => SKIP_DET.has(t.lw) || /^(?:this|that|one|only)$/.test(t.lw))) {
      const ofx = cand.find((x) => !x.pron && x.key !== undefined && (x.i === ci + 2 || (x.i === ci + 3 && toks[ci + 2].lw === 'the')));
      if (ofx) return ofx.key;
    }
    // (a modifier owns its own noun only: "the Salt Cod inn"; else it is no candidate)
    // ("the valley children" are no valley: a common noun of its kind only — inn, street, house, river…)
    for (const x of cand) if (x.attributive !== undefined && CATEGORY.has(toks[x.attributive].lw.replace(/s$/, '')) && (x.attributive === ci || isClaim(toks[x.attributive]))) return x.key;
    for (let k = cand.length - 1; k >= 0; k--) if (cand[k].attributive !== undefined) cand.splice(k, 1);
    // (the object of a preposition is no owner: "above the Sare", "below her")
    const gapPunct = (a, b) => /[,;:—–()]/.test(s.text.slice(toks[a].end - s.start, toks[b].start - s.start));
    // "a black-and-white collie bitch called Moss"
    for (const x of cand) if (x.i > ci && x.i - ci <= 4 && !gapPunct(ci, x.i) && x.key !== undefined && /^(?:called|named)$/.test((toks[x.i - 1] || {}).lw || '')) return x.key;
    // (a possessive in c's own apposition or predicate is c: "Clem, his grey
    // mare", "Clem: Ivo’s grey mare", "He was my mother’s younger brother")
    for (const x of cand) {
      if (!x.poss || x.end >= ci) continue;
      const sub = cand.filter((y) => y.end < x.i).pop();
      if (sub && sub.key === c.key && /^(?:['’]s)?\s*(?:[,:—–]|\s(?:was|is)(?:\s+(?:a|an|the))?)\s*$/u.test(s.text.slice(toks[sub.end].end - s.start, toks[x.i].start - s.start))) { x.poss = false; x.key = c.key; }
    }
    const before = cand.filter((x) => x.end < ci);
    // (a subject is followed by its verb: "I was sent", "he took")
    const x_isVerbAfter = (x) => { const nx = toks[x.end + 1]; return !!nx && (DYNAMIC.test(nx.lw) || /^(?:was|were|is|are|had|has|have|did|would|could|will|kept|took|went|came)$/.test(nx.lw) || /(?:ed|s)$/.test(nx.lw)); };
    // an apposition: "at the Corn Exchange, a sandstone hall"; "its Long
    // Gallery, upstairs, a cold panelled room"
    const near = before[before.length - 1];
    // (after the object of a preposition it may be either's: "the Haddons’
    // house on Bridge Street, a narrow red-brick building" — the reader's
    // choice decides)
    const object = (x) => {
      let k = x.i - 1;
      while (k >= 0 && SKIP_DET.has(toks[k].lw)) k--;
      if (k < 0) return false;
      if (toks[k].lw === 'of') { let j = k - 1; while (j >= 0 && !SKIP_DET.has(toks[j].lw) && j > k - 3) j--; return !(k <= 4 && toks.slice(0, k).every((t, n) => n >= j || SKIP_DET.has(t.lw))); }
      return PREP.has(toks[k].lw) || /^(?:called|named)$/.test(toks[k].lw);
    };
    // (round 3) the name the claim's noun phrase leads up to is its owner:
    // "his old Rover" (old is the Rover's), "His younger sister Tamsin", "His
    // wife, Constance, was…"
    {
      const head = !DYNAMIC.test(toks[ci].lw) && !/(?:ed|ing)$/.test(toks[ci].lw) && cand.find((x) => x.i > ci && x.i - ci <= 2 && !x.pron && x.key !== undefined);
      if (head && /^(?:\s+[\p{L}'’-]+)*\s*,?\s*$/u.test(s.text.slice(toks[ci].end - s.start, toks[head.i].start - s.start)) && !cand.some((y) => y.i > ci && y.i < head.i)
        && (head.key === c.key || !/,/.test(s.text.slice(toks[ci].end - s.start, toks[head.i].start - s.start))) && !(toks[head.i - 1] && /^(?:of|to|for|with|by|at|in|on|from|than|like|as|and|or)$/.test(toks[head.i - 1].lw))) return head.key;
    }
    // (c in apposition, and the claim after it with no one else between:
    // "its Long Gallery, upstairs, a cold panelled room hung with portraits…,
    // where the light came in through tall windows")
    {
      const anchor = before.filter((x) => x.key === c.key && !x.pron && /^(?:['’]s)?,\s+(?:[\p{L}-]+,\s+)?(?:a|an)\s/u.test(s.text.slice(toks[x.end].end - s.start, toks[x.end].end - s.start + 40))).pop();
      if (anchor && !cand.some((y) => y.i > anchor.end && y.i < ci && y.key !== undefined && y.key !== c.key)) return c.key;
    }
    // a sentence about something the cast doesn't hold, which names this one
    // only as where it is ("The surgery was the front half of the Haddons’
    // house on Bridge Street…"; "The back bedroom, which was mine, looked
    // out…" in the Salt House's paragraph): someone else's (-1)
    // (a part of it is its own: "The lamp-room was the warmest place in the tower", "Its waiting room had six hard chairs")
    if (!before.some((x) => !x.poss && !object(x) && x.key !== undefined) && ['place', 'thing'].includes(c.kind) && key !== 'location.part') {
      const lead = /^[\s“"‘']*(?:[Tt]he|[Ii]ts|[Hh]is|[Hh]er|[Mm]y|[Tt]heir|[Oo]ur|\p{Lu}\p{L}*['’]s)\s+(?:\p{Ll}+['’]s\s+)?(?:[\p{Ll}-]+\s+){0,2}?([\p{Ll}-]+)(?:,[^,]{1,40},|\s+(?:at|in|of|on)\s+[^,.;]{1,40}?)?\s+(?:itself\s+)?(?:was|were|is|are|had|has|stood|looked|ran|lay)\b/u.exec(s.text);
      const mine = cand.filter((x) => x.key === c.key && !x.pron);
      const objectOf = (x) => { let k = x.i - 1; while (k >= 0 && SKIP_DET.has(toks[k].lw)) k--; return k >= 0 && PREP.has(toks[k].lw) || (k >= 0 && toks[k].lw === 'of'); };
      const head = norm(c.name).split(/\s+/).pop();
      if (lead && !(inHit(toks[0]) && inHit(toks[0]).via !== 'self') && mine.every((x) => objectOf(x)) && stem(norm(lead[1])) !== stem(head) && !want.has(stem(norm(lead[1]))) && !c.aliases.some((a) => norm(a).split(/\s+/).pop() === norm(lead[1]))
        && (mine.length || /^(?:room|hall|chamber|kitchen|cell|corridor|yard|office|attic|cellar|ward|dormitory|bedroom|surgery|parlour|study|garden|house|building|cottage|barn|shop|church|chapel|stable|loft|cabin|galley|hangar)$/.test(lead[1]))) return -1;
    }
    if (near && near.key !== undefined && !near.pron && /^(?:['’]s)?,\s+(?:[\p{L}-]+,\s+)?(?:a|an|the)\s+(?:[\p{L}\p{N}'’-]+\s+){0,10}$/u.test(s.text.slice(toks[near.end].end - s.start, toks[ci].start - s.start))) {
      if (!object(near)) return near.key;
      // ("…at the bottom of the Spine, the long vertical shaft": a definite description is the name's just before it)
      const def = /^(?:['’]s)?,\s+(?:[\p{L}-]+,\s+)?the\s+((?:[\p{Ll}-]+\s+){0,3}?)([\p{Ll}-]+)(?=\s+(?:of|before|after|that|which|where|with|on|in|at|by)\b|\s*[,.;]|$)/u.exec(s.text.slice(toks[near.end].end - s.start));
      // (unless its noun is this one's own: "my grandmother’s house stood at the end of Wrack Lane, the last house before the marsh")
      if (def && [c.name, ...c.aliases].some((n) => norm(n).split(/\s+/).pop() === def[2])) return c.key;
      if (def) return near.key;
      // (after a preposition's object: the subject's, when a place or thing is the subject — "The surgery was the
      // front half of the house on Bridge Street, a narrow red-brick building"; the object's, when a person is —
      // "the doctor held a clinic at the Corn Exchange, a sandstone hall")
      const sub = before.filter((x) => x.i < near.i && !x.poss && !object(x) && x.key !== undefined).pop();
      const subLiving = sub && (ctx.cast || []).some((o) => o.key === sub.key && ['person', 'creature'].includes(o.kind));
      if (sub && !subLiving) return sub.key;
      if (near.key === c.key || sub || living) return near.key;
      return null;
    }
    // a possessive just before the claim, in its own phrase
    // (round 3) the claim's own clause names its subject after it ("…, and
    // every summer of my childhood I was sent there"): that one
    {
      const gapAt = (i) => s.text.slice(toks[i - 1].end - s.start, toks[i].start - s.start);
      const bound = (i) => /[;:]/.test(gapAt(i)) || (/,/.test(gapAt(i)) && /^(?:and|but|so|yet|then|while|though|although)$/.test(toks[i].lw));
      let a = ci;
      while (a > 0 && !bound(a)) a--;
      let b = ci + 1;
      while (b < toks.length && !bound(b)) b++;
      const inClause = cand.filter((x) => x.i >= a && x.i < b);
      const after = inClause.find((x) => x.i > ci && !x.poss && !object(x) && (x.self || x.pron ? ['i', 'he', 'she', 'it', 'they'].includes(toks[x.i].lw) : true));
      if (after && a > 0 && !inClause.some((x) => x.i < ci && !x.poss && !object(x)) && x_isVerbAfter(after)) return ownerOf(after);
      // (round 3) a person's claim in a clause where nothing can be them —
      // "The bell went six times, the way it always did, and Hesper…"; "They lined up by height"
      if (living) {
        const strict = (i) => /[;:]/.test(s.text.slice(toks[i - 1].end - s.start, toks[i].start - s.start)) || (/,/.test(s.text.slice(toks[i - 1].end - s.start, toks[i].start - s.start)) && /^(?:and|but|so|yet|then|while|where|when|which)$/.test(toks[i].lw));
        let a2 = ci;
        while (a2 > 0 && !strict(a2)) a2--;
        let b2 = ci + 1;
        while (b2 < toks.length && !strict(b2)) b2++;
        const inc = cand.filter((x) => x.i >= a2 && x.i < b2);
        if (inc.every((x) => cannot(x)) && (inc.length || /^[\s“"‘']*(?:The|A|An|This|That)\s/.test(s.text.slice(toks[a2].start - s.start)))) return -1;
      }
    }
    // a possessive just before the claim, in its own phrase (and not one that owns a name between: "My uncle Tobiah lived with her")
    // (nor one whose noun owns the claim in turn: "their mother’s dark hair")
    {
      const pp = before.filter((x) => x.poss && ci - x.end <= 3 && !gapPunct(x.end, ci)).pop();
      const sub = pp && before.filter((x) => x.i < pp.i && !x.poss && !object(x) && x.key !== undefined).pop();
      if (sub && sub.key !== pp.key && /^(?:['’]s)?\s+(?:was|is|were|are|became|remained)(?:\s+(?:the|a|an|only|still))*\s*$/u.test(s.text.slice(toks[sub.end].end - s.start, toks[pp.i].start - s.start))) return sub.key;
    }
    if (living) { const px = before.filter((x) => x.poss && !x.pron && x.key !== undefined && /^\s*:\s*$/.test(s.text.slice(toks[x.end].end - s.start + (/^['’]s/.test(s.text.slice(toks[x.end].end - s.start)) ? 2 : 0), toks[ci].start - s.start).replace(/^['’]s/, ''))).pop(); if (px && toks.slice(px.end + 1, ci).length <= 1) return px.key; }
    // (and "her apprentice" is the apprentice's, not hers: a relation's other end)
    const poss = !RELNOUN.has(toks[ci].lw) && before.filter((x) => x.poss && ci - x.end <= 3 && !gapPunct(x.end, ci) && !cand.some((y) => y.i > x.end && y.i < ci) && !toks.slice(x.end + 1, ci).some((t) => t.poss)).pop();
    if (poss) return ownerOf(poss);
    // (an "it" after a verb is its object: "he did it so gently")
    const itObject = (x) => x.pron && x.pw === 'it' && x.i > 0 && !gapPunct(x.i - 1, x.i) && !/^(?:and|but|so|then|when|while|because|that|which|if|though|although|as|since|until|where|before|after)$/.test(toks[x.i - 1].lw);
    const subj = before.filter((x) => !x.poss && !object(x) && !itObject(x) && !(x.pron && !['he', 'she', 'it', 'they', 'i'].includes(toks[x.i].lw))).pop();
    // (no subject: the last one named before it, in the same clause run —
    // "its Long Gallery, … a cold panelled room …, where the light came in
    // through tall windows")
    // (a place's or thing's claim in a sentence whose subject is a he or she: theirs, not the place's)
    if (subj && subj.pron && subj.key === undefined && ['he', 'she', 'i'].includes(toks[subj.i].lw) && !['person', 'creature'].includes(c.kind)) return -1;
    if (!subj) return near && near.key !== undefined && !object(near) && !/[;:]/.test(s.text.slice(toks[near.end].end - s.start, toks[ci].start - s.start)) ? near.key : null;
    return ownerOf(subj);
  }

  const DYNAMIC = /^(?:\p{L}+ed|rode|ran|sat|stood|went|came|lay|slept|held|took|gave|saw|got|left|made|brought|caught|drove|fell|felt|found|heard|hid|kept|knelt|led|lit|met|put|read|said|sang|shook|spoke|swam|threw|told|thought|woke|wore|wrote|ate|drank|began|bent|bit|blew|broke|bought|built|chose|crept|dug|drew|flew|forgot|froze|grew|hung|hurt|knew|lost|meant|paid|rang|rose|sent|set|shut|slid|spent|split|spun|stole|struck|swept|swung|taught|tore|understood|wept|won)$/u;
  // Is the claim in the predicate of one action ("was waiting", "slept",
  // "rode"), after its verb? → true for the families a moment can't give
  function actionPredicate(cited, words, c, key) {
    const fam = labelFamily(key);
    if (['role', 'habit', 'history', 'origin', 'age', 'sex', 'rule', 'membership', 'name'].includes(fam) || key === 'relationship.kin' || fam === 'species') return false;
    if (c.kind === 'place' && !['location', 'state', 'relationship', 'possession', 'function'].includes(fam)) return false;
    // (what is said stays what is said: never a moment)
    if (cited.some((l) => l.s.said || (l.s.talk && l.s.talk.length))) return false;
    if (key === 'location.home' || key === 'location.part') return false;
    const STATIVE = /^(?:stood|lay|sat|ran|rose|wound|stretched|climbed|faced|overlooked|looked|hung|sloped|leaned|towered|squatted|smelled|smelt|sounded|seemed|tasted|stank|reeked|echoed)$/;
    return cited.every((l) => {
      // (the clause that holds the claim: "There was a new ribbon …, and Hesper tried not to look …")
      const all = [...l.s.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => ({ w: norm(m[0]), at: m.index }));
      const at0 = all.findIndex((t, i) => i > 0 && words.some((w) => stem(t.w) === w));
      let from = 0;
      for (const m of l.s.text.matchAll(/(?:,\s+(?:and|but|so)\s+|;\s+|:\s+)/g)) if (at0 >= 0 && m.index < all[at0].at) from = m.index + m[0].length;
      let toks = all.filter((t) => t.at >= from);
      // (round 3: a place's or thing's clause that stands, runs or smells is how it is — "and the stairs wound up through the middle")
      if (c.kind !== 'person' && c.kind !== 'creature' && toks.some((t) => STATIVE.test(t.w))) return false;
      // (a clause with no verb of its own, "and Moss at his heels", is the sentence's)
      if (!toks.some((t) => DYNAMIC.test(t.w) || ['was', 'were', 'is', 'are', 'had', 'has', 'have'].includes(t.w))) toks = all;
      // the main verb: the first dynamic past, or "was|were" + -ing, outside a leading apposition
      let vi = -1;
      for (let i = 0; i < toks.length; i++) {
        const before = l.s.text.slice(toks === all ? 0 : from, toks[i].at);
        if ((before.match(/,/g) || []).length % 2 === 1) continue; // (inside ", his grey mare,")
        if (['was', 'were'].includes(toks[i].w) && toks[i + 1] && /ing$/.test(toks[i + 1].w)) { vi = i + 1; break; }
        // ("had felt", "had known": an action done before; "had a dog", "had been": not)
        if (toks[i].w === 'had' && toks[i + 1] && (DYNAMIC.test(toks[i + 1].w) || ['known', 'seen', 'taken', 'given', 'gone', 'done', 'felt', 'heard', 'told'].includes(toks[i + 1].w)) && toks[i + 1].w !== 'been') { vi = i + 1; break; }
        if (['was', 'were', 'is', 'are', 'had', 'has', 'have'].includes(toks[i].w)) break;
        if (DYNAMIC.test(toks[i].w) && i > 0 && !['to', 'the', 'a', 'an', 'his', 'her', 'their', 'its', 'had', 'has', 'have', 'would', 'used'].includes(toks[i - 1].w)) { vi = i; break; }
      }
      if (vi < 0) return false;
      // (round 3) what is done every morning is no one moment ("every morning at eight he drove his old Rover"),
      // nor what has gone on since ("she walked with a stick since the accident at Dock Three")
      if (HABITUAL.test(l.s.text.slice(toks === all ? 0 : from)) || ONGOING.test(l.s.text.slice(toks === all ? 0 : from))) return false;
      // (round 3) how a place or thing stands or runs is how it is ("The
      // Lantern House stood at the end of the breakwater", "the stairs wound
      // up through the middle"); what one keeps, wears or carries is theirs
      // ("Mara kept a brass key on a cord around her neck")
      if (c.kind !== 'person' && c.kind !== 'creature' && STATIVE.test(toks[vi].w)) return false;
      if (fam === 'possession' && /^(?:kept|had|owned|carried|wore|held)$/.test(toks[vi].w)) return false;
      { const k = toks.findIndex((t, i) => i > 0 && words.some((w) => stem(t.w) === w)); if (fam === 'possession' && k > 0 && ['his', 'her', 'their', 'my'].includes(toks[k - 1].w)) return false; }
      // (a mark is what a deed left: "He had lost two fingers of his left hand to a winch")
      if (key === 'appearance.mark') return false;
      const ci = toks.findIndex((t, i) => i > 0 && words.some((w) => stem(t.w) === w));
      return ci >= vi;
    });
  }

  // Cited, tied, grounded: the gates a proposal passes before the reader
  // is asked about it. → { why } or { quote, said, key, label, value, ... }
  function gateFact(x, part, c, ctx) {
    let g = GROUPS.includes(x && x.g) ? x.g : null;
    if (g && ['sex', 'age'].includes(g) && !['person', 'creature'].includes(c.kind)) g = 'description';
    // (who belongs is a group's; a place's or thing's "membership" is what it's like)
    // (but the setting's own members are who belongs there: "The “Spared” were the ones born inside")
    if (g === 'membership' && ['place', 'thing'].includes(c.kind) && !(c.setting && part.lines.some((l, i) => (Array.isArray(x.s) ? x.s : [x.s]).map(Number).includes(i + 1) && l.why === 'setting'))) g = 'description';
    const value = String((x && x.v) || '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
    const label = String((x && x.a) || '').replace(/\s+/g, ' ').trim();
    if (!g || !value || value.length > 110 || value.split(' ').length > 16 || label.split(' ').length > 4) return { why: 'shape' };
    // 1 cited: every id one of the part's sentences
    const ids = [...new Set((Array.isArray(x.s) ? x.s : [x.s]).map((n) => +n).filter((n) => Number.isInteger(n)))];
    if (!ids.length || ids.length > 3 || ids.some((n) => n < 1 || n > part.lines.length)) return { why: 'cited' };
    const cited = ids.map((n) => part.lines[n - 1]);
    // 2 tied: each cited sentence names it, follows on with its pronoun, is
    // its place's paragraph, or the chapter is set in it
    if (cited.some((l) => !l.why) || cited.every((l) => l.why === 'context')) return { why: 'tied' };
    // the words it's about, and the value's words in the text
    const own = new Set([c.name, ...c.aliases].flatMap((n) => content(n)));
    const valueWords = content(value).filter((w) => g === 'sex' || !own.has(w));
    const text = cited.map((l) => l.s.text).join(' ');
    const bag = new Set(content(text));
    // 3 grounded: half the value's words (all its names and numbers) in the sentences
    const meantWords = new Set(cited.flatMap((l) => [...((ctx.ch.paras[l.s.pi].refs) || new Map()).entries()].filter(([at, r]) => at >= l.s.start && at < l.s.end && r.strong).map(([, r]) => r.key))
      .flatMap((k) => { const o = (ctx.cast || []).find((y) => y.key === k); return o ? [o.name, ...o.aliases].flatMap((n) => content(n)) : []; }));
    const grounded = valueWords.filter((w) => inBag(w, bag) || meantWords.has(w));
    // (a sex the cited sentence gives by a he or she the chapter's reading is sure is c: the trait rules decide)
    if (g === 'sex' && !grounded.length && ['male', 'female', 'man', 'woman', 'boy', 'girl'].includes(norm(value))) {
      const want = ['male', 'man', 'boy'].includes(norm(value)) ? 'male' : 'female';
      const by = cited.some((l) => [...((ctx.ch.paras[l.s.pi].refs) || new Map()).entries()].some(([at, r]) => at >= l.s.start && at < l.s.end && r.strong && r.key === c.key && PRONOUNS[norm(ctx.ch.paras[l.s.pi].text.slice(at).match(/^[\p{L}]+/u)[0])] === want));
      if (by) grounded.push(...valueWords);
    }
    const caps = (value.match(/(?<![\p{L}])\p{Lu}[\p{L}'’-]+/gu) || []).filter((w, i) => i > 0 || !STOPW.has(w.toLowerCase()));
    // (a name the cited sentences give by a pronoun the chapter's reading is sure of: "he had been her apprentice" → Tobias)
    const meant = new Set(cited.flatMap((l) => [...((ctx.ch.paras[l.s.pi].refs) || new Map()).entries()].filter(([at, r]) => at >= l.s.start && at < l.s.end && r.strong).map(([, r]) => r.key))
      .flatMap((k) => { const o = (ctx.cast || []).find((y) => y.key === k); return o ? [o.name, ...o.aliases].flatMap((n) => content(n)) : []; }));
    if (caps.some((w) => !norm(text).includes(norm(w.replace(/['’]s$/, ''))) && !own.has(stem(norm(w))) && !meant.has(stem(norm(w).replace(/['’]s$/, ''))))) return { why: 'invented' };
    if (valueWords.filter((w) => NUMBER.test(w)).some((w) => !inBag(w, bag))) return { why: 'invented' };
    let key = keyOf(g, label);
    // about someone (or something) else: a place's, group's or thing's fact
    // whose label or value names another of the cast ("Weigher's nickname"
    // on the Weighhouse), or names itself ("not one of the Spared" is
    // someone's, not the Spared's)
    const others = (ctx.cast || []).filter((o) => o !== c && !o.gone);
    // (a name as written: "Nine" is no "nine decks"; a role or common noun in any case)
    const nameIn = (n, t) => { const b = n.replace(/^the\s+/i, ''); if (b.length < 3) return false; return /^\p{Lu}/u.test(b) ? new RegExp(`(?<![\\p{L}])${escRe(b)}(?![\\p{L}])`, 'u').test(t) : new RegExp(`(?<![\\p{L}])${escRe(norm(b))}(?![\\p{L}])`, 'u').test(norm(t)); };
    const namesOther = (t, living = false) => others.some((o) => (!living || ['person', 'creature'].includes(o.kind)) && [o.name, ...o.aliases].some((n) => nameIn(n, t)));
    // (round 3) a thing's use, effect or routine is told with it as the object:
    // "The warden poured it from a steel jug…", "he wrote every number in a ledger"
    const thingDone = c.kind === 'thing' && ['function', 'use', 'effect', 'habit', 'routine', 'custom'].some((f) => labelFamily(key) === f || key === f) &&
      cited.every((l) => ((ctx.hits || [])[l.s.pi] || []).some((h) => h.key === c.key && h.start >= l.s.start && h.end <= l.s.end) || [...((ctx.ch.paras[l.s.pi].refs) || new Map()).entries()].some(([at, r]) => at >= l.s.start && at < l.s.end && r.strong && r.key === c.key));
    if (c.kind !== 'person' && c.kind !== 'creature' && !thingDone && !['relationship', 'location'].includes(g) && !['residents', 'members'].includes(key)) {
      // (round 3: a person named in it; a place it runs or stands by is its own fact — "has run the lights of Dunmere")
      if (namesOther(label, true) || (labelFamily(key) !== 'history' && namesOther(value.replace(/(?<![\p{L}])\p{Lu}[\p{L}-]*['’]s(?![\p{L}])/gu, ' '), true))) return { why: 'someone else' };
      if ([c.name, ...c.aliases].some((n) => /^\p{Lu}/u.test(n.replace(/^the\s+/i, '')) && nameIn(n, value))) return { why: 'someone else' };
    }
    // a place's, group's or thing's sentence found by its paragraph (not its
    // name) that is about a person ("Hesper had been born…", "his neck")
    // is that person's; and how anyone looks is never another of the cast
    if (c.kind !== 'person' && c.kind !== 'creature' && !thingDone && !['relationship', 'location'].includes(g) && cited.some((l) => l.why !== 'name')) {
      const people = others.filter((o) => ['person', 'creature'].includes(o.kind));
      const personal = (t) => /(?<![\p{L}])(?:he|she|his|her|him|hers)(?![\p{L}])/iu.test(t) || people.some((o) => [o.name, ...o.aliases].some((n) => nameIn(n, t)));
      // (in the clause that holds the claim: "The bell went six times, the way it always did, and Hesper was on her feet")
      if (cited.some((l) => l.why !== 'name' && personal(clauseOf(l.s, grounded)))) return { why: 'someone else' };
    }
    if (labelFamily(keyOf(g, label)) === 'appearance' && namesOther(value, true)) return { why: 'someone else' };
    // (round 3) a name that is another's ("Arthur, to Constance" is the doctor's
    // name); a person's own name owning the value ("Mara's apprentice") is someone else's fact
    if (keyOf(g, label) === 'name') {
      const first = (value.match(/(?<![\p{L}])\p{Lu}[\p{L}'’-]+/u) || [])[0];
      const isOf = (o) => [o.name, ...o.aliases].some((n) => content(n).includes(stem(norm(first || '').replace(/['’]s$/, ''))));
      if (first && !isOf(c) && others.some(isOf)) return { why: 'someone else' };
    }
    if (['person', 'creature'].includes(c.kind) && g !== 'relationship' && !['relationship', 'possession'].includes(labelFamily(keyOf(g, label))) && [c.name, ...c.aliases].some((n) => new RegExp(`(?<![\\p{L}])${escRe(n.replace(/^the\s+/i, ''))}['’]s(?![\\p{L}])`, 'iu').test(value))) return { why: 'someone else' };
    // whose the claim is, by the sentence's grammar: a fact about someone
    // or something else in the same sentence is theirs (the town's slate
    // filed on its river; one person's eye patch on the group they lead)
    // a place's paragraph that is about something else of it, not held in the
    // cast ("The surgery was the front half of the Haddons’ house on Bridge
    // Street… Its waiting room had six hard chairs"): not that place's
    if (ctx.hits && ['place', 'thing'].includes(c.kind) && cited.some((l) => l.why === 'para')) {
      for (const l of cited.filter((x) => x.why === 'para')) {
        const p0 = ctx.ch.paras[l.s.pi];
        const s0 = p0.sents.find((x) => (ctx.hits[l.s.pi] || []).some((h) => h.key === c.key && h.start >= x.start && h.end <= x.end));
        if (s0 && claimOwner({ s: s0, why: 'name' }, content((/^\W*\S+\s+(\S+)/u.exec(s0.text) || [])[1] || ''), c, ctx) === -1) return { why: 'someone else' };
      }
    }
    let owned = false;
    let ownedByName = false;
    if (thingDone) owned = true;
    if (ctx.hits && !thingDone && !['relationship', 'membership', 'possession'].includes(g) && !['residents', 'members', 'possession'].includes(key)) {
      const owners = cited.map((l) => claimOwner(l, grounded, c, ctx, key));
      // (a sentence that is no one's of the cast, "They got a number inked…", beside one that is c's, "Hesper's was 41": c's)
      // (a part of a place is a place itself: "a pub called the Anchor", "the bottling plant on Quay Road")
      const partOwner = (k) => key === 'location.part' && (ctx.cast || []).some((o) => o.key === k && !['person', 'creature'].includes(o.kind));
      // (and beside a sentence that is c's, one about a group c belongs to is its context: "They got a number inked…. Hesper's was 41.")
      const groupBeside = (k) => owners.includes(c.key) && (ctx.cast || []).some((o) => o.key === k && o.kind === 'group');
      if (owners.some((k) => k != null && k >= 0 && k !== c.key && !partOwner(k) && !groupBeside(k)) || (owners.includes(-1) && !owners.includes(c.key) && key !== 'location.part')) return { why: 'someone else' };
      owned = owners.some((k) => k === c.key);
      // (and owned by its name, not a pronoun: "Ada was Fourteen, …, a big freckled girl"; "a collie bitch called Moss")
      if (owned) ownedByName = cited.some((l) => claimOwner(l, grounded, c, { ...ctx, noRefs: true }, key) === c.key);
    }
    // the setting's own: how it works (its routines and rules, who belongs),
    // from a clause that names no one and nothing else of the cast
    const bySetting = cited.some((l) => l.why === 'setting');
    if (bySetting && !['habit', 'rule', 'membership'].includes(g) && !['residents', 'members'].includes(key)) return { why: 'setting' };
    const interpretive = INTERPRETIVE.has(key) || INTERPRETIVE.has(labelFamily(key)) || g === 'personality';
    const ratio = valueWords.length ? grounded.length / valueWords.length : 0;
    if (!valueWords.length) return { why: 'empty' };
    if (ratio < 0.5 && !(interpretive && ratio > 0)) return { why: 'ungrounded' };
    // polarity: "not one of the Spared" isn't "one of the Spared"
    const clauses = cited.map((l) => clauseOf(l.s, grounded));
    if (localNeg(clauses.join(' '), grounded) !== negated(value) && !(negated(value) && /less|out\b|\bun/i.test(value))) return { why: 'polarity' };
    // kin with no one it is kin to ("younger sister"): whose? (kin by rule names both)
    if (key === 'relationship.kin' && !/\p{Lu}/u.test(value.replace(/^\p{Lu}/u, '')) && !/['’]s\b/.test(value) && !others.some((o) => [o.name, ...o.aliases].some((n) => norm(value).includes(norm(n.replace(/^the\s+/i, ''))))) && !/\p{Lu}/u.test(value[0] || '')) return { why: 'shape' };
    // an age is how old, not who is older ("younger sister": kin)
    if (key === 'age' && /^(?:younger|older|elder|eldest|youngest|oldest)$/i.test(value)) return { why: 'shape' };
    // no value at all: "not specified", "unknown", "none"
    if (/^(?:not (?:specified|stated|given|described|mentioned|known)|unknown|unspecified|none|n\/a|nothing|unclear)$/i.test(value)) return { why: 'empty' };
    // where someone (or something) is now is the scene, not the bible ("already in the line",
    // "under the weigher's arm"); only a place has a location of its own, a person a home
    if (c.kind !== 'place' && c.kind !== 'group' && (labelFamily(key) === 'location' || /(?:^|\s)(?:where|whereabouts|place|spot|location)$/i.test(label) || (c.kind !== 'person' && /(?:^|\s)position$/i.test(label))) && key !== 'location.home' && !/\b(?:lives?|lived|living|sleeps?|slept|home|works?|worked|born)\b/i.test(value + ' ' + label)) return { why: 'once' };
    // one deed is the story's ("tried not to look", "passed the infirmary"), not a lasting fact
    if (['other', 'state', 'location', 'appearance', 'personality'].includes(labelFamily(key)) && /^(?:tries|tried|rubbed|tucked|wiped|shook|lifted|raised|dropped|pulled|pushed|threw|passed|went|came|walked|ran|sat|stood|looked|turned|took|gave|got|said|told|asked|saw|heard|felt|made|drank|ate|pressed|glanced|stepped|smiled|nodded|laughed|cried|whispered|opened|closed|left|arrived|picked|put|held|reached|watched|waited|wrote|read)\b/i.test(value) && !HABITUAL.test(value)) return { why: 'once' };
    // a sentence pinned to one moment ("By noon the Sare was over the meadows", "That night…")
    // tells the scene, not how the thing is
    const MOMENT = /(?<![\p{L}])(?:by noon|by nightfall|by evening|by morning|that (?:morning|evening|night|afternoon|day|week|year)|this (?:morning|evening)|tonight|today|yesterday|at (?:supper|dinner|breakfast|dawn|dusk|noon|midnight)|at \S+ o['’]clock|for a moment|for once|just then|suddenly|by then)(?![\p{L}])/iu;
    const citedText = cited.map((l) => l.s.text).join(' ');
    if (['other', 'state', 'location', 'description', 'appearance', 'atmosphere', 'habit', 'possession', 'relationship', 'personality', 'function'].includes(labelFamily(key)) && key !== 'relationship.kin' && MOMENT.test(citedText) && !HABITUAL.test(citedText.replace(MOMENT, ''))) return { why: 'once' };
    // the predicate of one action ("Ada was waiting at the top of the Spine
    // with two mugs", "They slept in the Long Gallery", "he rode her down the
    // rows") is the scene; an apposition before the verb ("Clem, his grey
    // mare, was waiting") still describes. Roles, routines, history, kin: not this.
    if (!thingDone && actionPredicate(cited, grounded, c, key)) return { why: 'once' };
    // (round 4) a feeling, a posture or a state of one scene is the story's,
    // not the bible's ("very cold and frightened", "asleep on his chest",
    // "stood at the orchard gate"): a living one's fact made of such words
    // needs standing evidence — words that it recurs or lasts (always,
    // every, whenever, in winter), a description of the kind they are ("a
    // nervous man"), or the same word in another sentence about them
    if (momentary(value, cited, part, c, key)) return { why: 'moment' };
    // (a word of the value that the text has only in how long something went on — "quiet for a long while" — is no trait of anyone)
    {
      const spans = cited.flatMap((l) => [...l.s.text.matchAll(DURATION)].map((m) => content(m[0])));
      const vw = content(value).filter((w) => !own.has(w));
      if (spans.length && vw.length && vw.every((w) => spans.some((sp) => sp.includes(w)) || STOPW.has(w))) return { why: 'once' };
    }
    // a day or a month for a value ("Role: Thursdays"), or a look that is only where it was seen ("in the instrument light")
    if (content(value).length && content(value).every((w) => nonEntity(w) && !TITLES.has(w))) return { why: 'empty' };
    // its own name for a value ("called the Anchor")
    if (valueWords.every((w) => ['call', 'called', 'name', 'named', 'known', 'nicknam'].includes(w))) return { why: 'empty' };
    if (labelFamily(key) === 'appearance' && /^(?:in|on|at|by|under|from|through)\s/i.test(value)) return { why: 'once' };
    // "sweeping the floor", "carrying fence posts": what they were doing then
    if (['other', 'state', 'location', 'appearance', 'personality', 'description'].includes(labelFamily(key)) && /^(?!being\b|living\b|wearing\b|getting\b|growing\b|becoming\b)\p{L}+ing\s+(?:the|a|an|his|her|their|its|some|\p{L}+[^s\s]s)\b/u.test(value) && !HABITUAL.test(citedText)) return { why: 'once' };
    // a place's location that names the place itself ("smell of the press-house") says nothing of where it is
    if (c.kind !== 'person' && c.kind !== 'creature' && labelFamily(key) === 'location' && [c.name, ...c.aliases].some((n) => { const b = norm(n.replace(/^the\s+/i, '')); return b.length >= 3 && norm(value).includes(b); })) return { why: 'empty' };
    // a past role is history, not who they are now
    if (labelFamily(key) === 'role' && PAST_ROLE.test(clauses.join(' ')) && !ONGOING.test(clauses.join(' '))) { g = 'history'; key = 'history'; }
    // a habit or routine is what is done more than once: the words must say so
    // (always, every, never, kept, the same…); one moment is the story's, not the bible's
    // (the text's words, not the reader's value: "listens to pumps at night" from "That night Nine lay…")
    if ((g === 'habit' || labelFamily(key) === 'habit') && !HABITUAL.test(cited.map((l) => l.s.text).join(' '))) return { why: 'once' };
    // an appearance is how they look, not what they did ("slid the weight", "did not turn round")
    if (labelFamily(key) === 'appearance' && /^(?:did|was|were|went|tried|kept|got|had|has|made|took|gave|came|stood|sat|looked|turned|peered|slid|walked|ran|said|felt)\b/i.test(value)) return { why: 'once' };
    // a personality is a word or two, or a way they always are
    // (a way they are, told as a thing they have: "a laugh you could hear two decks away")
    if (g === 'personality' && !x.intro && value.split(/\s+/).length > 4 && !HABITUAL.test(value + ' ' + cited.map((l) => l.s.text).join(' ')) && !/^(?:a|an)\s/i.test(value)
      && !/(?<![\p{L}])(?:believe[sd]?|like[sd]?|liked|love[sd]?|hate[sd]?|fear(?:ed|s)?|trust(?:ed|s)?|enjoy(?:ed|s)?|prefer(?:red|s)?|dislike[sd]?|mind(?:ed)?|care[sd]?)(?![\p{L}])/iu.test(value)) return { why: 'once' };
    // the quote: the cited sentence (its clause), as the writer wrote it
    const quotes = cited.map((l, i) => gateQuote(clauses[i], ctx.text) || gateQuote(l.s.text, ctx.text)).filter(Boolean);
    if (quotes.length !== cited.length) return { why: 'quote' };
    // said: inside speech or reported speech, whatever the reader marked
    const said = !!x.x || cited.every((l) => { const q = clauseOf(l.s, grounded); return talkOf(l.s, q, ctx); });
    // (round 3) what is said is quoted as said: the words inside the quotation
    // marks that hold the claim, not the tag after them ("Coldharbour has no
    // lamps," she said.), so every later read still finds it inside them
    if (said) {
      cited.forEach((l, i) => {
        const p0 = ctx.ch.paras[l.s.pi];
        const spans = speechSpans(p0.text).filter(([a, b]) => a < l.s.end && b > l.s.start);
        const best = spans.map(([a, b]) => p0.text.slice(a, b).replace(/^[“"‘'«\s]+|[”"’'»\s]+$/g, '').replace(/[,;:]+$/, '')).find((t) => grounded.some((w) => inBag(w, new Set(content(t)))));
        const q = best && gateQuote(best, ctx.text);
        if (q) quotes[i] = q;
      });
    }
    if (bySetting && !['membership', 'residents', 'members'].includes(key) && g !== 'membership' && quotes.some((q) => namesOther(q) || others.some((o) => o.kind === 'place' && o.name.split(/\s+/).length > 1 && new RegExp(`(?<![\\p{L}])${o.name.split(/\s+/).pop()}s?(?![\\p{L}])`, 'iu').test(q)))) return { why: 'setting' };
    // not from a sentence a slip stands on (a later value that differs)
    if (cited.some((l) => ctx.suspect && ctx.suspect.has(l.s.id))) return { why: 'suspect' };
    return { g, key, label, value, quotes, cited, said, interpretive: interpretive && ratio < 0.5, strong: cited.every((l) => l.why === 'name'), owned, ownedByName,
      setting: bySetting, lasting: LASTING.has(g) || ['habit', 'routine', 'custom', 'state', 'possession', 'personality'].includes(labelFamily(key)) || ['habit', 'routine', 'custom', 'state', 'possession'].includes(key) };
  }
  // (round 4) what one scene is: feelings, postures, states of the body
  const MOMENT_WORDS = new Set(('frightened afraid scared terrified cold freezing chilled tired weary exhausted angry furious cross livid sad unhappy upset miserable happy glad pleased delighted relieved worried ' +
    'embarrassed ashamed startled surprised shocked confused hungry thirsty sick drunk wet soaked drenched sleepy asleep awake alone late quiet silent calm bored lonely jealous excited breathless ' +
    'pale flushed crying weeping sobbing shaking trembling shivering laughing smiling frowning grinning lying sitting standing kneeling crouching curled leaning folded waiting sleeping dozing hunched slumped panting sweating').split(' '));
  const POSTURE = /(?<![\p{L}])(?:stood|stands|sat|sits|lay|lies|knelt|kneels|leaned|leant|crouched|waited|slept|dozed|fell asleep|curled|perched|slumped|huddled|paced)(?![\p{L}])/iu;
  const CONDITION = /(?<![\p{L}])(?:when|if|while|until|till|as soon as|once)\s+(?:\p{L}+\s+){0,3}$/iu;
  const KIND_NOUN = /(?<![\p{L}])(?:a|an)\s+(?:[\p{L}-]+\s+){0,2}?(?:man|woman|girl|boy|child|person|sort|kind|type|creature|dog|cat|horse|soul|fellow|lad|lass|lady|gentleman|bitch|mare|beast|thing)(?![\p{L}])/iu;
  const STANDING = /(?<![\p{L}])(?:by nature|by temperament|all (?:his|her|their|its) life|since (?:he|she|it) was|had always|was always|is always|always|never|every|whenever|easily|of (?:dogs|horses|thunder|the dark|water|heights|strangers|crowds|fire|spiders))(?![\p{L}])/iu;
  // (what a place, a group or a thing can be in a lasting way of these: a cold room, a quiet street)
  const PLACE_OK = new Set(['cold', 'freezing', 'chilled', 'wet', 'quiet', 'silent', 'calm', 'late', 'pale', 'alone', 'folded', 'curled', 'waiting', 'sitting', 'sleeping', 'standing', 'lying', 'dozing']);
  const DURATION = /(?<![\p{L}])(?:for (?:a |an )?(?:long |little |short |good |few |whole )?(?:while|moment|time|minute|minutes|second|seconds|spell|instant|hour|hours|night|day|week)|a long (?:while|time)|all (?:night|day|morning|evening))(?![\p{L}])/giu;
  function momentary(value, cited, part, c, key) {
    const fam = labelFamily(key);
    if (['role', 'origin', 'history', 'age', 'sex', 'name', 'membership', 'species', 'rule'].includes(fam) || key === 'relationship.kin' || key === 'location.home') return false;
    const living = ['person', 'creature'].includes(c.kind);
    const vt = tokens(value);
    const words = vt.filter((w) => MOMENT_WORDS.has(w) && (living || !PLACE_OK.has(w)));
    const cw = content(value);
    // (the clauses that hold the value's words: "The girls were frightened of Mr Wilde, who never raised his voice" — the never is the voice's)
    const clauseText = (l) => l.s.text.split(/[,;:]\s+|\s+(?:who|which|whose|but)\s+/).filter((x) => content(x).some((w) => cw.includes(w)));
    const text = cited.flatMap(clauseText).join(' ') || cited.map((l) => l.s.text).join(' ');
    if (!living) {
      // (a place is never frightened or sick: whoever is, it isn't this one's; "never hungry here" is what it does)
      return words.length > 0 && words.length * 2 >= Math.max(1, cw.length) && !HABITUAL.test(text) && !STANDING.test(text);
    }
    if (words.length && new RegExp(DURATION.source, 'iu').test(text)) return true;
    // (made of such words, or of where one stood or lay: "the orchard" from "He stood at the orchard gate")
    // (where: "stood at the orchard gate"; a manner, "sat very upright", is how they are)
    const posture = !words.length && cw.length <= 4 && cited.every((l) => {
      const m = POSTURE.exec(l.s.text);
      if (!m) return false;
      const after = l.s.text.slice(m.index + m[0].length).split(/[,;]|\s+and\s+/)[0];
      return /^\s*(?:at|on|in|by|beside|under|across|against|near|behind|outside|inside|upon|over)\s/i.test(after) && cw.every((w) => content(after).includes(w));
    });
    // (made of them, or opening with one: "asleep on the Younger's chest")
    const opens = words.length && /^(?:(?:very|so|too|quite|half|fast|sound)\s+)?(\p{L}+)/u.exec(norm(value)) && MOMENT_WORDS.has(/^(?:(?:very|so|too|quite|half|fast|sound)\s+)?(\p{L}+)/u.exec(norm(value))[1]);
    if (!posture && !(words.length && (words.length * 2 >= Math.max(1, cw.length) || opens))) return false;
    // a condition is no state: "when he was tired"
    const at = (w) => { const i = norm(text).search(new RegExp(`(?<![\\p{L}])${escRe(w)}(?![\\p{L}])`, 'u')); return i < 0 ? null : norm(text).slice(0, i); };
    if (words.some((w) => { const b = at(w); return b != null && CONDITION.test(b); })) return true;
    if (HABITUAL.test(text) || STANDING.test(text)) return false;
    if (words.some((w) => new RegExp(KIND_NOUN.source.replace('(?:[\\p{L}-]+\\s+){0,2}?', `(?:[\\p{L}-]+\\s+){0,2}?${escRe(w)}\\s+(?:[\\p{L}-]+\\s+)?`), 'iu').test(text))) return false;
    // the same word in another sentence of the pack about them
    const others = part.lines.filter((l) => ['name', 'chain'].includes(l.why) && !cited.includes(l));
    if (words.length && words.every((w) => others.some((l) => tokens(l.s.text).includes(w)))) return false;
    return true;
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

  /* ---------- introductions, read by code ---------- */

  const INTRO_NOUN = new Set(['man', 'woman', 'girl', 'boy', 'lad', 'lass', 'child', 'fellow', 'figure', 'person', 'creature', 'gentleman', 'lady']);
  const ADJ_SLOT = {};
  for (const w of ['tall', 'short', 'tallest', 'shortest', 'taller', 'towering', 'lanky', 'long-legged']) ADJ_SLOT[w] = ['appearance', 'height'];
  for (const w of ['long', 'thin', 'narrow', 'heavy', 'big', 'broad', 'stout', 'slight', 'lean', 'square', 'stooped', 'small', 'plump', 'fat', 'wiry', 'burly', 'slender', 'skinny', 'gaunt', 'bony', 'stocky', 'large', 'hefty', 'straight-backed', 'hunched', 'frail', 'sturdy', 'muscular', 'tiny', 'little']) ADJ_SLOT[w] = ['appearance', 'build'];
  for (const w of ['old', 'young', 'elderly', 'middle-aged', 'ancient', 'aged']) ADJ_SLOT[w] = ['age', 'age'];
  for (const w of ['bald', 'balding', 'grey-haired', 'gray-haired', 'sandy-haired', 'red-haired', 'fair-haired', 'dark-haired', 'white-haired', 'black-haired', 'curly-haired', 'shaven-headed']) ADJ_SLOT[w] = ['appearance', 'hair'];
  for (const w of ['freckled', 'pale', 'sunburnt', 'sunburned', 'bearded', 'clean-shaven', 'scarred', 'one-eyed', 'weathered', 'pock-marked', 'ruddy']) ADJ_SLOT[w] = ['appearance', 'face'];
  for (const w of ['anxious', 'nervous', 'quiet', 'cheerful', 'shy', 'gentle', 'stern', 'kindly', 'fierce', 'timid', 'cheery', 'grim', 'solemn', 'restless']) ADJ_SLOT[w] = ['personality', 'personality'];
  const WITH_SLOT = [[/\b(?:hair|head|curls|plait|braid|ponytail|fringe)\b/, ['appearance', 'hair']], [/\beyes?\b/, ['appearance', 'eyes']], [/\b(?:beard|moustache|mustache|whiskers|stubble|teeth|nose|chin|jaw|cheeks?|freckles|face|skin)\b/, ['appearance', 'face']],
    [/\b(?:scar|scars|burn|tattoo|tattoos|mark|birthmark|patch)\b/, ['appearance', 'mark']], [/\b(?:spectacles|glasses|monocle|earrings?|ring|hat|coat|cap|cloak|apron|boots|uniform|scarf)\b/, ['appearance', 'clothing']],
    [/\b(?:limp|stick|cane|crutch|stoop)\b/, ['appearance', 'other']], [/\bvoice\b/, ['personality', 'speech']], [/\blaugh\b/, ['personality', 'laugh']]];
  // → [{ g, a, v }] from one sentence that opens with c (named, or its pronoun)
  function introFacts(l, c, phits, para) {
    const s = l.s;
    const text = s.text;
    const head = (phits || []).find((h) => h.key === c.key && h.start === s.start + (text.match(/^[\s“"‘']*/u) || [''])[0].length);
    // "Her eyes were the brown of strong tea", "Ada's hair was black"
    if (c.kind === 'person' || c.kind === 'creature') {
      const own = (l.why === 'chain' && /^(?:her|his)\s/i.test(text)) || (head && /^['’]s\s/.test(text.slice(head.end - s.start)));
      const m2 = own && /^\S+\s+(eyes|hair)\s+(?:was|were|is|are)\s+((?:the\s+)?[^,;.]+?)(?=\s+and\s+(?:she|he)\b|[,;.]|$)/u.exec(head ? text.slice(head.end - s.start).replace(/^['’]s\s*/, 'x ') : text);
      if (m2 && m2[2].split(/\s+/).length <= 8 && !(para && para.talk.some(([a, b]) => a < s.end && b > s.start))) return [{ g: 'appearance', a: m2[1], v: m2[2] }];
    }
    const pron = l.why === 'chain' && /^(?:he|she)\b/i.test(text);
    if (!head && !pron) return [];
    if (para && para.talk.some(([a, b]) => a < s.end && b > s.start)) return [];
    const rest = head ? text.slice(head.end - s.start) : text.replace(/^\s*\S+/, '');
    const m = /^\s+(?:was|is)\s+(.+?)[.!?]*$/u.exec(rest);
    if (!m) return [];
    // (round 3) a moment, not a trait: "He was quiet for a long while"
    if (/(?<![\p{L}])for (?:a |an )?(?:long |little |short |good |few )?(?:while|moment|time|minute|minutes|second|seconds|spell|instant|hour|hours)(?![\p{L}])|(?<![\p{L}])(?:now|then|at last|again|suddenly)(?![\p{L}])/iu.test(m[1])) return [];
    // a place's or thing's: "Brennock was a grey slate town that climbed…", "Dock Three was the station’s only way out"
    if (c.kind !== 'person') {
      if (!head) return [];
      const np = /^((?:a|an|the)\s+[^,;:—–]+?)(?=\s+(?:that|which|who|where|whose|with|and|but)\s|[,;:—–]|$)/u.exec(m[1]);
      if (!np || np[1].split(/\s+/).length > 12 || np[1].split(/\s+/).length < 2) return [];
      return [{ g: 'description', a: 'what it is', v: np[1] }].filter((x) => !(phits || []).some((h) => h.key !== c.key && h.start >= s.start && h.end <= s.end && x.v.includes(para.text.slice(h.start, h.end))));
    }
    const out = [];
    const add = (g, a, v) => { v = v.replace(/^[\s,]+|[\s,]+$/g, ''); if (v && v.split(/\s+/).length <= 12 && !out.some((x) => x.v === v)) out.push({ g, a, v }); };
    // the head: "a short, bald man of sixty", "nineteen, narrow and quick", "the chief engineer, a heavy man"
    let body = m[1];
    // (where they are or what they're doing is the scene, not the person: "was in the galley", "was waiting")
    if (/^(?:in|at|on|by|with|from|under|over|behind|beside|near|inside|outside|already|still|now|waiting|sitting|standing|out|up|down|there|here|not|never|about|going|being)\b/i.test(body) || /^\w+ing\b/.test(body)) return [];
    // (a predicate that is someone's kin, "my mother's younger brother, a big slow man": what follows it)
    if (/['’]s\s/.test(body.split(',')[0])) {
      const next = /^[^,]*,\s+((?:a|an)\s.+)$/u.exec(body);
      if (!next) return [];
      body = next[1];
    }
    const stopAt = body.search(/\s(?:who|whose|that|which|where|when)\s|,?\s+and\s+(?:she|he|it|they|had|was|is)\s|;|—|–/);
    const clause = stopAt < 0 ? body : body.slice(0, stopAt);
    const cut = clause.search(/\s(?:with|from)\s/);
    const front = cut < 0 ? clause : clause.slice(0, cut);
    const words = front.split(/[\s,]+/).filter(Boolean).map((w) => w.toLowerCase().replace(/[’']s$/, ''));
    const ageN = /\bof\s+((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-\w+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|\d+)\b/.exec(front) || /^((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-[a-z]+)?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|\d+)\b/.exec(front);
    if (ageN) add('age', 'age', ageN[1]);
    const slots = new Map();
    for (const w of words) {
      const k = ADJ_SLOT[w];
      if (!k) continue;
      const key = k.join('.');
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(w);
    }
    for (const [key, ws] of slots) {
      const [g, a] = key.split('.');
      // (as written: the words in their order)
      add(g, a === 'height' ? 'height' : a, ws.join(g === 'personality' || a === 'build' ? ' and ' : ', ').replace(/^(\w+), (\w+)$/, '$1, $2'));
    }
    const noun = words.find((w) => INTRO_NOUN.has(w));
    if (noun && SEX_WORDS[noun]) add('sex', 'sex', noun);
    // "with a shaved head and a burn scar across the back of her right hand"
    const w = /\swith\s+(.+)$/u.exec(clause);
    if (w) {
      for (const np of w[1].split(/,\s+(?:and\s+)?|\s+and\s+(?=(?:a|an|the|his|her|two|one)\s)/u)) {
        if (/^(?:he|she|it|they)\b/i.test(np.trim())) break;
        // "with … a habit of rubbing the bridge of his nose when he was tired"
        if (/^(?:a|the)\s+(?:habit|way|knack|tendency|trick)\s+of\b/i.test(np.trim())) { add('habit', 'habit', np.split(/,\s/)[0]); continue; }
        const slot = WITH_SLOT.find(([re]) => re.test(np.toLowerCase()));
        if (slot) add(slot[1][0], slot[1][1], np.split(/\s+(?:who|which|that|and\s+(?:he|she))\s/u)[0]);
      }
    }
    // "with half-moon spectacles and a voice too big for him" is the person's; a place in it is not
    return out.filter((x) => !(phits || []).some((h) => h.key !== c.key && x.v.includes(para.text.slice(h.start, h.end))));
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
      // (the quote's own word for it, when the value is only "male" or "female": "a thin boy of fourteen")
      return { attr: 'sex', value: v, as: SEX_WORDS[word] ? word : (wordsOf(quote).find((x) => SEX_WORDS[x] && SEX_WORDS[x][0] === v && !SEX_WORDS[x][2]) || '') };
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
  // a number written as words or digits: "twenty-six" → 26, "forty" → 40
  const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function numberOf(w) {
    const t = String(w || '').toLowerCase();
    if (/^\d+$/.test(t)) return +t;
    const [a, b] = t.split('-');
    if (UNITS[a] !== undefined && !b) return UNITS[a];
    if (TENS[a] !== undefined && (!b || UNITS[b] !== undefined)) return TENS[a] + (b ? UNITS[b] : 0);
    return null;
  }
  // how old a sentence says someone is: "twenty-nine years", "aged sixty",
  // "a woman of sixty", "was nineteen" → [{ n, start, end }]
  function agesIn(text) {
    const out = [];
    const NUM = '(\\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
    for (const re of [new RegExp(`(?<![\\p{L}-])${NUM}[- ]years?(?:[- ]old)?(?![\\p{L}])`, 'giu'), new RegExp(`(?<![\\p{L}])(?:aged|was|is|of)\\s+${NUM}(?![\\p{L}-])(?!\\s+(?:years?\\s+(?:ago|before|later|since)|times|of|minutes|hours|days|weeks|months|men|women|people|feet|miles|yards|metres|pounds))`, 'giu')]) {
      for (const m of text.matchAll(re)) {
        const n = numberOf(m[1]);
        if (n == null || n > 120) continue;
        const at = m.index + m[0].indexOf(m[1]);
        if (!out.some((x) => x.start === at)) out.push({ n, start: at, end: at + m[1].length });
      }
    }
    return out;
  }
  // words of one kind that can't both hold: colours, and what a thing is built of
  const MATERIAL = { sandstone: 'sandstone', brick: 'brick', 'red-brick': 'brick', stone: 'stone', timber: 'timber', wooden: 'timber', wood: 'timber', slate: 'slate', concrete: 'concrete', granite: 'granite', marble: 'marble', glass: 'glass', iron: 'iron', steel: 'steel', thatch: 'thatch', thatched: 'thatch', flint: 'flint', cob: 'cob', limestone: 'limestone' };
  const classOf = (w) => (COLOURS[w] ? ['colour', COLOURS[w]] : MATERIAL[w] ? ['material', MATERIAL[w]] : null);
  function clashDetail(f, quote, sentence, names = []) {
    const who = names[0] || 'it';
    // an age said otherwise: "twenty-nine years of him" against "twenty-six"
    if (canonLabel(f.label || '') === 'age' || f.attr === 'age') {
      const had = agesIn(f.value).concat(numberOf(f.value.trim()) != null ? [{ n: numberOf(f.value.trim()) }] : []);
      // ("Hesper's was 41": a number of hers, not her age; "was N" needs her, or her he or she, as its subject)
      const subj = (x) => { const before = sentence.slice(0, x.start); if (!/(?:was|is)\s+$/i.test(before)) return true; const w = (before.replace(/\s*(?:was|is)\s+$/i, '').match(/([\p{L}'’]+)$/u) || [])[1] || ''; return !/['’]s$/.test(w) && (/^(?:he|she)$/i.test(w) || names.some((n) => content(n).includes(stem(norm(w))))); };
      const now = UNREAL.test(sentence) ? [] : agesIn(sentence).filter(subj);
      if (had.length && now.length && !now.some((x) => had.some((y) => y.n === x.n))) {
        const x = now[0];
        return { span: sentence.slice(x.start, x.end), q: `is ${who} ${sentence.slice(x.start, x.end)} years old?` };
      }
    }
    // a colour or a material said otherwise of the same thing: "his blue
    // Rover" against "a green P6", "the red-brick Corn Exchange" against
    // "a sandstone hall" (the value's own word, before any "with" or "on")
    {
      const vtoks = tokens(f.value.split(/\s(?:with|on|in|at|by|of|and|that|which|where)\s/i)[0]);
      const vclass = vtoks.map(classOf).filter(Boolean);
      const heads = new Set([...content(f.value), ...names.flatMap((n) => content(n))].filter((w) => !classOf(w)));
      // (or the quote's word for a thing the value names: "his old Rover, a green P6" for "drives old Rover")
      const qt = tokens(quote);
      qt.forEach((w, i) => {
        const k = classOf(w);
        if (!k) return;
        const after = qt.slice(i + 1, i + 3).map(stem).some((x) => heads.has(x));
        const appos = qt.slice(Math.max(0, i - 4), i).some((x, j, arr) => heads.has(stem(x)) && ['a', 'an', 'the'].includes(arr[j + 1]));
        if (after || appos) vclass.push(k);
      });
      if (vclass.length) {
        const raw = [...sentence.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)];
        for (let i = 0; i < raw.length - 1; i++) {
          const w = norm(raw[i][0]);
          const k = classOf(w);
          if (!k || vclass.some((x) => x[0] === k[0] && x[1] === k[1]) || !vclass.some((x) => x[0] === k[0])) continue;
          const next = raw.slice(i + 1, i + 3).map((m) => stem(norm(m[0]).replace(/['’]s$/, '')));
          const noun = next.findIndex((x) => heads.has(x));
          if (noun < 0) continue;
          const at = raw[i].index;
          const a = Math.max(sentence.lastIndexOf(',', at), sentence.lastIndexOf(';', at)) + 1;
          if (UNREAL.test(sentence.slice(a, at + raw[i][0].length + 20))) continue;
          const nounStem = next[noun];
          const thing = names.find((n) => content(n).includes(nounStem)) || 'the ' + raw[i + 1 + noun][0].replace(/['’]s$/, '');
          return { span: raw[i][0], q: `is ${thing} ${raw[i][0]}?` };
        }
      }
    }
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
      // (a noun, not a deed: "to look for samphire" against "not looking at you")
      const qt = tokens(quote);
      const qi0 = qt.map(stem).indexOf(n);
      if (/(?:ing|ed)$/.test(b[i]) || (qi0 > 0 && ['to', 'would', 'could', 'did', 'does', 'do', 'will', 'can'].includes(qt[qi0 - 1])) || (i > 0 && ['to', 'would', 'could', 'did', 'does', 'do', 'will', 'can'].includes(b[i - 1]))) continue;
      const near = (arr, k) => arr.slice(Math.max(0, k - 4), k).some((w) => NEGATORS.has(w));
      const qi = qs.indexOf(n);
      const qTokens = tokens(quote).map(stem);
      const fNeg = near(qTokens, qTokens.indexOf(n)) || (negated(f.value) && qi >= 0);
      const bNeg = near(bs, i);
      if (fNeg !== bNeg && mark(i)) {
        return { span: mark(i), q: `does ${who} have ${rawAt(i)}?` };
      }
    }
    // a word against one of the value's, of the same one (near a word the two share)
    const named = new Set(names.flatMap((n) => content(n)));
    const shared = new Set(bs.filter((w, k) => w.length >= 3 && !STOPW.has(b[k]) && !NEGATORS.has(w) && (own.has(w) || named.has(w))));
    // (round 3: of the same thing — "the low streets" says nothing against "the high side of the square")
    const vtok = tokens(f.value).map(stem);
    const nextNoun = (arr, k) => { for (let j = k + 1; j < Math.min(arr.length, k + 3); j++) if (!STOPW.has(arr[j]) && !ANT.has(arr[j])) return arr[j]; return null; };
    for (const [i, w] of bs.entries()) {
      const against = ANT.get(w);
      if (!against || ![...against].some((x) => vs.includes(x)) || vs.includes(w)) continue;
      if (vs.length > 1 && !bs.slice(Math.max(0, i - 6), i + 7).some((x) => x !== w && shared.has(x))) continue;
      const vi = vtok.findIndex((x) => against.has(x));
      const nv = vi >= 0 ? nextNoun(vtok, vi) : null;
      const nb = nextNoun(bs, i);
      if (nv && nb && nv !== nb && !inBag(nv, new Set([nb]))) continue;
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
  // (Round 2: the facts' values and labels only, not their quotes: a quote
  // holds words about others, and a profile drew on them.)
  function profileOk(sentence, facts, e) {
    const allowed = new Set(content([...facts.map((f) => `${f.label || (C.ATTRS[f.attr] || {}).label || ''} ${f.value} ${f.as || ''}`), e.name, ...(e.aliases || [])].join(' ')));
    // every name in it is the entry's or in a cited value
    const caps = (sentence.match(/(?<=\S\s+)\p{Lu}[\p{L}'’-]+/gu) || []).map((w) => stem(norm(w).replace(/['’]s$/, '')));
    if (caps.some((w) => !allowed.has(w))) return false;
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
  async function readChapter({ src, paras, entries, reader, cache, names, stop, tell, suspect, sexOf: sexKnown, timed = null, narrator = null }) {
    const ch = chapterModel(paras);
    ch.notes = !!(src.notes || src.notebook);
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
    // the narrator of a story told in the first person (never of the writer's notes)
    let me = narrator ? cast.find((c) => c.entry === narrator) || null : null;
    if (!me && !src.notes && !src.notebook && (narrator || firstPerson(ch))) {
      const nn = narrator ? { name: narrator.name, aliases: narrator.aliases } : narratorNames(ch, cast, names && names.lower);
      me = nn.name ? cast.find((c) => c.kind === 'person' && [c.name, ...c.aliases].some((n) => norm(n) === norm(nn.name))) || null : null;
      if (!me) { me = { key: cast.length, name: nn.name || 'the narrator', kind: 'person', aliases: [], in: '', proper: !!nn.name && nn.name !== 'the narrator', wanted: [], entry: narrator || null }; cast.push(me); }
      for (const a of nn.aliases || []) {
        const other = cast.find((c) => c !== me && !c.gone && [c.name, ...c.aliases].some((n) => norm(n) === norm(a)));
        if (other && other.kind === 'person') mergeCast(cast, me, other);
        else if (!other && !me.aliases.some((x) => norm(x) === norm(a)) && norm(a) !== norm(me.name)) me.aliases.push(a);
      }
    }
    if (me) me.narrator = true;
    for (let i = cast.length - 1; i >= 0; i--) if (cast[i].gone) cast.splice(i, 1);
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
    const ctx = { ch, text: ch.text, suspect, cast, hits, sexOf };
    const proposals = [];
    let done = 0;
    await pool(jobs, reader.parallel || 1, async ({ c, part }) => {
      if (tell) tell({ phase: 'dossier', name: c.name, n: ++done, of: jobs.length });
      const facts = await ask('dossier', H('dossier', c.name, c.kind, c.aliases, part.text, !!c.narrator), () => reader.dossier({ name: c.name, kind: c.kind, aliases: c.aliases, text: part.text, n: part.lines.length, ...(c.narrator ? { narrator: true } : {}) }));
      for (const x of facts || []) {
        const gt = gateFact(x, part, c, ctx);
        if (gt.why) { dropped.push({ entity: c.name, label: x && x.a, value: x && x.v, why: gt.why }); continue; }
        proposals.push({ c, part, ...gt });
      }
    }, stop);
    if (stop && stop()) return { calls, dropped, stopped: true };
    // what an introduction gives, read by code (round 2: appearance was
    // mostly missing): "She was nineteen, narrow and quick, with a shaved
    // head and a burn scar…", "He was a short, bald man with half-moon
    // spectacles", "a big freckled girl from the farm domes with green eyes".
    // Each still passes the gates and the reader, like a dossier's.
    for (const { c, part } of jobs) {
      if (!['person', 'place', 'thing', 'group'].includes(c.kind)) continue;
      for (const l of part.lines) {
        if (!['name', 'chain'].includes(l.why)) continue;
        for (const x of introFacts(l, c, hits[l.s.pi], ch.paras[l.s.pi])) {
          if (proposals.some((p) => p.c === c && labelFamily(p.key) === labelFamily(keyOf(x.g, x.a)) && overlap(p.value, x.v) >= 0.5)) continue;
          const gt = gateFact({ ...x, s: [l.n], x: 0, intro: true }, part, c, ctx);
          if (gt.why) { dropped.push({ entity: c.name, label: x.a, value: x.v, why: 'intro: ' + gt.why }); continue; }
          proposals.push({ c, part, ...gt, intro: true });
        }
      }
    }
    // 3 · the verifier: the claim against the paragraphs it cites
    const passageOf = (p) => [...new Set(p.cited.map((l) => l.s.pi))].sort((a, b) => a - b).map((pi) => ch.paras[pi].text).join('\n\n');
    // the rest of the cast named in a fact's paragraphs (outside speech), nearest its sentences first
    const othersIn = (p) => {
      const at = Math.min(...p.cited.map((l) => l.s.start));
      const seen = [];
      for (const pi of [...new Set(p.cited.map((l) => l.s.pi))]) {
        const talk = ch.paras[pi].talk;
        for (const h of [...hits[pi]].sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))) {
          if (h.key === p.c.key || talk.some(([a, b]) => h.start < b && h.end > a)) continue;
          const o = cast[h.key];
          if (o && !seen.includes(o.name) && norm(o.name) !== norm(p.c.name)) seen.push(o.name);
        }
      }
      return seen.slice(0, 4);
    };
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
      // others in the passage: whose is it? A choice, not a yes (a reader
      // that says yes to anything picks one name, and it must be this one)
      const others = othersIn(p);
      // (asked too when the sentence's grammar didn't say it is this one's: a
      // place named only as where something else is — "the Haddons’ house on Bridge Street")
      if (p.verdict === 'yes' && (others.length || (!p.owned && !['person', 'creature'].includes(p.c.kind))) && typeof reader.whose === 'function') {
        const options = [p.c.name, ...others].sort((a, b) => a.localeCompare(b));
        const who = await ask('verdict', H('whose', claim, options), () => reader.whose({ ...claim, options }));
        if (who !== p.c.name) p.verdict = 'no';
      }
      // and the other way round: is the claim wrong about it? (only "no" keeps it)
      if (p.verdict === 'yes' && typeof reader.verify === 'function') {
        const neg = await ask('verdict', H('negated', claim), () => reader.verify({ ...claim, negated: true }));
        if (neg !== 'no') p.verdict = neg === 'yes' ? 'no' : 'unclear';
      }
      // tied by a pronoun or a paragraph, not a name: is it someone else's?
      if (p.verdict === 'yes' && !p.strong && !others.length && !p.owned) {
        const other = await ask('verdict', H('other', claim), () => reader.verify({ ...claim, other: true }));
        if (other !== 'no') p.verdict = other === 'yes' ? 'no' : 'unclear';
      }
      // one moment, or lasting?
      if (p.verdict === 'yes' && p.lasting) p.verdict = await ask('verdict', H('lasting', claim), () => reader.verify({ ...claim, lasting: true }));
      // (round 4) and the other way round: only this moment? (only "no" keeps it)
      if (p.verdict === 'yes' && p.lasting) {
        const once = await ask('verdict', H('moment', claim), () => reader.verify({ ...claim, moment: true }));
        if (once !== 'no') p.verdict = once === 'yes' ? 'no' : 'unclear';
      }
    }, stop);
    if (stop && stop()) return { calls, dropped, stopped: true };
    // into the entries: open facts (and what is only said) and trait proposals
    const made = new Map();
    const entryOf = (c) => {
      if (c.entry) {
        // (the names this chapter used for it are its names too: "Constance Haddon" for "Constance")
        for (const a of [c.name, ...c.aliases]) if (c.proper && norm(a) !== norm(c.entry.name) && !c.entry.aliases.some((x) => norm(x) === norm(a)) && /^\p{Lu}/u.test(a.replace(/^the\s+/i, ''))) c.entry.aliases.push(a);
        return c.entry;
      }
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
    // (round 3) the names this chapter writes for an entry are its names, kept or not ("Tamsin Marchetti" for "Tamsin")
    // (only a fuller form of the entry's own name, no title: "Tamsin Marchetti" for "Tamsin", never "Mrs Haddon" for "Dr Haddon")
    for (const c of cast) {
      if (!c.entry || c.entry.locked || !c.proper || c.kind !== 'person') continue;
      const own = norm(c.entry.name).split(/\s+/);
      for (const a of [c.name, ...c.aliases]) {
        const ws = norm(a).split(/\s+/);
        if (ws.length > own.length && own.every((w) => ws.includes(w)) && !ws.some((w) => TITLES.has(w.replace(/\.$/, ''))) && /^\p{Lu}/u.test(a) && !c.entry.aliases.some((x) => norm(x) === norm(a))) c.entry.aliases.push(a);
      }
    }
    const kept = [];
    for (const p of proposals) {
      if (p.verdict !== 'yes') { dropped.push({ entity: p.c.name, label: p.label, value: p.value, why: 'verifier: ' + (p.verdict || 'none') }); continue; }
      const e = entryOf(p.c);
      const sources = p.quotes.map((q) => ({ label: book, quote: q, book: src.bookId, ch: src.chId, ...(p.said ? { said: true } : {}) }));
      const trait = ['sex', 'species', 'appearance.hair', 'appearance.eyes'].includes(p.key) ? traitOf(p.key, p.value, p.quotes.join(' ')) : null;
      if (trait) {
        // (round 3: the claim's grammar ties the trait word to it — by its name, or by a pronoun the reading is sure of)
        kept.push({ e, f: { attr: trait.attr, value: trait.value, as: trait.as, state: 'unverified', sources }, trait: true, p, tie: p.ownedByName ? 'name' : p.owned ? 'pronoun' : null });
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
      const role = [c.name, ...c.aliases].find((n) => /^the\s+(?:\p{Ll}[\p{Ll}-]+|\p{Lu}\p{Ll}{3,})$/u.test(n) && !CROWD.has(n.slice(4).toLowerCase()) && !TITLES.has(n.slice(4).toLowerCase()) && !NUMBER.test(n.slice(4).toLowerCase()) && !EPITHET.test(n));
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
      if ((n >= 2 && (c.proper || ['person', 'creature', 'place', 'group'].includes(c.kind))) || (n >= 1 && c.proper && c.kind === 'creature')) entryOf(c);
    }
    // the narration's he and she, as the chapter's reading resolves them (round 3:
    // "She was nineteen, narrow and quick", "He was a head shorter than she was"):
    // per entry, the sentences each pronoun gives it, strong only, never in talk
    const pronouns = [];
    for (const c of cast) {
      if (!['person', 'creature'].includes(c.kind) || c.narrator) continue;
      const by = { male: [], female: [] };
      for (const p of ch.paras) {
        for (const [at, r] of p.refs || []) {
          if (!r.strong || r.key !== c.key || p.talk.some(([a, b]) => at < b && at + 2 > a)) continue;
          const w = norm((p.text.slice(at).match(/^\p{L}+/u) || [''])[0]);
          const sex = PRONOUNS[w];
          const s = p.sents.find((x) => at >= x.start && at < x.end);
          if (!sex || !s || by[sex].some((x) => x.s === s)) continue;
          by[sex].push({ s, pi: p.pi });
        }
      }
      if (by.male.length || by.female.length) pronouns.push({ c, by });
    }
    const pron = pronouns.map(({ c, by }) => ({ e: c.entry || made.get(c.key) || null, by })).filter((x) => x.e);
    return { calls, dropped, kept, cast, ch, pronouns: pron, narrator: me ? (me.entry || made.get(me.key) || null) : null };
  }

  // The chapter's reading of its pronouns for the pass (round 3): per
  // paragraph, Map(start → { id, strong, body }) by entry id, from the entries
  // as they stand. → [Map] in paragraph order
  function readingRefs(paras, entries) {
    const ch = chapterModel(paras);
    const live = entries.filter((e) => !e.locked);
    const cast = live.map((e, i) => ({ key: i, name: e.name, kind: e.kind, aliases: e.aliases || [], entry: e }));
    const hits = chapterHits(ch, cast);
    const sexOf = (k) => { const f = cast[k] && cast[k].entry.facts.find((x) => x.attr === 'sex' && ['verified', 'yours'].includes(x.state)); return f ? f.value : null; };
    resolveRefs(ch, hits, cast, sexOf);
    return ch.paras.map((p) => new Map([...(p.refs || new Map())].map(([at, r]) => [at, { id: cast[r.key].entry.id, strong: r.strong, body: !!r.body }])));
  }

  return { EDITOR_PROMPT, readingRefs, resolveRefs, writtenNames, firstPerson, narratorNames, selfHits, clashDetail, chapterModel, castGate, namingTies, chapterHits, sexHints, packFor, packParts, gateFact, clauseOf, claimOwner, introFacts, traitOf, clashCandidate, overlap, profileOk, readChapter, pool, stem, content, inBag, GROUPS, KINDS };
};
