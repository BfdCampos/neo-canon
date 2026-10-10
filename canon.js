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
    const m = /^\s*([^:]+?)\s*:\s*(.+?)(?:\s*\(([^()]*)\))?\s*$/.exec(String(text || ''));
    if (!m) return null;
    const attr = attrOf(m[1]) || 'other';
    const n = normaliseFact(attr, m[2], m[3]);
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
    // the other values (checked or not) step aside
    for (const o of e.facts.filter((x) => x !== f && x.attr === f.attr && x.state !== 'yours' && norm(x.value) !== norm(f.value) && ATTRS[f.attr] && ATTRS[f.attr].single)) setAsideFact(e, e.facts.indexOf(o), false);
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

  /* ---------- slips ---------- */

  // A fact may raise a slip when the writer wrote or confirmed it, or it was
  // checked against a passage that is still there, isn't speech and isn't a
  // plan, in a source that isn't left out of Canon.
  function firmFact(f, out) {
    if (!ATTRS[f.attr] || !ATTRS[f.attr].slips || !['verified', 'yours'].includes(f.state)) return false;
    return f.state === 'yours' || f.sources.some((s) => !s.written && !s.said && !s.plan && !s.changed && !((out || {})[s.book] || []).includes(s.ch));
  }
  // each entry's firm facts by attribute (the writer's win), relations listed
  function worldOf(entries, out) {
    const world = new Map();
    for (const e of entries) {
      const k = { e, rel: [] };
      for (const f of e.facts) {
        if (!firmFact(f, out)) continue;
        if (!ATTRS[f.attr].single) k.rel.push(f);
        else if (!k[f.attr] || f.state === 'yours') k[f.attr] = f;
      }
      world.set(e.id, k);
    }
    return world;
  }

  const keepCase = (like, w) => /^\p{Lu}/u.test(like) ? w[0].toUpperCase() + w.slice(1) : w;
  // after "her", a word it can own ("her ears"), not one that ends a phrase ("let her go")
  const NOT_OWNED = new Set(['and', 'or', 'but', 'nor', 'so', 'yet', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'of', 'off', 'up', 'down', 'out', 'over', 'into', 'onto', 'away', 'back', 'again', 'there', 'here', 'then', 'that', 'this', 'the', 'a', 'an', 'as', 'if', 'when', 'while', 'go', 'be', 'have', 'had', 'was', 'is', 'say', 'said', 'know', 'see', 'too', 'once', 'alone', 'home']);
  function pronounAt(words, i, text) {
    const w = words[i];
    if (w.lw !== 'her') return PRONOUNS[w.lw] ? w.lw : null;
    const next = words[i + 1];
    const owns = next && /^\s+$/.test(text.slice(w.end, next.start)) && !NOT_OWNED.has(next.lw);
    return owns ? 'her' : 'her-obj';
  }
  // the word for the other sex: his → her, her (owning) → his, her → him
  const swapPronoun = (word, kind) => keepCase(word, kind === 'her' ? 'his' : kind === 'her-obj' ? 'him' : PRONOUN_SWAP[word.toLowerCase()]);
  const OWNING = new Set(['his', 'her', 'himself', 'herself']);
  const CLAUSE = new Set(['and', 'but', 'or', 'while', 'as', 'when', 'until', 'because', 'though', 'who', 'whom', 'whose', 'which', 'that']);
  const COPULA = new Set(['were', 'was', 'are', 'is', 'looked', 'seemed', 'went', 'turned', 'had', 'gone']);
  const KIN_WORD_SWAP = { younger: 'elder', elder: 'younger', older: 'younger', youngest: 'eldest', eldest: 'youngest', oldest: 'youngest' };

  // optimal string alignment distance (one swap of neighbours counts as one)
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  // Candidate slips in one paragraph. Strong ones stand on their own; weak
  // ones are kept only if the reader agrees the word means that entry.
  // Each: { kind, strength, id, attr, fact, start, end, to, si }.
  function paraCandidates(text, idx, world, names) {
    const speech = speechSpans(text);
    const free = (a, b) => !speech.some(([s, e]) => a < e && b > s);
    const all = mentions(text, idx).filter((m) => free(m.start, m.end));
    const sents = sentences(text);
    const out = [];
    const sexed = (m) => world.get(m.id) && world.get(m.id).sex;
    sents.forEach((s, si) => {
      const inS = all.filter((m) => m.start >= s.start && m.end <= s.end);
      const words = [];
      for (const m of s.text.matchAll(WORD)) {
        const start = s.start + m.index;
        words.push({ w: m[0], lw: m[0].toLowerCase().replace(/['’]s$/, ''), start, end: start + m[0].length });
      }
      const add = (c) => { if (free(c.start, c.end)) out.push({ ...c, si }); };
      const after = (pos) => words.findIndex((w) => w.start >= pos);
      const named = (w) => inS.some((m) => m.start < w.end && m.end > w.start);

      for (const m of inS) {
        const k = world.get(m.id);
        // E … his: the nearest owning pronoun after a sexed entry, in its clause
        if (k.sex) {
          for (let i = after(m.end), n = 0, from = m.end; i >= 0 && i < words.length && n < 6; i++, n++) {
            const w = words[i];
            if (/[,;:—–()"“”]/.test(text.slice(from, w.start)) || named(w) || (/^\p{Lu}/u.test(w.w) && w.w !== 'I')) break;
            from = w.end;
            if (CLAUSE.has(w.lw)) break;
            const kind = pronounAt(words, i, text);
            if (!kind) continue;
            if (OWNING.has(kind) && PRONOUNS[w.lw] !== k.sex.value) add({ kind: 'pronoun', strength: 'strong', id: m.id, attr: 'sex', fact: k.sex, start: w.start, end: w.end, to: swapPronoun(w.w, kind) });
            break;
          }
        }
        // E, the grey mare: an appositive naming its sex or species
        const j = after(m.end);
        if (j >= 0 && /^,\s+$/.test(text.slice(m.end, words[j].start)) && ['the', 'a', 'an'].includes(words[j].lw)) {
          const noun = words.slice(j + 1, j + 4).find((w) => SEX_WORDS[w.lw] || SPECIES[w.lw]);
          if (noun) {
            const sw = SEX_WORDS[noun.lw];
            if (sw && k.sex && sw[0] !== k.sex.value) add({ kind: 'noun', strength: 'strong', id: m.id, attr: 'sex', fact: k.sex, start: noun.start, end: noun.end, to: keepCase(noun.w, sw[1]) });
            else if (SPECIES[noun.lw] && k.species && SPECIES[noun.lw] !== k.species.value) add({ kind: 'species', strength: 'strong', id: m.id, attr: 'species', fact: k.species, start: noun.start, end: noun.end, to: keepCase(noun.w, k.species.value) });
          }
        }
        // Tamsin, the elder: a kin word against the sibling fact (weak)
        for (const f of k.rel.filter((x) => x.attr === 'sibling' && KIN_SWAP[x.as])) {
          for (let i = after(m.end), n = 0; i >= 0 && i < words.length && n < 6; i++, n++) {
            const w = words[i];
            const o = inS.find((x) => x.start < w.end && x.end > w.start);
            if (o && o.id !== m.id) break;
            if (KIN[w.lw] && KIN_SWAP[KIN[w.lw]] && KIN[w.lw] !== f.as) {
              add({ kind: 'kin', strength: 'weak', id: m.id, attr: 'sibling', fact: f, start: w.start, end: w.end, to: keepCase(w.w, KIN_WORD_SWAP[w.lw]) });
              break;
            }
          }
        }
      }

      // He, opening a sentence after one that names one sexed entry (weak)
      const first = words[0];
      if (first && ['he', 'she', 'his', 'her'].includes(first.lw) && si > 0) {
        const prev = [...new Set(all.filter((m) => m.start >= sents[si - 1].start && m.end <= sents[si - 1].end && sexed(m)).map((m) => m.id))];
        const k = prev.length === 1 && world.get(prev[0]);
        if (k && PRONOUNS[first.lw] !== k.sex.value) add({ kind: 'pronoun', strength: 'weak', id: k.e.id, attr: 'sex', fact: k.sex, start: first.start, end: first.end, to: swapPronoun(first.w, pronounAt(words, 0, text)) });
      }

      words.forEach((w, i) => {
        // the stallion, when the horse in the last few sentences is a mare (weak)
        const sw = SEX_WORDS[w.lw];
        if (sw && sw[2] && i > 0 && words[i - 1].lw === 'the' && !inS.some((m) => world.get(m.id).species && world.get(m.id).species.value === sw[2])) {
          const seen = all.filter((m) => m.start >= sents[Math.max(0, si - 3)].start && m.end <= w.start && world.get(m.id).species && world.get(m.id).species.value === sw[2]);
          const last = seen.length && world.get(seen[seen.length - 1].id);
          if (last && last.sex && last.sex.value !== sw[0] && !seen.some((m) => world.get(m.id).sex && world.get(m.id).sex.value === sw[0])) {
            add({ kind: 'noun', strength: 'weak', id: last.e.id, attr: 'sex', fact: last.sex, start: w.start, end: w.end, to: keepCase(w.w, last.sex.as && SEX_WORDS[last.sex.as] && SEX_WORDS[last.sex.as][2] === sw[2] ? last.sex.as : sw[1]) });
          }
        }
        // brown eyes / eyes were brown, of the one entry the sentence names
        if (['eyes', 'eye', 'hair'].includes(w.lw)) {
          const attr = w.lw === 'hair' ? 'hair' : 'eyes';
          const ids = [...new Set(inS.map((m) => m.id))];
          const owner = inS.find((m) => /^['’]s\s/.test(text.slice(m.end, m.end + 3)) && after(m.end + 2) >= i - 1 && after(m.end + 2) <= i) || (ids.length === 1 && inS[0].end <= w.start && inS[0]);
          const k = owner && world.get(owner.id);
          let c = i > 0 && COLOURS[words[i - 1].lw] && /^[\s-]+$/.test(text.slice(words[i - 1].end, w.start)) ? words[i - 1] : null;
          if (!c && words[i + 1] && COPULA.has(words[i + 1].lw)) c = words.slice(i + 2, i + 5).find((x) => COLOURS[x.lw]);
          if (k && k[attr] && c && COLOURS[c.lw] !== k[attr].value) add({ kind: 'colour', strength: 'strong', id: owner.id, attr, fact: k[attr], start: c.start, end: c.end, to: keepCase(c.w, k[attr].as || k[attr].value) });
        }
        // born in a place that isn't the one in Canon
        if (w.lw === 'born' && words[i + 1] && ['in', 'at'].includes(words[i + 1].lw)) {
          const place = inS.find((m) => m.start >= words[i + 1].end && /^\s+$/.test(text.slice(words[i + 1].end, m.start)));
          const people = [...new Set(inS.filter((m) => m !== place && world.get(m.id).e.kind === 'person').map((m) => m.id))];
          const k = people.length === 1 && world.get(people[0]);
          if (place && k && k.birthplace && norm(k.birthplace.value) !== norm(world.get(place.id).e.name)) {
            add({ kind: 'birthplace', strength: 'strong', id: k.e.id, attr: 'birthplace', fact: k.birthplace, start: place.start, end: place.end, to: k.birthplace.value });
          }
        }
        // Corwyck for Corwick: a capitalised word a letter away from a name
        if (/^\p{Lu}/u.test(w.w) && !named(w)) {
          const bare = w.w.replace(/['’]s$/, '');
          if (bare.length >= 5 && !names.some(([n]) => n === bare.toLowerCase())) {
            const near = names.filter(([n]) => editDistance(bare.toLowerCase(), n) <= (n.length >= 8 ? 2 : 1));
            const targets = [...new Set(near.map(([, id]) => id))];
            if (targets.length === 1) out.push({ kind: 'name', strength: 'strong', id: targets[0], attr: 'name', fact: null, start: w.start, end: w.start + bare.length, to: near[0][2], si, word: bare });
          }
        }
      });
    });
    return out;
  }

  // every capitalised name part of five letters or more: [lower case, entry id, as written]
  const nameTokens = (entries) => entries.flatMap((e) => [e.name, ...(e.aliases || [])].flatMap((x) => x.split(/\s+/))
    .map((p) => p.replace(/[^\p{L}\p{M}'’-]/gu, '')).filter((w) => w.length >= 5 && /^\p{Lu}/u.test(w)).map((w) => [w.toLowerCase(), e.id, w]));

  // The Continuity Pass over some sources: [{ bookId, chId, label, html }].
  // `knownWords(words)` asks the spelling dictionary; `reader` (or null)
  // confirms the weak candidates; `notSlips` are the writer's dismissals.
  async function checkSources({ sources, entries, notSlips = [], reader = null, knownWords = null, out = {}, onSource = null, stop = null, paraOk = null }) {
    const idx = mentionIndex(entries);
    const world = worldOf(entries, out);
    const names = nameTokens(entries);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const dismissed = new Set(notSlips.map((n) => n.fact + '|' + n.sentence));
    const facts = [...world.values()].reduce((n, k) => n + k.rel.length + Object.keys(ATTRS).filter((a) => k[a]).length, 0);
    const all = [];
    let n = 0;
    for (const src of sources) {
      if (stop && stop()) break;
      const slips = [];
      const found = [];
      for (const p of sourceParas(src.html)) {
        if (paraOk && !paraOk(src, p)) continue;
        const sents = sentences(p.text);
        for (const c of paraCandidates(p.text, idx, world, names)) found.push({ c, p, s: sents[c.si] });
      }
      // a word the dictionary knows (Corwyn, Bramblee are not words; "Brambles" is) is no slip of the pen
      const odd = [...new Set(found.filter((x) => x.c.kind === 'name').map((x) => x.c.word))];
      const known = odd.length && knownWords ? await knownWords(odd) : {};
      for (const { c, p, s } of found) {
        if (c.kind === 'name' && (!knownWords || known[c.word] !== false)) continue;
        const e = byId.get(c.id);
        const key = c.fact ? factKey(e, c.fact) : `${e.id}/name`;
        const sentenceHash = textHash(norm(s.text));
        if (dismissed.has(key + '|' + sentenceHash)) continue;
        const span = p.text.slice(c.start, c.end);
        if (c.strength === 'weak') {
          if (!reader) continue;
          if (await reader.refers({ sentence: s.text, span, entity: e.name, paragraph: p.text }) !== 'yes') continue;
        }
        const srcs = c.fact ? c.fact.sources.filter((x) => !x.written) : [];
        slips.push({
          seq: all.length + slips.length, bookId: src.bookId, chId: src.chId, label: src.label, para: p.hash, sentence: s.text, sentenceHash, at: c.start, span, to: c.to || null,
          kind: c.kind, strength: c.strength, entry: e.id, name: e.name, attr: c.attr, value: c.fact ? c.fact.value : e.name, as: c.fact ? c.fact.as : '',
          fact: key, sources: srcs.slice(0, 2).map((x) => ({ label: x.label, quote: x.quote })), more: Math.max(0, srcs.length - 2),
          written: !!(c.fact && c.fact.sources.some((x) => x.written))
        });
      }
      all.push(...slips);
      if (onSource) onSource(src, slips, ++n, sources.length);
    }
    return { slips: all, facts };
  }

  /* ---------- reading ---------- */

  // Bumped when the prompts change, so cached proposals are asked again
  const PROMPT = 1;
  const STOP = new Set(['the', 'and', 'his', 'her', 'its', 'their', 'with', 'from', 'that', 'this', 'was', 'were', 'had', 'has', 'for', 'into', 'onto', 'by']);
  const CUE = new Set([...Object.keys(SEX_WORDS), ...Object.keys(COLOURS), ...Object.keys(SPECIES), ...Object.keys(KIN), 'born', 'eyes', 'hair']);
  const stripTitles = (name) => String(name || '').trim().split(/\s+/).filter((w, i, all) => i === all.length - 1 || !TITLES.has(w.toLowerCase().replace(/\.$/, ''))).join(' ');
  const hasWord = (hay, needle) => !!needle && new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(hay);

  // Only a paragraph with something to say about the world goes to the
  // reader: a name, a capitalised word mid-sentence, or a trait or kin word.
  // (A model call is tens of seconds on a laptop's CPU: §8 cut 1.)
  function cueful(text, idx) {
    if (mentions(text, idx).length) return true;
    if (wordsOf(text).some((w) => CUE.has(w.replace(/'s$/, '')))) return true;
    return /[^.!?"“‘\s]\s+\p{Lu}\p{Ll}/u.test(text);
  }

  // the entry a proposed name means: its name or an alias, or a part of a
  // person's name no one else has
  function findEntry(entries, name) {
    const n = norm(stripTitles(name));
    if (!n) return null;
    const whole = entries.find((e) => norm(e.name) === n || e.aliases.some((a) => norm(a) === n));
    if (whole) return whole;
    const parts = entries.filter((e) => e.kind === 'person' && nameParts(e.name).some((p) => norm(p) === n));
    return parts.length === 1 ? parts[0] : null;
  }
  // the entity is named in the quote or its paragraph
  function reaches(entries, name, quote, text) {
    const e = findEntry(entries, name);
    const names = [stripTitles(name), ...nameParts(name), ...(e ? [e.name, ...e.aliases, ...nameParts(e.name)] : [])].map(norm);
    return names.some((x) => hasWord(norm(quote), x) || hasWord(norm(text), x));
  }
  // the value is in the quote itself, or a word the lexicon ties to it
  function valueInQuote(f, quote) {
    const w = new Set(wordsOf(quote).map((x) => x.replace(/'s$/, '')));
    const any = (test) => [...w].some(test);
    if (f.attr === 'sex') return any((x) => (SEX_WORDS[x] && SEX_WORDS[x][0] === f.value) || PRONOUNS[x] === f.value);
    // a colour counts for eyes or hair only beside the word (grey eyes, grey-eyed), not a grey coat
    if (f.attr === 'eyes' || f.attr === 'hair') return any((x) => COLOURS[x] === f.value) && any((x) => (f.attr === 'eyes' ? /^eye[sd]?$|-eyed$/ : /^hair(ed)?$|-haired$/).test(x));
    if (f.attr === 'species') return any((x) => SPECIES[x] === f.value);
    if (f.attr === 'sibling' && f.as && !any((x) => KIN[x] === f.as)) return false;
    // who or where: a name, as the quote writes it ("Saltmere", not "the town")
    if (ATTRS[f.attr].ref && !/^\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*)*$/u.test(f.value)) return false;
    const parts = ATTRS[f.attr].ref ? nameParts(f.value).map(norm) : wordsOf(f.value).filter((x) => x.length >= 3 && !STOP.has(x));
    return parts.length > 0 && parts.some((x) => w.has(x));
  }
  // where a quote sits in its paragraph: in speech, and in a question or a maybe
  function quoteIn(quote, text) {
    const src = normMap(text);
    const at = src.text.indexOf(norm(quote));
    if (at < 0) return { said: false, plan: /\?|\b(?:what if|maybe|perhaps)\b/i.test(quote) };
    const a = src.map[at];
    const b = src.map[at + norm(quote).length - 1] + 1;
    const sent = sentences(text).filter((s) => s.end > a && s.start < b).map((s) => s.text).join(' ');
    return { said: speechSpans(text).some(([s, e]) => a >= s && b <= e + 1), plan: /\?|\b(?:what if|maybe|perhaps)\b/i.test(sent) };
  }

  // One proposal through the gates, into its entry. Every way it can fail
  // drops it: a quote not in the source (P0 #7), an entity not named in it,
  // its paragraph or the one before (which the reader saw too), a value the
  // quote doesn't hold, a value the writer already said is not right.
  function accept(entries, prop, src, para, prev, full) {
    // an entry is someone or something with a name: "the drover" is not one
    if (!prop || !prop.entity || !prop.quote || !/^\p{Lu}/u.test(stripTitles(prop.entity))) return;
    const quote = gateQuote(prop.quote, full);
    if (!quote || !reaches(entries, prop.entity, quote, prev + '\n' + para.text)) return;
    let e = findEntry(entries, prop.entity);
    if (!e) {
      const name = stripTitles(prop.entity);
      let id = slug(name);
      for (let n = 2; entries.some((x) => x.id === id); n++) id = slug(name) + '-' + n;
      e = newEntry(name, prop.kind, id);
      entries.push(e);
    }
    if (!prop.attr || !ATTRS[prop.attr]) return;
    const n = normaliseFact(prop.attr, prop.value, prop.asWritten);
    if (!n) return;
    const ref = ATTRS[prop.attr].ref && findEntry(entries, n.value);
    const f = { attr: prop.attr, label: prop.attr === 'other' ? prop.label || 'Other' : undefined, value: ref ? ref.name : n.value, as: n.as, state: 'unverified', sources: [] };
    if (!valueInQuote(f, quote)) return;
    const where = quoteIn(quote, para.text);
    const source = { label: `${src.book}, ${src.label}`, quote, book: src.bookId, ch: src.chId };
    if (where.said) source.said = prop.said || true;
    if (where.plan) source.plan = true;
    const same = (a, b) => a.attr === b.attr && norm(a.value) === norm(b.value) && (a.attr !== 'other' || a.label === b.label);
    if (e.setAside.some((x) => x.state === 'not right' && same(x, f) && x.sources.some((s) => norm(s.quote) === norm(quote)))) return;
    const had = e.facts.find((x) => same(x, f));
    if (!had) { f.sources.push(source); e.facts.push(f); return; }
    if (!had.as && f.as) had.as = f.as;
    // the same passage twice (a whole sentence and a piece of it) is one source
    if (!had.sources.some((s) => s.book === source.book && s.ch === source.ch && (norm(s.quote).includes(norm(quote)) || norm(quote).includes(norm(s.quote))))) had.sources.push(source);
  }

  const live = (s) => !s.written && !s.changed;
  const solid = (f) => f.state === 'yours' || f.sources.some((s) => live(s) && !s.said && !s.plan);

  // Checking by rule: the quote names the entity and holds a closed-lexicon
  // word for the value, and isn't speech or a plan (§8 cut 2). The rest is
  // asked of the reader, the same way, one fact at a time.
  function ruleSupported(e, f, idx) {
    return f.sources.some((s) => {
      if (!live(s) || s.said || s.plan || !mentions(s.quote, idx).some((m) => m.id === e.id)) return false;
      const w = wordsOf(s.quote).map((x) => x.replace(/'s$/, ''));
      if (f.attr === 'sex') return w.some((x) => SEX_WORDS[x] && SEX_WORDS[x][0] === f.value);
      if (f.attr === 'eyes' || f.attr === 'hair') return w.some((x) => COLOURS[x] === f.value);
      if (f.attr === 'species') return w.some((x) => SPECIES[x] === f.value);
      if (f.attr === 'sibling') return w.some((x) => KIN[x] === f.as) && nameParts(f.value).some((p) => w.includes(norm(p)));
      return false;
    });
  }

  /* ---------- the engine ---------- */

  // The pipelines over one Canon. `io` is the only way to the files (main.js
  // gives one over the library; the tests one over a folder):
  //   sources() → [{ bookId, chId, book, label, html, notes? }] in reading order
  //   meta() / saveMeta(m), entries() → [{ id, text }] / saveEntry(id, text),
  //   notSlips(), cache() / saveCache(c) (this device only), knownWords(words)
  function createEngine({ io, reader = null }) {
    const loadEntries = async () => (await io.entries()).map((x) => parseEntry(x.text)).filter((e) => !e.error);
    return {
      // the Continuity Pass: one book's chapters (or the shelf's), with the
      // window's unsaved text standing in for the files (`html` by chapter)
      // A quiet check (`chId`) is one chapter, without the paragraph being
      // written (`skip`, its text) and those already checked (`done`, hashes).
      async check({ bookId, scope = 'book', chId = null, skip = null, done = null, html = {}, onSource = null, stop = null }) {
        const meta = await io.meta();
        const out = meta.out || {};
        const sources = (await io.sources())
          .filter((s) => !s.notes && (scope === 'shelf' || s.bookId === bookId) && (!chId || s.chId === chId) && !(out[s.bookId] || []).includes(s.chId))
          .map((s) => s.bookId === bookId && typeof html[s.chId] === 'string' ? { ...s, html: html[s.chId] } : s);
        const skipped = skip ? norm(skip) : null;
        const paraOk = skip || done ? (src, p) => !(done && done.has(p.hash)) && norm(p.text) !== skipped : null;
        return checkSources({ sources, entries: await loadEntries(), notSlips: await io.notSlips(), reader, knownWords: io.knownWords, out, onSource, stop, paraOk });
      },

      // Read the Shelf, and every read after it: only sources whose text
      // changed since canon.json last saw them (`again` reads everything),
      // only paragraphs with cues, and a proposal is asked once per paragraph
      // and the one before it (the cache). The writer's facts are never touched.
      async readShelf({ again = false, only = null, onProgress = null, stop = null } = {}) {
        const meta = await io.meta();
        const metaWas = JSON.stringify(meta);
        meta.read = meta.read || {};
        const out = meta.out || {};
        const old = (!again && (await io.cache())) || {};
        const cache = old.reader === reader.id && old.prompt === PROMPT ? old : { v: 1, reader: reader.id, prompt: PROMPT, proposals: {}, judged: {} };
        const cacheWas = JSON.stringify(cache);
        const files = await io.entries();
        const entries = [];
        const before = new Map();
        for (const x of files) {
          const e = parseEntry(x.text);
          if (e.error) continue; // a file Canon can't read is left as it is
          entries.push(e);
          before.set(e.id, serialiseEntry(e));
        }
        const taken = new Set(files.map((x) => x.id));
        const sources = (await io.sources()).filter((s) => !(out[s.bookId] || []).includes(s.chId));
        const texts = new Map();
        // what there is to read: changed sources (or `only` the one), and in
        // them the paragraphs with cues the cache has no answer for
        const ctxKey = (paras, j) => textHash([reader.id, PROMPT, j ? paras[j - 1].text : '', paras[j].text].join('\n'));
        const todo = [];
        let left = 0;
        for (const src of sources) {
          const key = src.bookId + '/' + src.chId;
          const paras = sourceParas(src.html);
          texts.set(key, paras.map((p) => p.text).join('\n'));
          if ((only && key !== only) || (!again && meta.read[key] === textHash(src.html))) continue;
          todo.push({ src, key, paras });
          const idx = mentionIndex(entries);
          left += paras.filter((p, j) => cueful(p.text, idx) && !cache.proposals[ctxKey(paras, j)]).length;
        }
        let calls = 0;
        let spent = 0;
        let stopped = false;
        const tell = (src, n) => onProgress && onProgress({ phase: 'read', book: src.book, label: src.label, n, of: todo.length, calls, left: Math.max(0, left - calls), ms: calls ? Math.round(spent / calls) : 0 });
        for (const [n, { src, key, paras }] of todo.entries()) {
          if (stop && stop()) { stopped = true; break; }
          tell(src, n + 1);
          for (let j = 0; j < paras.length && !stopped; j++) {
            const p = paras[j];
            const idx = mentionIndex(entries);
            if (!cueful(p.text, idx)) continue;
            const prev = j ? paras[j - 1].text : '';
            const ck = ctxKey(paras, j);
            let props = cache.proposals[ck];
            if (!props) {
              const near = new Set(mentions(prev + '\n' + p.text, idx).map((m) => m.id));
              const t0 = Date.now();
              try {
                props = await reader.propose({ text: p.text, before: prev, known: entries.filter((e) => near.has(e.id)).map((e) => ({ name: e.name, kind: e.kind, aliases: e.aliases })) });
              } catch (err) {
                if (stop && stop()) { stopped = true; break; } // what was read so far is kept; this source is read again next time
                throw err;
              }
              spent += Date.now() - t0;
              calls++;
              cache.proposals[ck] = props;
              tell(src, n + 1);
            }
            for (const prop of props || []) accept(entries, prop, src, p, prev, texts.get(key));
          }
          if (!stopped) meta.read[key] = textHash(src.html);
        }
        // a new entry never takes the name of a file Canon couldn't read
        for (const e of entries) if (!before.has(e.id) && taken.has(e.id)) e.id += '-' + entries.length;

        // passages edited away, values that disagree, then checking
        const idx = mentionIndex(entries);
        const order = new Map(sources.map((s, i) => [s.bookId + '/' + s.chId, i]));
        const firstAt = (f) => Math.min(Infinity, ...f.sources.filter((s) => !s.written).map((s) => order.has(s.book + '/' + s.ch) ? order.get(s.book + '/' + s.ch) : Infinity));
        const paraOf = (s) => (texts.get(s.book + '/' + s.ch) || '').split('\n').find((t) => norm(t).includes(norm(s.quote))) || s.quote;
        for (const e of entries) {
          for (const f of e.facts) {
            for (const s of f.sources) {
              if (s.written || !texts.has(s.book + '/' + s.ch)) continue;
              if (gateQuote(s.quote, texts.get(s.book + '/' + s.ch))) delete s.changed;
              else s.changed = true;
            }
            if (f.state === 'verified' && !f.sources.some(live)) f.state = 'unverified';
          }
          for (const attr of Object.keys(ATTRS).filter((a) => ATTRS[a].single)) {
            const these = e.facts.filter((f) => f.attr === attr && solid(f));
            const split = new Set(these.map((f) => norm(f.value))).size > 1;
            // A value read against one already established (the writer's,
            // or checked) doesn't unsettle it: the established fact keeps
            // raising its slips, and the newcomer waits in Needs You. With
            // nothing established yet, the value said first in reading order
            // goes on to checking and the later ones wait.
            const firm = these.filter((f) => f.state === 'yours').length ? these.filter((f) => f.state === 'yours') : these.filter((f) => f.state === 'verified');
            const keep = !split ? null
              : firm.length ? (new Set(firm.map((f) => norm(f.value))).size === 1 || firm[0].state === 'yours' ? norm(firm[0].value) : null)
                : norm(these.reduce((a, b) => (firstAt(b) < firstAt(a) ? b : a)).value);
            for (const f of e.facts.filter((x) => x.attr === attr && x.state !== 'yours')) {
              if (split && these.includes(f) && norm(f.value) !== keep) f.state = 'disagree';
              else if (f.state === 'disagree') f.state = 'unverified';
            }
          }
        }
        // checking: by rule where the quote says it outright, else the reader
        const check = [];
        for (const e of entries) {
          for (const f of e.facts) {
            if (f.state !== 'unverified' || !solid(f)) continue; // speech and plans stay unchecked
            if (ruleSupported(e, f, idx)) { f.state = 'verified'; continue; }
            const s = f.sources.find((x) => live(x) && !x.said && !x.plan);
            check.push({ e, f, s, jk: factKey(e, f) + '|' + textHash(norm(s.quote)) });
          }
        }
        const toJudge = check.filter((x) => !cache.judged[x.jk]).length;
        let judging = 0;
        for (const { e, f, s, jk } of check) {
          if (!cache.judged[jk]) {
            if (stopped || (stop && stop())) { stopped = true; continue; }
            if (onProgress) onProgress({ phase: 'check', n: ++judging, of: toJudge, facts: check.length });
            try {
              cache.judged[jk] = await reader.judge({ claim: { entity: e.name, attr: f.attr, value: f.value, as: f.as }, quote: s.quote, paragraph: paraOf(s) });
            } catch (err) {
              if (stop && stop()) { stopped = true; continue; }
              throw err;
            }
          }
          if (cache.judged[jk] === 'yes') f.state = 'verified';
        }

        // written only where something changed: an idle read writes nothing
        let written = 0;
        for (const e of entries) {
          const text = serialiseEntry(e);
          if (before.get(e.id) !== text) { await io.saveEntry(e.id, text); written++; }
        }
        if (JSON.stringify(meta) !== metaWas) await io.saveMeta(meta);
        if (JSON.stringify(cache) !== cacheWas) await io.saveCache(cache);
        const facts = entries.flatMap((e) => e.facts);
        return {
          entries: entries.length, facts: facts.length, written, calls, stopped,
          verified: facts.filter((f) => f.state === 'verified' || f.state === 'yours').length,
          needs: facts.filter((f) => f.state === 'unverified' || f.state === 'disagree').length
        };
      }
    };
  }

  /* ---------- readers ---------- */

  // The reader the tests use: answers from a file (scripts/fixtures/canon/
  // reader-answers.json). propose matches a paragraph by its first words.
  function fakeReader(answers) {
    const starts = (text, key) => norm(text).startsWith(norm(key));
    return {
      id: 'fake',
      calls: 0,
      async propose({ text }) {
        this.calls++;
        const hit = (answers.propose || []).find((x) => starts(text, x.para));
        return hit ? hit.facts.map((f) => ({ ...f, note: undefined })) : [];
      },
      async judge({ claim }) { return (answers.judge || {})[norm([claim.entity, claim.attr, claim.value].join('|'))] || 'unclear'; },
      async refers({ sentence, span, entity }) {
        const hit = (answers.refers || []).find((r) => starts(sentence, r.sentence) && r.span === span && norm(r.entity) === norm(entity));
        return hit ? hit.answer : 'no';
      },
      async pick() { return null; },
      abort() {}
    };
  }

  // The reader on this computer: the prompts and answer shapes for a small
  // model, sent through `ask` (main.js → canon-worker.js). Small models do
  // best with one paragraph, a closed list of attributes and a compact
  // answer, so that is what they get; the gates above do the rest.
  const ASK_KINDS = ['person', 'creature', 'place', 'thing', 'group'];
  const ASK_ATTRS = ['sex', 'species', 'eyes', 'hair', 'born', 'sibling', 'parent', 'child', 'spouse', 'owner', 'home'];
  const PROPOSE_SYSTEM = [
    'You find facts about the characters, animals and places named in one paragraph of a novel.',
    'Report a fact only if the paragraph states it plainly about someone or something named in it.',
    'Attributes (a): sex (the word used: mare, stallion, woman, sister; or female, male), species (horse, wolf, human), eyes (colour), hair (colour), born (place of birth), sibling, parent, child, spouse (another named character), owner (who owns an animal or thing), home (where they live).',
    'For each fact: e = the name as written, k = person, creature, place, thing or group, a = the attribute, v = the value in one or two words, q = the few words of the paragraph that state it, copied exactly.',
    'Leave out guesses, questions, plans, comparisons and what a character only says in dialogue. No fact: {"f":[]}.',
    'Example. Paragraph: Wren, the old bay gelding, dozed by the gate while Moll Teague, Tom\'s elder sister, brushed her own red hair.',
    'Answer: {"f":[{"e":"Wren","k":"creature","a":"sex","v":"gelding","q":"Wren, the old bay gelding"},{"e":"Wren","k":"creature","a":"species","v":"horse","q":"Wren, the old bay gelding"},{"e":"Moll Teague","k":"person","a":"sibling","v":"Tom","q":"Moll Teague, Tom\'s elder sister"},{"e":"Moll Teague","k":"person","a":"sex","v":"sister","q":"Tom\'s elder sister"},{"e":"Moll Teague","k":"person","a":"hair","v":"red","q":"her own red hair"}]}'
  ].join('\n');
  const PROPOSE_SCHEMA = {
    type: 'object',
    properties: {
      f: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: { e: { type: 'string' }, k: { enum: ASK_KINDS }, a: { enum: ASK_ATTRS }, v: { type: 'string' }, q: { type: 'string' } },
          required: ['e', 'k', 'a', 'v', 'q']
        }
      }
    },
    required: ['f']
  };
  const ANSWER_SCHEMA = { type: 'object', properties: { a: { enum: ['yes', 'no', 'unclear'] } }, required: ['a'] };
  const JUDGE_SYSTEM = 'You check one claimed fact against a paragraph of a novel. Answer yes only if the paragraph plainly states the claim as true in the story. Answer no if it states something else. Answer unclear if it does not say, or the claim rests on a question, a plan, a comparison or what a character says.';
  const REFERS_SYSTEM = 'You read a paragraph of a novel and say whether a word in one of its sentences refers to a given character or animal.';
  const said = (claim) => `${claim.entity}: ${claim.attr === 'birthplace' ? 'born in' : claim.attr} = ${claim.value}${claim.as ? ` (${claim.as})` : ''}`;

  function localReader({ id, ask }) {
    // an answer that went wrong is no answer; stopping is passed on
    const safe = async (msg, none) => {
      try { return await ask(msg); } catch (err) { if (err && err.code) throw err; return none; }
    };
    return {
      id,
      calls: 0,
      async propose({ text, known = [] }) {
        this.calls++;
        const names = known.map((k) => `${k.name} (${k.kind})`).join(', ');
        const r = await safe({ system: PROPOSE_SYSTEM, user: (names ? `Known names: ${names}\n\n` : '') + `Paragraph:\n${text}`, schema: PROPOSE_SCHEMA, maxTokens: 320 }, null);
        return ((r && r.f) || []).flatMap((x) => {
          const p = {
            entity: x.e, kind: x.k, attr: x.a === 'born' ? 'birthplace' : x.a, quote: x.q,
            value: String(x.v || '').replace(/\([^()]*\)/g, '').trim(),
            asWritten: x.a === 'sibling' ? x.q : ''
          };
          // "species: mare" says a sex too (the gates still want it in the quote)
          const w = norm(p.value);
          return p.attr === 'species' && SEX_WORDS[w] ? [p, { ...p, attr: 'sex', value: w }] : [p];
        });
      },
      async judge({ claim, quote, paragraph }) {
        // a sex read from a pronoun alone ("Tamsin rode her") is left to the
        // writer: who a pronoun means is where small models go wrong
        if (claim.attr === 'sex' && !wordsOf(quote).some((x) => SEX_WORDS[x.replace(/'s$/, '')])) return 'unclear';
        const r = await safe({ system: JUDGE_SYSTEM, user: `Paragraph:\n${paragraph}\n\nQuote: "${quote}"\nClaim: ${said(claim)}\nIs the claim true in the story, by this paragraph?`, schema: ANSWER_SCHEMA, maxTokens: 12 }, null);
        return (r && r.a) || 'unclear';
      },
      async refers({ sentence, span, entity, paragraph }) {
        const r = await safe({ system: REFERS_SYSTEM, user: `Paragraph:\n${paragraph}\n\nSentence: "${sentence}"\nDoes the word "${span}" in this sentence refer to ${entity}?`, schema: ANSWER_SCHEMA, maxTokens: 12 }, null);
        return (r && r.a) || 'unclear';
      },
      async pick() { return null; },
      abort() {}
    };
  }

  return {
    localReader, PROPOSE_SCHEMA, ANSWER_SCHEMA,
    textHash, norm, normMap, decode, sourceParas, speechSpans, sentences, mentionIndex, mentions, gateQuote,
    inSpans, nameParts, WORD,
    ATTRS, KINDS, STATES, SEX_WORDS, PRONOUNS, PRONOUN_SWAP, KIN_SWAP, COLOURS, SPECIES, KIN, slug, attrOf, labelOf, normaliseFact, handFact, factKey,
    newEntry, parseEntry, serialiseEntry, confirmFact, setAsideFact, restoreFact,
    firmFact, editDistance, checkSources, createEngine, fakeReader
  };
});
