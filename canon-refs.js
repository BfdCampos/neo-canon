// NEO — Canon's references (READING.md §15, round 5): who a later sentence
// is about when it doesn't use the name, and the slots a name, a rank or a
// breed give a value to.
//
// The real reader tied a sentence to its one only by the plain name, so a
// slip told by an epithet ("The commander's brown eyes"), a short name
// ("Tom came down late, rubbing his dark hair"), a generation ("the bell
// that Young Joss had cast", "The old man's blue eyes"), an owner and a kind
// ("Mrs Hollis's little Jack Russell"; "The commander's Labrador, Bess")
// went by. Here code finds them, from the entries as they stand:
//
//   strong  a rank or role only one of them holds ("the commander", "the
//           landlady"); the old one and the young one of a name a father and
//           son share ("the old man", "the boy", "young Josiah"); a short
//           form of one given name no one else has ("Tom" for Thomas); an
//           owner's possessive with the kind of the one animal they keep
//   weak    a kind noun that only one animal on the shelf is ("the dog",
//           "the little terrier"): the reader confirms, else Worth a look
//
// and the slots the pass holds them to: a rank (on a ladder: a commander is
// not a lieutenant commander), an animal's name (a different proper name
// with its owner and its kind is the same animal renamed — two cues at
// least, so a second dog is never taken for the first), an animal's breed.
//
// No I/O; nothing here reads a model. canon.js loads it with its helpers.
'use strict';

module.exports = function canonRefs(C) {
  const { norm, mentions, sentences, talkSpans, SPECIES, SEX_WORDS, breedsIn, breedClash, TITLES } = C;
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ---------- ranks ---------- */

  // Each ladder lowest first. A rank is a slot of the one who holds it: two
  // ranks of one ladder that differ can't both be theirs, unless the later
  // is the earlier shortened ("Inspector Gale" for Detective Inspector Gale;
  // "Commander" for a lieutenant commander is how they are spoken to, but a
  // commander written later as a lieutenant commander is a slip)
  const LADDERS = {
    navy: ['ordinary seaman', 'able seaman', 'leading seaman', 'petty officer', 'chief petty officer', 'warrant officer', 'midshipman', 'sub-lieutenant', 'lieutenant', 'lieutenant commander', 'commander', 'captain', 'commodore', 'rear admiral', 'vice admiral', 'admiral'],
    army: ['private', 'lance corporal', 'corporal', 'lance sergeant', 'sergeant', 'staff sergeant', 'colour sergeant', 'sergeant major', 'second lieutenant', 'lieutenant', 'captain', 'major', 'lieutenant colonel', 'colonel', 'brigadier', 'major general', 'lieutenant general', 'general', 'field marshal'],
    air: ['aircraftman', 'leading aircraftman', 'corporal', 'sergeant', 'flight sergeant', 'pilot officer', 'flying officer', 'flight lieutenant', 'squadron leader', 'wing commander', 'group captain', 'air commodore', 'air vice-marshal', 'air marshal'],
    police: ['constable', 'police constable', 'sergeant', 'inspector', 'chief inspector', 'superintendent', 'chief superintendent', 'assistant chief constable', 'deputy chief constable', 'chief constable'],
    church: ['deacon', 'curate', 'vicar', 'rector', 'archdeacon', 'dean', 'bishop', 'archbishop', 'cardinal']
  };
  // ("Detective Inspector" is an inspector who detects: the ladder's word without it)
  const rankKey = (r) => norm(r).replace(/[-\s]+/g, ' ').replace(/^(?:detective|acting|temporary|police)\s+(?=\S+)/, '').replace(/^d\.?\s?i\.?$/, 'inspector').trim();
  const ALL_RANKS = [...new Set(Object.values(LADDERS).flat())].sort((a, b) => b.length - a.length);
  const RANK_SRC = `(?:(?:Detective|Acting|Police)\\s+)?(?:${ALL_RANKS.map((r) => r.split(/[-\s]/).map((w) => w[0].toUpperCase() + escRe(w.slice(1))).join('[-\\s]')).join('|')})`;
  // a rank written right before a name: "Lieutenant Commander Okafor", "Constable Pryce"
  const RANK_BEFORE = new RegExp(`(${RANK_SRC})\\s+$`, 'u');
  const ladderOf = (k) => Object.entries(LADDERS).filter(([, xs]) => xs.includes(k)).map(([n]) => n);
  function rankClash(first, later) {
    const a = rankKey(first);
    const b = rankKey(later);
    if (!a || !b || a === b) return false;
    // (the later one shortened: "Commander" for the lieutenant commander she is)
    if (a.endsWith(' ' + b)) return false;
    const la = ladderOf(a);
    return ladderOf(b).some((l) => la.includes(l));
  }
  // the rank a text writes just before position `at` → { text, key, start } or null
  function rankAt(text, at) {
    const m = RANK_BEFORE.exec(text.slice(Math.max(0, at - 40), at));
    if (!m) return null;
    const start = at - m[0].length;
    // (a rank at the start of its own name: "Commander Ruth Okafor")
    if (start > 0 && /[\p{L}]/u.test(text[start - 1])) return null;
    return { text: m[1], key: rankKey(m[1]), start, end: start + m[1].length };
  }
  // the rank a name opens with: "Commander Ruth Okafor" → Commander
  function rankOfName(name) {
    const m = new RegExp(`^(${RANK_SRC})\\s+\\p{Lu}`, 'u').exec(String(name || ''));
    return m ? { text: m[1], key: rankKey(m[1]) } : null;
  }
  // a rank told as a change: a promotion, an acting rank, one that was
  const RANK_CHANGE = /(?<![\p{L}])(?:promot\w*|demot\w*|made|became|become|becoming|appointed|acting|former|formerly|ex-|retired|late|then|now|newly|reduced to|broken to|rank of|raised to|stripped)(?![\p{L}])/iu;

  /* ---------- short names ---------- */

  // given names and their common short forms (a prefix of three letters or
  // more, with -ie, -y or -o, is one too: "Raff", "Robbie", "Jacko")
  const SHORT = {
    thomas: ['tom', 'tommy'], william: ['will', 'bill', 'billy', 'willie', 'liam'], robert: ['rob', 'bob', 'bobby', 'robbie', 'bert'], richard: ['dick', 'rick', 'richie', 'ricky'],
    edward: ['ed', 'ted', 'teddy', 'ned', 'eddie'], henry: ['harry', 'hal', 'hank'], john: ['jack', 'johnny', 'jock'], james: ['jim', 'jimmy', 'jamie', 'jem'], joseph: ['joe', 'joey', 'jo'],
    charles: ['charlie', 'chas', 'chuck'], frederick: ['fred', 'freddie'], albert: ['bert', 'bertie', 'al'], alfred: ['alf', 'alfie', 'fred'], arthur: ['art', 'artie'], benjamin: ['ben', 'benny'],
    samuel: ['sam', 'sammy'], daniel: ['dan', 'danny'], michael: ['mike', 'mick', 'micky'], patrick: ['pat', 'paddy'], anthony: ['tony'], alexander: ['alex', 'sandy', 'alec'], archibald: ['archie'],
    nicholas: ['nick', 'nicky'], christopher: ['chris', 'kit'], peter: ['pete'], david: ['dave', 'davy'], stephen: ['steve'], timothy: ['tim', 'timmy'], matthew: ['matt'], harold: ['harry', 'hal'],
    josiah: ['joss', 'josh'], joshua: ['josh'], george: ['georgie'], walter: ['wally', 'walt'], leonard: ['len', 'lenny'], douglas: ['doug'], gerald: ['gerry'], reginald: ['reg', 'reggie'], ronald: ['ron', 'ronnie'],
    elizabeth: ['liz', 'lizzie', 'beth', 'betty', 'bess', 'bessie', 'eliza', 'libby'], margaret: ['maggie', 'meg', 'peggy', 'peg', 'madge', 'margo'], mary: ['molly', 'polly', 'mae'], catherine: ['kate', 'kitty', 'cath', 'cathy', 'kit'],
    katherine: ['kate', 'kitty', 'kath', 'kathy', 'kit'], sarah: ['sally', 'sadie'], ann: ['annie', 'nan', 'nancy'], anne: ['annie', 'nan', 'nancy'], eleanor: ['nell', 'nellie', 'ellie', 'nora'], ellen: ['nell', 'nellie'],
    helen: ['nell', 'nellie'], dorothy: ['dot', 'dolly', 'dottie'], florence: ['flo', 'florrie'], frances: ['fran', 'fanny'], jennifer: ['jen', 'jenny'], jane: ['jenny', 'janey'], josephine: ['jo', 'josie'],
    joanna: ['jo'], victoria: ['vicky', 'tori'], patricia: ['pat', 'patsy', 'trish'], susan: ['sue', 'susie'], rebecca: ['becky'], deborah: ['debbie', 'deb'], imogen: ['immy'], winifred: ['winnie'], wilhelmina: ['mina', 'billie'],
    theodore: ['theo', 'ted', 'teddy'], augustus: ['gus'], bartholomew: ['bart', 'tolly'], ebenezer: ['eben'], nathaniel: ['nat', 'nate'], abigail: ['abby'], isabel: ['izzy', 'bel'], isobel: ['izzy', 'bel'], harriet: ['hattie'], martha: ['mattie', 'patty'], matilda: ['tilly', 'tilda']
  };
  function shortOf(short, given) {
    const s = norm(short);
    const g = norm(given);
    if (!s || !g || s === g || s.length < 2) return false;
    if ((SHORT[g] || []).includes(s)) return true;
    const bare = s.replace(/(?:ie|y|o|s)$/, '');
    return bare.length >= 3 && s.length < g.length && g.startsWith(bare) && s.length <= g.length - 1;
  }

  /* ---------- the forms that refer ---------- */

  const GEN_OLD = /\s+(?:the\s+(?:Elder|Eldest|First|Older)|Senior|Sr\.?)$/u;
  const GEN_YOUNG = /\s+(?:the\s+(?:Younger|Youngest|Second)|Junior|Jr\.?)$/u;
  // (a read in progress has this read's facts not yet checked: `loose` takes them, as the suspects do)
  let loose = false;
  const firm = (f) => ['verified', 'yours'].includes(f.state) || (loose && f.state === 'unverified' && f.sources.some((x) => !x.said && !x.plan));
  const looseRun = (fn) => (...args) => { const o = args[args.length - 1]; const was = loose; loose = !!(o && typeof o === 'object' && !Array.isArray(o) && o.loose); try { return fn(...args); } finally { loose = was; } };
  const live = (entries) => entries.filter((e) => !e.locked);
  // a person's given name: the first word of the name no title opens
  const RANK_WORDS = new Set(ALL_RANKS.flatMap((r) => r.split(/[-\s]/)));
  const givenOf = (e) => { const ws = String(e.name).split(/\s+/).filter((w) => !TITLES.has(norm(w).replace(/\.$/, '')) && !RANK_WORDS.has(norm(w))); const w = ws[0]; return w && /^\p{Lu}\p{Ll}+$/u.test(w) && ws.length > 1 ? w : null; };
  // a person's rank: the one their name opens with, an alias's, or a Rank fact (first said, first kept)
  function rankOf(e) {
    const f = e.facts.find((x) => x.attr === 'other' && /^rank$/i.test(x.label || '') && firm(x));
    if (f) return { text: f.value, key: rankKey(f.value) };
    for (const n of [e.name, ...(e.aliases || [])]) { const r = rankOfName(n); if (r) return r; }
    return null;
  }
  const sexOf = (e) => { const f = e.facts.find((x) => x.attr === 'sex' && firm(x)); return f ? f.value : null; };
  // what an animal is: its species (a firm fact) and the breed its sources write
  function kindOf(e) {
    const sp = e.facts.find((x) => x.attr === 'species' && firm(x));
    const quotes = e.facts.filter(firm).flatMap((f) => f.sources.filter((s) => !s.written).map((s) => s.quote || ''));
    const breed = quotes.flatMap((q) => breedsIn(q)).find((b) => !sp || b.species === sp.value) || (sp && sp.as ? breedsIn(sp.as)[0] : null) || null;
    const species = sp ? sp.value : breed ? breed.species : null;
    return { species, breed };
  }
  // an animal's owners: the people its facts name as owner, and those whose facts keep it
  function ownersOf(e, entries, forms) {
    const people = live(entries).filter((x) => x.kind === 'person');
    const says = (text, p) => [p.name, ...(p.aliases || []), ...((forms.get(p.id) || []).filter((x) => x.strength === 'strong').map((x) => x.phrase))].some((n) => n && new RegExp(`(?<![\\p{L}])${escRe(n.replace(/^the\s+/i, ''))}(?![\\p{L}])`, 'iu').test(text));
    const out = new Set();
    for (const f of e.facts.filter(firm)) {
      if (!(f.attr === 'owner' || /possession|owner|belongs/i.test(f.label || ''))) continue;
      for (const p of people) if (says(f.value, p)) out.add(p.id);
    }
    for (const p of people) {
      if (p.facts.some((f) => firm(f) && (f.attr === 'other' && /possession|pet|dog|cat|horse|owns/i.test(f.label || '')) && new RegExp(`(?<![\\p{L}])${escRe(e.name)}(?![\\p{L}])`, 'u').test(f.value))) out.add(p.id);
    }
    return [...out];
  }

  // The forms that refer, per entry: Map(id → [{ phrase, strength, why }])
  function refForms(entries) {
    const L = live(entries);
    const out = new Map(L.map((e) => [e.id, []]));
    const add = (e, phrase, strength, why) => { if (!out.get(e.id).some((x) => norm(x.phrase) === norm(phrase))) out.get(e.id).push({ phrase, strength, why }); };
    const names = new Set(L.flatMap((e) => [e.name, ...(e.aliases || [])]).map((n) => norm(n)));
    const people = L.filter((e) => e.kind === 'person');
    // a rank, or a role's own noun, only one of them holds: "the commander", "the landlady"
    const ranks = new Map();
    for (const e of people) { const r = rankOf(e); if (r) { const w = r.key.split(' ').pop(); ranks.set(w, (ranks.get(w) || []).concat(e)); } }
    for (const [w, xs] of ranks) if (xs.length === 1 && !names.has('the ' + w)) add(xs[0], 'the ' + w, 'strong', 'rank');
    const roles = new Map();
    for (const e of people) {
      for (const f of e.facts.filter((x) => firm(x) && x.attr === 'other' && /^(?:role|job|occupation|post|position|title|work)$/i.test(x.label || ''))) {
        const m = /^(?:the\s+|a\s+|an\s+)?(?:[\p{Ll}-]+\s+)?([\p{Ll}]{4,})(?=\s+(?:of|at|on|in|for|to)\b|,|$)/u.exec(f.value);
        if (!m || /(?:ing|ed|s)$/.test(m[1]) && !/(?:ess|ss)$/.test(m[1])) continue;
        roles.set(m[1], [...new Set((roles.get(m[1]) || []).concat(e))]);
      }
    }
    for (const [w, xs] of roles) if (xs.length === 1 && !ranks.has(w) && !names.has('the ' + w) && !SPECIES[w] && !SEX_WORDS[w]) add(xs[0], 'the ' + w, 'strong', 'role');
    // one name, a father and a son: the old one and the young one
    const pairs = [];
    for (const a of people) {
      if (!GEN_OLD.test(a.name)) continue;
      const base = a.name.replace(GEN_OLD, '');
      const b = people.find((x) => x !== a && GEN_YOUNG.test(x.name) && x.name.replace(GEN_YOUNG, '') === base);
      if (b) pairs.push([a, b, base]);
    }
    if (pairs.length === 1) {
      const [old, young, base] = pairs[0];
      const given = base.split(/\s+/)[0];
      const male = (e) => sexOf(e) !== 'female';
      if (male(old)) for (const p of ['the old man', 'old ' + given, 'Old ' + given]) add(old, p, 'strong', 'generation');
      else for (const p of ['the old woman', 'old ' + given, 'Old ' + given]) add(old, p, 'strong', 'generation');
      if (male(young)) for (const p of ['the boy', 'the lad', 'young ' + given, 'Young ' + given]) add(young, p, 'strong', 'generation');
      else for (const p of ['the girl', 'young ' + given, 'Young ' + given]) add(young, p, 'strong', 'generation');
    }
    // a short form of one given name no one else on the shelf has
    for (const e of people) {
      const g = givenOf(e);
      if (!g) continue;
      const forms = [...new Set([...(SHORT[norm(g)] || [])])];
      for (const s of forms) {
        const S = s[0].toUpperCase() + s.slice(1);
        if (names.has(norm(S)) || people.some((o) => o !== e && givenOf(o) && (shortOf(s, givenOf(o)) || norm(givenOf(o)) === s))) continue;
        add(e, S, 'strong', 'short');
      }
    }
    // an animal: the one of its kind on the shelf ("the dog", "the terrier", weak)
    const creatures = L.filter((e) => e.kind === 'creature').map((e) => ({ e, k: kindOf(e) }));
    const KIND_WORDS = (k) => [...new Set([k.species, ...(k.breed ? [k.breed.word.toLowerCase(), k.breed.text.toLowerCase()] : []), ...Object.keys(SPECIES).filter((w) => SPECIES[w] === k.species && !/^(?:puppy|pup|kitten|foal|calf|lamb|piglet|hound|mongrel|cob|nag|moggy)$/.test(w) && !(C.breedOf && C.breedOf(w)))])].filter(Boolean);
    for (const { e, k } of creatures) {
      if (!k.species) continue;
      if (creatures.filter((x) => x.k.species === k.species).length !== 1) continue;
      for (const w of KIND_WORDS(k)) if (!names.has('the ' + w)) add(e, 'the ' + w, 'weak', 'kind');
    }
    return out;
  }

  // The entries with the strong forms among their aliases, for an index the
  // pass reads by: [entry-like { id, name, kind, aliases }]
  const withForms = (entries, forms) => live(entries).map((e) => ({ ...e, aliases: [...(e.aliases || []), ...(forms.get(e.id) || []).filter((x) => x.strength === 'strong').map((x) => x.phrase)] }));

  /* ---------- an animal's name and breed, said otherwise ---------- */

  // In one paragraph's narration: "<owner>'s (little) <kind>, <Name>," or
  // "the <kind>, <Name>," where the kind and the owner (two cues) say which
  // animal it is and the name isn't its own; "<owner>'s (little) <breed>"
  // or "the little <breed>" where the breed isn't its own.
  // → [{ id, slot: 'name'|'breed', start, end, span, to, strength, cues }]
  const ADJ = '(?:(?:little|old|big|young|fat|thin|lean|small|great|grey|black|white|brown|ginger|tabby|wire-haired|rough-coated|smooth-coated|shaggy|elderly|ancient|ageing|lame|blind|deaf|faithful|beloved|own|new)\\s+){0,3}';
  function animalSlots(text, entries, forms, idx) {
    const L = live(entries);
    const talk = talkSpans(text);
    const free = (a, b) => !talk.some(([s, e]) => a < e && b > s);
    const out = [];
    const creatures = L.filter((e) => e.kind === 'creature').map((e) => ({ e, k: kindOf(e), owners: ownersOf(e, entries, forms) }));
    if (!creatures.length) return out;
    const ms = mentions(text, idx);
    const kindWord = (w) => { const lw = norm(w); const b = breedsIn(w)[0]; return SPECIES[lw] || (SEX_WORDS[lw] && SEX_WORDS[lw][2]) || (b ? b.species : null); };
    // each "<owner>'s ADJ <noun>" and "the ADJ <noun>"
    const heads = [];
    for (const m of ms) {
      const o = L.find((x) => x.id === m.id);
      if (!o || o.kind !== 'person' || !/^['’]s\s/.test(text.slice(m.end, m.end + 3))) continue;
      const after = text.slice(m.end + 3);
      const am = new RegExp(`^${ADJ}`, 'iu').exec(after);
      const rest = after.slice(am[0].length);
      const bm = breedsIn(rest).find((b) => b.start === 0);
      const wm = /^([\p{L}-]+)/u.exec(rest);
      const head = bm ? bm.text : wm ? wm[1] : '';
      const sp = bm ? bm.species : kindWord(head);
      if (!sp) continue;
      heads.push({ owner: o.id, start: m.start, nounAt: m.end + 3 + am[0].length, noun: head, breed: bm || null, species: sp, end: m.end + 3 + am[0].length + head.length });
    }
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])[Tt]he\\s+(${ADJ})`, 'gu'))) {
      const at = m.index + m[0].length;
      const rest = text.slice(at);
      const bm = breedsIn(rest).find((b) => b.start === 0);
      const wm = /^([\p{L}-]+)/u.exec(rest);
      const head = bm ? bm.text : wm ? wm[1] : '';
      const sp = bm ? bm.species : kindWord(head);
      if (!sp || heads.some((h) => h.nounAt === at)) continue;
      heads.push({ owner: null, start: m.index, nounAt: at, noun: head, breed: bm || null, species: sp, little: !!m[1].trim(), end: at + head.length });
    }
    for (const h of heads) {
      if (!free(h.start, h.end)) continue;
      // which animal: the owner's one of that kind; else the shelf's one of that kind
      const mine = creatures.filter((c) => c.k.species === h.species && (!h.owner || c.owners.includes(h.owner)));
      if (mine.length !== 1) continue;
      const c = mine[0];
      if (h.owner && !c.owners.includes(h.owner)) continue;
      const cues = (h.owner ? 1 : 0) + 1 + (h.breed && c.k.breed && !breedClash(h.breed, c.k.breed) && h.breed.key === c.k.breed.key ? 1 : 0);
      // a name in apposition, or "called"/"named" a name
      const nm = /^(?:\s*,\s*|\s+(?:called|named)\s+|\s*[—–]\s*)(\p{Lu}\p{Ll}+)(?=\s*[,.;:!?—–)]|\s+(?:was|is|had|lay|sat|stood|lifted|ran|came|barked|looked|followed|slept|wagged)\b)/u.exec(text.slice(h.end));
      if (nm) {
        const name = nm[1];
        const at = h.end + nm[0].length - name.length;
        const known = L.find((x) => [x.name, ...(x.aliases || [])].some((n) => norm(n) === norm(name)));
        if (!known && !TITLES.has(norm(name)) && free(at, at + name.length) && ![c.e.name, ...(c.e.aliases || [])].some((n) => norm(n) === norm(name))) {
          out.push({ id: c.e.id, slot: 'name', start: at, end: at + name.length, span: name, to: c.e.name, strength: cues >= 2 ? 'strong' : 'weak', cues });
        }
      }
      // the breed said otherwise
      if (h.breed && c.k.breed && breedClash(h.breed, c.k.breed)) {
        out.push({ id: c.e.id, slot: 'breed', start: h.nounAt, end: h.nounAt + h.breed.text.length, span: h.breed.text, to: c.k.breed.text, strength: h.owner ? 'strong' : 'weak', cues });
      }
    }
    return out;
  }

  /* ---------- ranks said otherwise ---------- */

  // In one paragraph's narration: a rank written before the name of one who
  // holds another of the same ladder, not told as a change
  // → [{ id, start, end, span, to }]
  function rankSlips(text, entries, idx) {
    const L = live(entries);
    const talk = talkSpans(text);
    const out = [];
    const sents = sentences(text);
    for (const m of mentions(text, idx)) {
      const e = L.find((x) => x.id === m.id);
      if (!e || e.kind !== 'person') continue;
      const own = rankOf(e);
      if (!own) continue;
      // the rank before the mention, or the one the mention's own words open with ("Constable Pryce" as an alias)
      const r = rankAt(text, m.start) || (() => { const x = rankOfName(text.slice(m.start, m.end)); return x ? { ...x, start: m.start, end: m.start + x.text.length } : null; })();
      if (!r || !rankClash(own.text, r.text)) continue;
      if (talk.some(([a, b]) => r.start < b && r.end > a)) continue;
      const s = sents.find((x) => r.start >= x.start && r.start < x.end);
      if (!s || RANK_CHANGE.test(s.text)) continue;
      const to = own.text.split(/\s+/).map((w, i) => (i === 0 || /^\p{Lu}/u.test(r.text) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
      out.push({ id: e.id, start: r.start, end: r.end, span: text.slice(r.start, r.end), to, rank: own });
    }
    return out;
  }

  return { LADDERS, rankKey, rankClash, rankAt, rankOfName, rankOf, RANK_CHANGE, SHORT, shortOf, refForms: looseRun(refForms), withForms, kindOf, ownersOf, animalSlots: looseRun(animalSlots), rankSlips: looseRun(rankSlips), givenOf, RANK_SRC };
};
