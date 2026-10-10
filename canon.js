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

  return {
    textHash, norm, normMap, decode, sourceParas, speechSpans, sentences, mentionIndex, mentions, gateQuote,
    inSpans, nameParts, WORD
  };
});
