// NEO — Canon, the continuity engine (docs/semantics/ARCHITECTURE.md)
//
// Everything Canon decides, in one file with no I/O of its own: the text
// model, the quote gate, the fact vocabulary, entry files, the slip checkers
// and the engine that reads a shelf. The reader (a model, or the fake one the
// tests use) only proposes; this code decides. Loaded by main.js (require)
// and by the window (window.Canon), like i18n.js. It holds no writer-visible
// strings: it returns codes, and app.js words them with t().

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Canon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- text ---------- */

  // the same fingerprint as SNAPSHOTS in app.js (cyrb53); a test keeps them equal
  function textHash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
  }

  const FOLD = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
    '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
    '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
    '…': '...'
  };
  // Text for comparing, never for showing: curly quotes straight, dashes one
  // dash, spaces collapsed, lower case. `map[i]` is where out[i] came from in
  // the original, so a match can be cut from the writer's own text.
  function normMap(s) {
    s = String(s || '');
    let text = '';
    const map = [];
    let space = true;
    for (let i = 0; i < s.length; i++) {
      let c = FOLD[s[i]] || s[i].normalize('NFKC').toLowerCase();
      if (/^\s+$/.test(c)) {
        if (space) continue;
        c = ' ';
        space = true;
      } else space = false;
      for (const ch of c) { text += ch; map.push(i); }
    }
    if (text.endsWith(' ')) { text = text.slice(0, -1); map.pop(); }
    return { text, map };
  }
  const norm = (s) => normMap(s).text;

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] || m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
  // a paragraph's text as the page shows it: placeholder flags and tags out
  const paraText = (inner) => decode(inner
    .replace(/<span\b[^>]*\bclass="[^"]*\bph-mark\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]*>/g, ''));

  // NEO's flat <p> HTML as paragraphs of text, without a DOM: scene breaks,
  // ghosts (outline notes shown on the page) and placeholders are left out.
  // The window reads its own paragraphs the same way, so both agree.
  function sourceParas(html) {
    html = String(html || '');
    const out = [];
    const push = (text) => { if (text.trim()) out.push({ text, hash: textHash(norm(text)) }); };
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\bclass="[^"]*\b(?:scene-break|ghost)\b/.test(m[1])) continue;
      push(paraText(m[2]));
    }
    // notes typed without paragraphs: one per line
    if (!out.length) for (const line of html.split(/<\/?(?:div|br)\b[^>]*>|\n/i)) push(paraText(line));
    return out;
  }

  // Spans of speech: inside quotation marks of any style, or a line opened
  // by a dash (dialogue set the European way).
  function speechSpans(text) {
    const spans = [];
    const re = /“[^”]*(?:”|$)|"[^"]*(?:"|$)|«[^»]*(?:»|$)|„[^“”]*(?:[“”]|$)|(?<![\p{L}\p{N}])‘(?:[^’]|’(?=\p{L}))*(?:’|$)/gu;
    let m;
    while ((m = re.exec(text))) { spans.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; }
    const dash = /^\s*[—–]\s*[^—–]*/.exec(text);
    if (dash) spans.push([0, dash[0].length]);
    return spans;
  }
  const inSpans = (spans, a, b) => spans.some(([s, e]) => a >= s && b <= e);

  // Sentences with their place in the paragraph. A stop after a title or an
  // initial (Capt., J.) doesn't end one.
  const ABBREV = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|capt|col|gen|lt|sgt|prof|rev|jr|sr|vs|etc|no|\p{L})\.$/iu;
  function sentences(text) {
    const out = [];
    let start = 0;
    const push = (a, b) => {
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b > a) out.push({ text: text.slice(a, b), start: a, end: b });
    };
    const re = /[.!?…]+["'”’»)\]]*(?=\s|$)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[0][0] === '.' && m[0].length === 1 && ABBREV.test(text.slice(start, m.index + 1))) continue;
      const end = m.index + m[0].length;
      push(start, end);
      start = end;
    }
    push(start, text.length);
    return out;
  }

  const WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;
  const isLetter = (c) => !!c && /[\p{L}\p{M}\p{N}]/u.test(c);
  const TITLES = new Set(['captain', 'capt', 'lord', 'lady', 'sir', 'dame', 'king', 'queen', 'prince', 'princess', 'master', 'mistress', 'father', 'mother', 'brother', 'sister', 'mr', 'mrs', 'ms', 'dr', 'old', 'young', 'the']);
  const nameParts = (name) => String(name || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}'’-]/gu, '')).filter((w) => w.length >= 3 && !TITLES.has(w.toLowerCase()));

  // What names each entry: its name and aliases, and for a person each part
  // of the name that no other entry shares (Ilsa, Varr — not Hale, which two
  // Hales share). Longest first, so "Ilsa Varr" wins over "Ilsa".
  function mentionIndex(entries) {
    const count = new Map();
    for (const e of entries) {
      if (e.kind !== 'person') continue;
      for (const p of new Set(nameParts(e.name))) count.set(p, (count.get(p) || 0) + 1);
    }
    const full = new Set(entries.map((e) => e.name));
    const out = [];
    for (const e of entries) {
      out.push({ phrase: e.name, id: e.id, via: 'name', exact: true });
      for (const a of e.aliases || []) out.push({ phrase: a, id: e.id, via: 'alias', exact: false });
      if (e.kind === 'person') {
        for (const p of nameParts(e.name)) if (count.get(p) === 1 && !full.has(p) && p !== e.name) out.push({ phrase: p, id: e.id, via: 'part', exact: true });
      }
    }
    return out.filter((x) => x.phrase).sort((a, b) => b.phrase.length - a.phrase.length);
  }

  // Every place the text names an entry: [{ id, start, end, via }]
  function mentions(text, index) {
    const found = [];
    const low = text.toLowerCase();
    const taken = new Uint8Array(text.length);
    for (const m of index) {
      const hay = m.exact ? text : low;
      const needle = m.exact ? m.phrase : m.phrase.toLowerCase();
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
        const end = at + needle.length;
        if (isLetter(text[at - 1]) || isLetter(text[end])) continue;
        if (taken.subarray(at, end).some((x) => x)) continue;
        taken.fill(1, at, end);
        found.push({ id: m.id, start: at, end, via: m.via });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  // The quote gate: a quote counts only if it is in the source, after
  // normalising quotes, dashes and spaces, and is at most 30 words. What
  // comes back is the writer's own text, cut from the source.
  function gateQuote(quote, text) {
    const q = norm(quote).replace(/^["'\s]+|["'\s]+$/g, '');
    if (q.length < 3 || q.split(' ').length > 30) return null;
    const src = normMap(text);
    const at = src.text.indexOf(q);
    if (at === -1) return null;
    return String(text).slice(src.map[at], src.map[at + q.length - 1] + 1);
  }

  /* ---------- the fact vocabulary ---------- */

  // An entry's facts use these attributes only. `label` is how the entry file
  // writes it (English in the file, whatever the interface language), `single`
  // means one value at a time, `slips` that the MVP checks it, `ref` that its
  // value names another entry.
  const ATTRS = {
    sex: { label: 'Sex', single: true, slips: true },
    species: { label: 'Species', single: true, slips: true },
    eyes: { label: 'Eyes', single: true, slips: true },
    hair: { label: 'Hair', single: true, slips: true },
    birthplace: { label: 'Born in', single: true, slips: true, ref: true },
    sibling: { label: 'Sibling', slips: true, ref: true },
    parent: { label: 'Parent of', slips: true, ref: true },
    child: { label: 'Child of', slips: true, ref: true },
    spouse: { label: 'Married to', slips: true, ref: true },
    owner: { label: 'Owner', single: true, ref: true },
    home: { label: 'Lives in', single: true, ref: true },
    title: { label: 'Title', single: true },
    state: { label: 'State' },
    other: { label: 'Other' }
  };
  const LABEL_ATTR = { gender: 'sex', eye: 'eyes', 'eye colour': 'eyes', 'eye color': 'eyes', 'hair colour': 'hair', 'hair color': 'hair', born: 'birthplace', birthplace: 'birthplace', 'born at': 'birthplace' };
  for (const [attr, a] of Object.entries(ATTRS)) { LABEL_ATTR[attr] = attr; LABEL_ATTR[a.label.toLowerCase()] = attr; }
  const KINDS = ['person', 'creature', 'place', 'thing', 'group', 'other'];
  const STATES = ['verified', 'unverified', 'yours', 'disagree', 'set aside', 'not right'];

  // word → [sex, the word for the other sex, the species it implies]
  const SEX_WORDS = {
    mare: ['female', 'stallion', 'horse'], stallion: ['male', 'mare', 'horse'], gelding: ['male', 'mare', 'horse'],
    filly: ['female', 'colt', 'horse'], colt: ['male', 'filly', 'horse'],
    cow: ['female', 'bull', 'cattle'], bull: ['male', 'cow', 'cattle'], ewe: ['female', 'ram', 'sheep'], ram: ['male', 'ewe', 'sheep'],
    vixen: ['female', 'fox', 'fox'], hen: ['female', 'cock', 'chicken'], cock: ['male', 'hen', 'chicken'],
    woman: ['female', 'man'], man: ['male', 'woman'], girl: ['female', 'boy'], boy: ['male', 'girl'], lady: ['female', 'lord'], lord: ['male', 'lady'],
    sister: ['female', 'brother'], brother: ['male', 'sister'], daughter: ['female', 'son'], son: ['male', 'daughter'],
    mother: ['female', 'father'], father: ['male', 'mother'], wife: ['female', 'husband'], husband: ['male', 'wife'],
    queen: ['female', 'king'], king: ['male', 'queen'], aunt: ['female', 'uncle'], uncle: ['male', 'aunt'], niece: ['female', 'nephew'], nephew: ['male', 'niece']
  };
  const PRONOUNS = { she: 'female', her: 'female', hers: 'female', herself: 'female', he: 'male', him: 'male', his: 'male', himself: 'male' };
  const PRONOUN_SWAP = { he: 'she', she: 'he', him: 'her', hers: 'his', himself: 'herself', herself: 'himself', his: 'her' };
  const COLOURS = { grey: 'grey', gray: 'grey', brown: 'brown', green: 'green', blue: 'blue', black: 'black', red: 'red', fair: 'fair', blond: 'fair', blonde: 'fair', golden: 'fair', white: 'white', hazel: 'hazel', amber: 'amber' };
  const SPECIES = { horse: 'horse', pony: 'horse', mule: 'mule', donkey: 'donkey', wolf: 'wolf', dog: 'dog', hound: 'dog', cat: 'cat', hawk: 'hawk', falcon: 'falcon', raven: 'raven', crow: 'crow', ox: 'cattle', cattle: 'cattle', sheep: 'sheep', goat: 'goat', fox: 'fox', bear: 'bear', dragon: 'dragon' };
  for (const [w, [, , sp]] of Object.entries(SEX_WORDS)) if (sp) SPECIES[w] = sp;
  const KIN = { younger: 'younger', youngest: 'younger', elder: 'elder', eldest: 'elder', older: 'elder', oldest: 'elder', twin: 'twin' };
  const KIN_SWAP = { younger: 'elder', elder: 'younger' };

  const wordsOf = (s) => norm(s).split(/[^\p{L}\p{M}'-]+/u).filter(Boolean);
  const slug = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'entry';
  const attrOf = (label) => LABEL_ATTR[norm(label)] || null;
  const labelOf = (f) => (f.attr === 'other' && f.label) || ATTRS[f.attr].label;

  // A proposed or typed value in the vocabulary's terms: "mare" is
  // female (mare), "gray" is grey, "a black stallion" is a horse.
  // Null when the value isn't one the attribute can hold.
  function normaliseFact(attr, value, as) {
    const v = String(value || '').trim();
    const w = [...wordsOf(as), ...wordsOf(v)];
    if (attr === 'sex') {
      const word = w.find((x) => SEX_WORDS[x]);
      if (word) return { value: SEX_WORDS[word][0], as: word };
      return ['female', 'male'].includes(norm(v)) ? { value: norm(v), as: '' } : null;
    }
    if (attr === 'eyes' || attr === 'hair') {
      const word = w.find((x) => COLOURS[x]);
      return word ? { value: COLOURS[word], as: word === COLOURS[word] ? '' : word } : null;
    }
    if (attr === 'species') {
      const word = wordsOf(v).find((x) => SPECIES[x]) || wordsOf(as).find((x) => SPECIES[x]);
      return word ? { value: SPECIES[word], as: '' } : (v && !/\s/.test(v) ? { value: norm(v), as: '' } : null);
    }
    if (attr === 'sibling') return v ? { value: v, as: KIN[norm(as)] || w.map((x) => KIN[x]).find(Boolean) || '' } : null;
    return v ? { value: v, as: String(as || '').trim() } : null;
  }

  // a fact the writer typed ("Sex: mare"): theirs, written in Canon
  function handFact(text) {
    const m = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/.exec(String(text || ''));
    if (!m) return null;
    const attr = attrOf(m[1]) || 'other';
    const n = normaliseFact(attr, m[2], '');
    if (!n) return null;
    return { attr, label: attr === 'other' ? m[1] : undefined, value: n.value, as: n.as, state: 'yours', sources: [{ written: true }] };
  }

  const factKey = (entry, f) => ATTRS[f.attr] && ATTRS[f.attr].single ? `${entry.id}/${f.attr}` : `${entry.id}/${f.attr}/${slug(f.value)}`;

  /* ---------- entry files ---------- */

  // One Markdown file per entry (ARCHITECTURE §2.2). One line is one thing;
  // "## In my words" and all after it is the writer's and kept byte for byte.
  function newEntry(name, kind, id) {
    return { id: id || slug(name), name: String(name).trim(), kind: KINDS.includes(kind) ? kind : 'other', aliases: [], extra: [], facts: [], setAside: [], words: '' };
  }

  const FACT_LINE = /^- (.+?): (.*?)(?: \(([^()]*)\))? · (verified|unverified|yours|disagree|set aside|not right)$/;
  const SOURCE_LINE = /^ {2}- (.*?): "(.*)" \{([^{}]*)\}$/;
  function parseEntry(text) {
    text = String(text || '').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) return { error: 'unreadable' };
    const e = { ...newEntry('x', 'other'), id: '', name: '' };
    for (const line of fm[1].split('\n')) {
      const m = /^([\w-]+): ?(.*)$/.exec(line);
      if (!m) return { error: 'unreadable' };
      if (m[1] === 'id') e.id = m[2].trim();
      else if (m[1] === 'name') e.name = m[2].trim();
      else if (m[1] === 'kind') e.kind = m[2].trim();
      else if (m[1] === 'aliases') e.aliases = m[2].replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      else e.extra.push([m[1], m[2]]);
    }
    if (!e.id || !e.name) return { error: 'unreadable' };
    let rest = text.slice(fm[0].length);
    const words = /(?:^|\n)## In my words\n/.exec(rest);
    if (words) { e.words = rest.slice(words.index + words[0].length); rest = rest.slice(0, words.index); }
    let list = null;
    for (const line of rest.split('\n')) {
      if (!line.trim() || /^# /.test(line)) continue;
      if (line === '## Facts') { list = e.facts; continue; }
      if (line === '## Set aside') { list = e.setAside; continue; }
      const f = FACT_LINE.exec(line);
      if (f && list) {
        const attr = attrOf(f[1]) || 'other';
        list.push({ attr, label: attr === 'other' ? f[1] : undefined, value: f[2], as: f[3] || '', state: f[4], sources: [] });
        continue;
      }
      const last = list && list[list.length - 1];
      if (last && line === '  - Written in Canon') { last.sources.push({ written: true }); continue; }
      const s = SOURCE_LINE.exec(line);
      if (!s || !last) return { error: 'unreadable' };
      const src = { label: s[1], quote: s[2] };
      for (const part of s[3].split(',').map((x) => x.trim())) {
        const [k, ...v] = part.split(':');
        if (k === 'book' || k === 'ch') src[k] = v.join(':');
        else if (k === 'said') src.said = v.length ? v.join(':') : true;
        else if (k === 'plan' || k === 'changed') src[k] = true;
      }
      last.sources.push(src);
    }
    return e;
  }

  function serialiseEntry(e) {
    const factLines = (facts) => facts.flatMap((f) => [
      `- ${labelOf(f)}: ${f.value}${f.as ? ` (${f.as})` : ''} · ${f.state}`,
      ...f.sources.map((s) => s.written ? '  - Written in Canon'
        : `  - ${s.label}: "${s.quote}" {book:${s.book}, ch:${s.ch}${s.said ? (s.said === true ? ', said' : `, said:${s.said}`) : ''}${s.plan ? ', plan' : ''}${s.changed ? ', changed' : ''}}`)
    ]);
    const lines = ['---', `id: ${e.id}`, `name: ${e.name}`, `kind: ${e.kind}`, `aliases: [${e.aliases.join(', ')}]`,
      ...e.extra.map(([k, v]) => `${k}: ${v}`), '---', `# ${e.name}`, '', '## Facts', ...factLines(e.facts)];
    if (e.setAside.length) lines.push('', '## Set aside', ...factLines(e.setAside));
    lines.push('', '## In my words');
    return lines.join('\n') + '\n' + (e.words || '');
  }

  // The writer's own moves on an entry, shared by the tab and the tests.
  // "That's right" makes a fact theirs; Set Aside and Not right move it to
  // the entry's Set aside (nothing is deleted); Restore brings it back theirs.
  function confirmFact(e, i) {
    const f = e.facts[i];
    f.state = 'yours';
    for (const s of f.sources) delete s.changed;
    // the other values it disagreed with step aside
    for (const o of e.facts.filter((x) => x !== f && x.attr === f.attr && x.state === 'disagree' && ATTRS[f.attr].single)) setAsideFact(e, e.facts.indexOf(o), false);
  }
  function setAsideFact(e, i, notRight) {
    const [f] = e.facts.splice(i, 1);
    f.state = notRight ? 'not right' : 'set aside';
    e.setAside.push(f);
  }
  function restoreFact(e, i) {
    const [f] = e.setAside.splice(i, 1);
    f.state = 'yours';
    e.facts.push(f);
  }

  return {
    textHash, norm, normMap, decode, sourceParas, speechSpans, sentences, mentionIndex, mentions, gateQuote,
    inSpans, nameParts, WORD,
    ATTRS, KINDS, STATES, SEX_WORDS, PRONOUNS, PRONOUN_SWAP, KIN_SWAP, COLOURS, SPECIES, KIN, slug, attrOf, labelOf, normaliseFact, handFact, factKey,
    newEntry, parseEntry, serialiseEntry, confirmFact, setAsideFact, restoreFact
  };
});
