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

  // Words changed in NEO's chapter HTML without a DOM: in the paragraph whose
  // text hashes to `para`, the `span` at `at` (in the paragraph's text)
  // becomes `to`. Only inside one run of text: a span that crosses a tag
  // (part in italics) needs the writer's own hand, and gives null, as does a
  // paragraph that no longer reads as it did. Every other byte stays.
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function replaceInHtml(html, para, at, span, to) {
    html = String(html || '');
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\bclass="[^"]*\b(?:scene-break|ghost)\b/.test(m[1]) || textHash(norm(paraText(m[2]))) !== para) continue;
      const base = m.index + m[0].length - m[2].length - 4;
      // each character of the text: where it is in the HTML, and which run
      const chars = [];
      let run = 0;
      const tok = /<span\b[^>]*\bclass="[^"]*\bph-mark\b[^"]*"[^>]*>[\s\S]*?<\/span>|<[^>]*>|&(?:#x[0-9a-f]+|#\d+|[a-z]+);|[\s\S]/gi;
      let t;
      while ((t = tok.exec(m[2]))) {
        if (t[0][0] === '<' && t[0].length > 1) { run++; continue; }
        const raw = t[0];
        const d = raw.length > 1 ? decode(raw) : raw;
        if (d === raw) for (let i = 0; i < raw.length; i++) chars.push({ c: raw[i], a: t.index + i, b: t.index + i + 1, run });
        else for (const u of d.split('')) chars.push({ c: u, a: t.index, b: t.index + raw.length, run });
      }
      const text = chars.map((x) => x.c).join('');
      if (text.slice(at, at + span.length) !== span || !span.length) return null;
      const first = chars[at];
      const last = chars[at + span.length - 1];
      if (first.run !== last.run) return null;
      return html.slice(0, base + first.a) + escText(to) + html.slice(base + last.b);
    }
    return null;
  }

  // Spans of speech: inside quotation marks of any style, or a line opened
  // by a dash (dialogue set the European way). A mark's side is read from
  // what is around it, not only its shape, so straight quotes, curly ones
  // mixed with straight, and a curly mark typed the wrong way round all
  // pair up. A quotation left open runs to the paragraph's end only when
  // the paragraph opens with it (a speech that goes on into the next one);
  // anywhere else an unpaired mark is no speech at all, so one stray mark
  // can't make the rest of a paragraph dialogue. A short quoted term with
  // no saying verb by it (born into "Fleets.") is a word, not speech.
  const OPEN_BEFORE = /[\s([{—–\-/]/u;
  const SPEECH_VERB = /(?<![\p{L}\p{M}])(?:said|says|say|asked|asks|ask|told|tells|replied|replies|answered|answers|instructed|instructs|shouted|shouts|cried|cries|called|calls|whispered|whispers|muttered|mutters|murmured|murmurs|yelled|yells|screamed|screams|exclaimed|added|adds|continued|began|repeated|warned|ordered|commanded|demanded|insisted|explained|announced|declared|snapped|hissed|growled|laughed|sighed|pleaded|begged|agreed|offered|suggested|interrupted|protested|mumbled|stammered|breathed|sang|called out|went on)(?![\p{L}\p{M}])/iu;
  function quotePairs(text, marks, opens, closes, apostrophe) {
    const spans = [];
    let open = -1;
    for (const i of marks) {
      const c = text[i];
      const before = i ? text[i - 1] : '';
      const after = text[i + 1] || '';
      // an apostrophe inside or at the end of a word (don't, the dogs' bowls)
      if (apostrophe && c !== opens[0] && /[\p{L}\p{N}]/u.test(before) && (/[\p{L}\p{N}]/u.test(after) || open < 0)) continue;
      const leftOpen = (!before || OPEN_BEFORE.test(before) || opens.includes(before)) && after && !/\s/.test(after);
      const rightClose = before && !/\s/.test(before) && (!after || /[\s.,;:!?)\]}—–…'"’”»-]/u.test(after));
      let role;
      // guillemets and low marks only ever face one way
      if ('«‹„‚'.includes(c)) role = 'open';
      else if ('»›'.includes(c)) role = 'close';
      else if (leftOpen && !rightClose) role = 'open';
      else if (rightClose && !leftOpen) role = 'close';
      else if (opens.includes(c) && !closes.includes(c)) role = 'open';
      else if (closes.includes(c) && !opens.includes(c)) role = 'close';
      else role = open < 0 ? 'open' : 'close';
      if (role === 'open') {
        // one already open and this one could close it: it closes
        if (open >= 0 && rightClose) { spans.push([open, i + 1]); open = -1; } else open = i;
      } else if (open >= 0) { spans.push([open, i + 1]); open = -1; }
    }
    if (open >= 0 && !text.slice(0, open).trim()) spans.push([open, text.length]);
    return spans;
  }
  function speechSpans(text) {
    const at = (re) => [...text.matchAll(re)].map((m) => m.index);
    const spans = [
      ...quotePairs(text, at(/["“”„«»]/gu), '“„«"', '”»"', false),
      ...quotePairs(text, at(/['‘’‚‹›]/gu), '‘‚‹\'', '’›\'', true)
    ].filter(([a, b]) => {
      // a term in quotation marks, not a speech: three words or fewer, not
      // the paragraph's opening, and no saying verb in its sentence
      const inner = text.slice(a + 1, b - 1);
      const words = (inner.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
      if (words > 3 || !text.slice(0, a).trim()) return true;
      const s = sentences(text).filter((x) => x.end > a && x.start < b);
      const from = s.length ? s[0].start : a;
      // a quotation that is its sentence, or follows a colon, is spoken
      const lead = text.slice(from, a).trim();
      if (!lead || /:$/.test(lead)) return true;
      const to = s.length ? s[s.length - 1].end : b;
      // (the next sentence too, for "Run!" she shouted. split at the mark)
      const next = sentences(text).find((x) => x.start >= to);
      const around = text.slice(from, a) + ' ' + text.slice(b, Math.max(to, next && /^\s*[\p{Ll}]/u.test(text.slice(to, next.end)) ? next.end : to));
      return SPEECH_VERB.test(around);
    });
    const dash = /^\s*[—–]\s*[^—–]*/.exec(text);
    if (dash) spans.push([0, dash[0].length]);
    return spans.sort((x, y) => x[0] - y[0]);
  }
  const inSpans = (spans, a, b) => spans.some(([s, e]) => a >= s && b <= e);

  // Reported speech and hearsay, which are talk as much as a quotation is:
  // "Tom said Pip was a gelding", "according to Tom…", "rumour had it…".
  // What follows a saying verb, to the end of its sentence, is someone's
  // word, not the story's; "according to", "rumour has it" and the like
  // make the whole sentence talk. A verb that only closes a quotation
  // ("…,” Tom said.) adds nothing: the quotation is already speech.
  const REPORT_VERB = /(?<![\p{L}\p{M}])(?:said|says|say|told|tells|tell|claimed|claims|swore|swears|insisted|insists|whispered|reckoned|reckons|believed|believes|thought|thinks|supposed|suspected|assumed|guessed|figured|hinted|admitted|warned|boasted|boasts|announced|declared|muttered|heard|wrote|writes|swear)(?![\p{L}\p{M}])/giu;
  const HEARSAY = /(?<![\p{L}\p{M}])(?:according to|rumou?rs? (?:had|has|have) it|word (?:was|is|had it|has it)|it (?:was|is) said|they say|people say|folk say|some say|legend (?:had|has) it|the story goes|so the story goes|as the story goes|it was rumou?red|it is rumou?red|by all accounts|apparently|allegedly|supposedly|reportedly)(?![\p{L}\p{M}])/iu;
  function reportedSpans(text) {
    const spans = [];
    for (const s of sentences(text)) {
      if (HEARSAY.test(s.text)) { spans.push([s.start, s.end]); continue; }
      for (const m of s.text.matchAll(REPORT_VERB)) {
        const rest = s.text.slice(m.index + m[0].length);
        // "wrote every number in a ledger" is writing, not a report (only
        // "wrote that…" is); "could say it in their sleep" is what they can do
        if (/^writ|^wrote/i.test(m[0]) && !/^\s*(?:that\b|[,:]?\s*[“"‘])/i.test(rest)) continue;
        if (/\b(?:could|can|would)\s+$/i.test(s.text.slice(0, m.index)) && /^\s+it\b/i.test(rest)) continue;
        // "…,” Tom said." / "Tom said: “…”" / "said nothing": no reported clause
        if (/^\s*(?:[.!?…:;]|[“"‘'«„—–]|$|nothing\b|so\b|no\b|yes\b)/iu.test(rest)) continue;
        // "Pip, Tom said, was a gelding": the clause runs both ways. After
        // a clause of the narrator's own ("Hesper was fifteen and the
        // tallest girl in her year, too tall, the warden said, as if…"),
        // only the words since the last comma are the speaker's.
        const parenthetical = /^\s*,/.test(rest);
        let from = parenthetical ? s.start : s.start + m.index;
        if (parenthetical) {
          // the speaker: the words between the last comma and the verb ("the warden")
          const head = s.text.slice(0, m.index);
          const cut = head.replace(/,\s*[^,]*$/, '');
          const before = cut.lastIndexOf(',');
          // (the narrator's clause holds a verb of its own and five words or more)
          if (before > 0 && cut.slice(0, before).split(/\s+/).length >= 5 && /\b(?:was|were|is|are|had|has|did|went|came|stood|sat|kept)\b/i.test(cut.slice(0, before))) from = s.start + before + 1;
        }
        spans.push([from, s.end]);
        break;
      }
    }
    return spans;
  }
  // Speech of either kind: the quoted (speechSpans) and the reported
  const talkSpans = (text) => speechSpans(text).concat(reportedSpans(text));

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
    // (in either Unicode form, so a typed Zoë finds a pasted one)
    const push = (phrase, id, via, exact) => { for (const p of new Set([phrase.normalize('NFC'), phrase.normalize('NFD')])) out.push({ phrase: p, id, via, exact }); };
    for (const e of entries) {
      push(e.name, e.id, 'name', true);
      for (const a of e.aliases || []) push(a, e.id, 'alias', false);
      if (e.kind === 'person') {
        for (const p of nameParts(e.name)) if (count.get(p) === 1 && !full.has(p) && p !== e.name) push(p, e.id, 'part', true);
      }
    }
    return out.filter((x) => x.phrase).sort((a, b) => b.phrase.length - a.phrase.length);
  }

  // Every place the text names an entry: [{ id, start, end, via }]. A name
  // counts as written or in capitals (BRAMBLE), never in lower case: a
  // bramble in the hedge is no horse.
  function mentions(text, index) {
    const found = [];
    const low = text.toLowerCase();
    const taken = new Uint8Array(text.length);
    for (const m of index) {
      const needle = m.phrase.toLowerCase();
      for (let at = low.indexOf(needle); at !== -1; at = low.indexOf(needle, at + 1)) {
        const end = at + needle.length;
        if (isLetter(text[at - 1]) || isLetter(text[end])) continue;
        if (m.exact && ![m.phrase, m.phrase.toUpperCase()].includes(text.slice(at, end))) continue;
        if (taken.subarray(at, end).some((x) => x)) continue;
        taken.fill(1, at, end);
        found.push({ id: m.id, start: at, end, via: m.via });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  /* ---------- links, backlinks and the world's graph (IDE.md §2) ---------- */

  // [[Name]] or [[Name|words shown]] in an entry's own words. A [[ that
  // never closes is no link.
  function parseLinks(text) {
    const out = [];
    const re = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const target = m[1].trim();
      if (target) out.push({ target, shown: (m[2] || '').trim() || target, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // A name to the entry it means, through mentions()'s own index: a name
  // first, then an alias, then a part of a person's name; case and curly
  // quotes don't matter
  const resolvers = new WeakMap();
  function resolveName(name, index) {
    let map = resolvers.get(index);
    if (!map) {
      map = new Map();
      for (const via of ['name', 'alias', 'part']) for (const m of index) if (m.via === via && !map.has(norm(m.phrase.normalize('NFC')))) map.set(norm(m.phrase.normalize('NFC')), m.id);
      resolvers.set(index, map);
    }
    return map.get(norm(String(name || '').normalize('NFC'))) || null;
  }

  // What an entry links to: a relation fact whose value names an entry, and
  // each [[link]] in its words (one that names no entry: to null, its name)
  const LINK_ATTRS = new Set(['sibling', 'parent', 'child', 'spouse', 'birthplace', 'owner', 'home', 'other']);
  function entryLinks(entry, index) {
    const out = [];
    for (const f of entry.facts) {
      const to = LINK_ATTRS.has(f.attr) ? resolveName(f.value, index) : null;
      if (to && to !== entry.id) out.push({ to, via: 'fact', attr: f.attr, label: f.label });
    }
    for (const l of parseLinks(entry.words)) {
      const to = resolveName(l.target, index);
      if (to !== entry.id) out.push(to ? { to, via: 'words' } : { to: null, name: l.target, via: 'words' });
    }
    return out;
  }

  // The world as a graph: an edge a → b for each link, and (from the
  // shelf's index) a → b, why 'together', for two entries that share at
  // least two paragraphs. `world` is canon:index's answer, or nothing.
  function linkGraph(entries, index, world = {}) {
    const ids = new Set(entries.map((e) => e.id));
    const nodes = entries.map((e) => ({ id: e.id, name: e.name, kind: e.kind, mentions: (world.mentions || {})[e.id] || 0 }));
    const edges = [];
    const seen = new Map();
    for (const e of entries) {
      for (const l of entryLinks(e, index)) {
        if (!l.to || !ids.has(l.to)) continue;
        const k = [e.id, l.to, l.via, l.attr || ''].join('\n');
        if (seen.has(k)) { seen.get(k).n++; continue; }
        const edge = { a: e.id, b: l.to, why: l.via, n: 1, ...(l.attr ? { attr: l.attr, label: l.label } : {}) };
        seen.set(k, edge);
        edges.push(edge);
      }
    }
    for (const [a, b, n] of world.together || []) if (ids.has(a) && ids.has(b)) edges.push({ a, b, why: 'together', n });
    return { nodes, edges };
  }
  // the links into an entry (appearing together is not a link)
  const backlinks = (graph, id) => graph.edges.filter((x) => x.b === id && x.why !== 'together');

  // per paragraph, the entries it names, in the order they appear
  const paraEntries = (paras, index) => paras.map((p) => [...new Set(mentions(p.text, index).map((m) => m.id))]);

  // A few words either side of text[a, b): the snippet, where the words
  // are in it, and the words as written
  function snippetAround(text, a, b, n = 12) {
    const before = new RegExp(`(?:\\S*\\s+){0,${n}}\\S*$`).exec(text.slice(0, a))[0];
    const after = new RegExp(`^\\S*(?:\\s+\\S+){0,${n}}`).exec(text.slice(b))[0];
    const open = before.length < a ? '…' : '';
    return { snippet: open + before + text.slice(a, b) + after + (b + after.length < text.length ? '…' : ''), at: open.length + before.length, span: text.slice(a, b) };
  }

  // The shelf's index, kept only in memory: how many paragraphs name each
  // entry, which pairs share at least two, and who is in each chapter
  function worldIndex(sources, entries) {
    const index = mentionIndex(entries);
    const count = {};
    const pairs = new Map();
    const byChapter = {};
    for (const src of sources) {
      const here = new Set();
      for (const ids of paraEntries(sourceParas(src.html), index)) {
        for (const id of ids) { count[id] = (count[id] || 0) + 1; here.add(id); }
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const k = [ids[i], ids[j]].sort().join('\n');
            pairs.set(k, (pairs.get(k) || 0) + 1);
          }
        }
      }
      if (here.size) byChapter[src.bookId + '/' + src.chId] = [...here];
    }
    const together = [...pairs].filter(([, n]) => n >= 2).map(([k, n]) => [...k.split('\n'), n]);
    return { mentions: count, together, byChapter };
  }

  // Every paragraph that names one entry, in reading order, as snippets
  const where = (src) => ({ bookId: src.bookId, chId: src.chId, book: src.book, label: src.label, notes: !!src.notes, notebook: !!src.notebook });
  function mentionPassages(sources, entries, id, { limit = Infinity } = {}) {
    const index = mentionIndex(entries);
    const passages = [];
    const books = new Set();
    let total = 0;
    for (const src of sources) {
      for (const p of sourceParas(src.html)) {
        const m = mentions(p.text, index).find((x) => x.id === id);
        if (!m) continue;
        total++;
        books.add(src.bookId);
        if (passages.length < limit) passages.push({ ...where(src), para: p.hash, ...snippetAround(p.text, m.start, m.end) });
      }
    }
    return { total, books: books.size, passages };
  }

  // Passages holding some words (normalised), in reading order, 20 at most
  function searchPassages(sources, q, limit = 20) {
    const nq = norm(q);
    const out = [];
    if (nq.length < 3) return out;
    for (const src of sources) {
      for (const p of sourceParas(src.html)) {
        const nm = normMap(p.text);
        const i = nm.text.indexOf(nq);
        if (i < 0) continue;
        out.push({ ...where(src), para: p.hash, ...snippetAround(p.text, nm.map[i], nm.map[i + nq.length - 1] + 1, 8) });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  // The quote gate: a quote counts only if it is in the source, after
  // normalising quotes, dashes and spaces, and is at most 30 words. What
  // comes back is the writer's own text, cut from the source.
  function gateQuote(quote, text) {
    const q = norm(quote).replace(/^["'\s]+|["'\s]+$/g, '');
    if (q.length < 3 || q.split(' ').length > 30) return null;
    const src = normMap(text);
    // whole words: "mare" isn't in "the grey mares"
    const cut = (at) => (isLetter(q[0]) && isLetter(src.text[at - 1])) || (isLetter(q[q.length - 1]) && isLetter(src.text[at + q.length]));
    let at = src.text.indexOf(q);
    while (at !== -1 && cut(at)) at = src.text.indexOf(q, at + 1);
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
  const LABEL_ATTR = { gender: 'sex', pronouns: 'sex', eye: 'eyes', 'eye colour': 'eyes', 'eye color': 'eyes', 'hair colour': 'hair', 'hair color': 'hair', born: 'birthplace', birthplace: 'birthplace', 'born at': 'birthplace' };
  for (const [attr, a] of Object.entries(ATTRS)) { LABEL_ATTR[attr] = attr; LABEL_ATTR[a.label.toLowerCase()] = attr; }
  const KINDS = ['person', 'creature', 'place', 'thing', 'group', 'rule', 'other'];
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
  // a file name: accents off, any script's letters kept (李雷 stays 李雷)
  // (never a name Windows keeps for itself, CON or LPT1, which a synced
  // library couldn't hold there)
  const RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/;
  const slug = (s) => {
    const out = String(s || '').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'entry';
    return RESERVED.test(out) ? out + '-entry' : out;
  };
  // one line in the file, whatever was typed or pasted
  const one = (s) => String(s == null ? '' : s).replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ');
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
      // "Pronouns: she/her" is female; "they/them" isn't either
      const by = new Set(w.map((x) => PRONOUNS[x]));
      if (by.size === 1 && !by.has(undefined)) return { value: [...by][0], as: '' };
      return ['female', 'male'].includes(norm(v)) ? { value: norm(v), as: '' } : null;
    }
    if (attr === 'eyes' || attr === 'hair') {
      const word = w.find((x) => COLOURS[x]);
      // the writer's own description is kept: grey (storm grey)
      const own = String(as || '').trim();
      return word ? { value: COLOURS[word], as: own && norm(own) !== COLOURS[word] ? own : word === COLOURS[word] ? '' : word } : null;
    }
    if (attr === 'species') {
      const word = wordsOf(v).find((x) => SPECIES[x]) || wordsOf(as).find((x) => SPECIES[x]);
      return word ? { value: SPECIES[word], as: '' } : (v && !/\s/.test(v) ? { value: norm(v), as: '' } : null);
    }
    if (attr === 'sibling') return v ? { value: v, as: KIN[norm(as)] || w.map((x) => KIN[x]).find(Boolean) || '' } : null;
    return v ? { value: v, as: String(as || '').trim() } : null;
  }

  // A fact the writer typed ("Sex: mare"): theirs, written in Canon. A
  // value outside the lexicon (Eyes: violet, Sex: nonbinary, they/them) is
  // kept as written; it raises no slips (`lexical`).
  function handFact(text) {
    const m = /^\s*([^:]+?)\s*:\s*(.+?)(?:\s*\(([^()]*)\))?\s*$/.exec(one(text));
    if (!m) return null;
    const attr = attrOf(m[1]) || 'other';
    const n = normaliseFact(attr, m[2], m[3]) || { value: m[2].trim(), as: (m[3] || '').trim() };
    return { attr, label: attr === 'other' ? m[1] : undefined, value: n.value, as: n.as, state: 'yours', sources: [{ written: true }] };
  }

  const factKey = (entry, f) => ATTRS[f.attr] && ATTRS[f.attr].single ? `${entry.id}/${f.attr}`
    : f.attr === 'other' ? `${entry.id}/other/${slug(f.label || '')}/${slug(f.value)}` : `${entry.id}/${f.attr}/${slug(f.value)}`;

  /* ---------- open facts: labels and their kinds (READING.md §3) ---------- */

  // An open label, as a reader or a writer wrote it, to the canonical set.
  // A label the table doesn't know stays itself (and is shown under Other).
  // scripts/canon-score.js scores with this same table.
  const LABELS = {
    sex: 'sex', gender: 'sex',
    age: 'age', 'how old': 'age',
    eyes: 'appearance.eyes', eye: 'appearance.eyes', 'eye colour': 'appearance.eyes', 'eye color': 'appearance.eyes', 'eye look': 'appearance.eyes',
    hair: 'appearance.hair', 'hair colour': 'appearance.hair', 'hair color': 'appearance.hair', haircut: 'appearance.hair', hairstyle: 'appearance.hair',
    height: 'appearance.height', build: 'appearance.build', body: 'appearance.build', figure: 'appearance.build', size: 'appearance.build',
    face: 'appearance.face', skin: 'appearance.face', clothing: 'appearance.clothing', clothes: 'appearance.clothing', dress: 'appearance.clothing', wears: 'appearance.clothing', outfit: 'appearance.clothing',
    mark: 'appearance.mark', marks: 'appearance.mark', tattoo: 'appearance.mark', scar: 'appearance.mark', 'distinguishing mark': 'appearance.mark',
    appearance: 'appearance', looks: 'appearance', look: 'appearance', 'physical description': 'appearance', glasses: 'appearance.other', spectacles: 'appearance.other',
    species: 'species',
    role: 'role', job: 'occupation', occupation: 'occupation', work: 'occupation', profession: 'occupation', duty: 'role', duties: 'role', position: 'role', title: 'role', rank: 'role',
    personality: 'personality', temperament: 'personality', character: 'personality', trait: 'personality', traits: 'personality', nature: 'personality', manner: 'manner', 'manner of speech': 'manner.speech', speech: 'manner.speech', voice: 'manner.speech', accent: 'manner.speech',
    habit: 'habit', habits: 'habit', routine: 'routine', routines: 'routine', custom: 'custom', customs: 'custom', practice: 'custom', ritual: 'routine', schedule: 'routine',
    relationship: 'relationship', relationships: 'relationship', friend: 'relationship.friend', friends: 'relationship.friend', 'friend of': 'relationship.friend', ally: 'relationship.friend', enemy: 'relationship.enemy',
    sibling: 'relationship.kin', 'child of': 'relationship.kin', 'parent of': 'relationship.kin', 'married to': 'relationship.kin', kin: 'relationship.kin', family: 'relationship.kin', spouse: 'relationship.kin',
    owner: 'possession', possession: 'possession', possessions: 'possession', carries: 'possession', owns: 'possession', belongings: 'possession',
    origin: 'origin', 'born in': 'origin', birthplace: 'origin', born: 'origin', from: 'origin', background: 'history', backstory: 'history', history: 'history', past: 'history',
    'lives in': 'location.home', home: 'location.home', residence: 'location.home', location: 'location', where: 'location', situated: 'location', place: 'location', 'part of': 'location.part', parts: 'location.part', rooms: 'location.part',
    description: 'description', 'what it is like': 'description', features: 'description', layout: 'description', atmosphere: 'atmosphere', smell: 'atmosphere', sound: 'atmosphere', light: 'atmosphere', mood: 'atmosphere',
    rule: 'rule', rules: 'rule', law: 'rule', laws: 'rule', system: 'rule', 'how it works': 'rule',
    membership: 'membership', member: 'membership', group: 'membership', caste: 'membership', 'belongs to': 'membership', members: 'members', residents: 'residents', 'who is there': 'residents', inhabitants: 'residents',
    state: 'state', condition: 'state', health: 'state', status: 'state',
    name: 'name', nickname: 'name', alias: 'name', 'also known as': 'name', called: 'name',
    function: 'function', purpose: 'function', use: 'use', effect: 'effect', effects: 'effect', taste: 'description',
    opinion: 'opinion', belief: 'opinion', skill: 'skill', skills: 'skill', ability: 'skill',
    other: 'other', note: 'other', notes: 'other', fact: 'other', detail: 'other'
  };
  // families: the attributes an editor would let stand for each other
  const LABEL_FAMILY = { occupation: 'role', routine: 'habit', custom: 'habit', atmosphere: 'description', residents: 'description', function: 'function', use: 'function', effect: 'function', members: 'membership', 'manner.speech': 'personality', manner: 'personality', opinion: 'personality', origin: 'origin', history: 'history', species: 'species', skill: 'role' };
  const labelFamily = (a) => LABEL_FAMILY[a] || String(a).split('.')[0];
  function canonLabel(label) {
    const l = norm(label).replace(/[_]/g, ' ').trim();
    if (LABELS[l]) return LABELS[l];
    if (/^[a-z]+(?:\.[a-z]+)+$/.test(l)) return l; // already canonical: appearance.hair
    const last = l.split(/\s+/).pop();
    const first = l.split(/\s+/)[0];
    return LABELS[last] || LABELS[first] || l;
  }
  const KNOWN_KEYS = new Set([...Object.values(LABELS), 'appearance.other', 'relationship.enemy']);
  // How an open fact's label is written in its entry: the reader's own word
  // when the table knows it and it is no closed attribute's (Hair, Lives in,
  // Owner, Title read as the trait or relation they name), else a plain
  // word for its key.
  const OPEN_LABEL = { 'appearance.hair': 'Hairstyle', 'appearance.eyes': 'Eye look', 'appearance.height': 'Height', 'appearance.build': 'Build', 'appearance.face': 'Face',
    'appearance.clothing': 'Clothing', 'appearance.mark': 'Marks', 'appearance.other': 'Appearance', appearance: 'Appearance', age: 'Age', role: 'Role', occupation: 'Work',
    personality: 'Personality', manner: 'Manner', 'manner.speech': 'Speech', habit: 'Habit', routine: 'Routine', custom: 'Custom', relationship: 'Relationship',
    'relationship.friend': 'Friend', 'relationship.kin': 'Family', 'relationship.enemy': 'Enemy', possession: 'Possessions', origin: 'Origin', history: 'History',
    'location.home': 'Residence', location: 'Location', 'location.part': 'Parts', description: 'Description', atmosphere: 'Atmosphere', residents: 'Residents',
    rule: 'Rule', membership: 'Membership', members: 'Members', name: 'Nickname', function: 'Function', use: 'Use', effect: 'Effect', opinion: 'Opinion', skill: 'Skill', other: 'Other', state: 'Condition' };
  function openLabel(key, label) {
    const l = one(label || '').replace(/[:·()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (l && l.split(' ').length <= 3 && canonLabel(l) === key && !attrOf(l) && !/^other$/i.test(l)) return l[0].toUpperCase() + l.slice(1);
    return OPEN_LABEL[key] || (l ? l[0].toUpperCase() + l.slice(1) : 'Other');
  }
  // The canonical key of any fact: a closed attribute's own, an open one's label's
  const ATTR_KEY = { sex: 'sex', species: 'species', eyes: 'appearance.eyes', hair: 'appearance.hair', birthplace: 'origin', sibling: 'relationship.kin', parent: 'relationship.kin', child: 'relationship.kin', spouse: 'relationship.kin', owner: 'possession', home: 'location.home', title: 'role', state: 'state' };
  const factKind = (f) => f.attr !== 'other' ? ATTR_KEY[f.attr] || 'other' : canonLabel(labelOf(f));
  // Where a fact sits on its entry's page (READING.md §4): in this order,
  // a place's routines being how it works, a person's their habits
  const SECTIONS = ['who', 'appearance', 'role', 'personality', 'habits', 'relationships', 'history', 'state', 'like', 'works', 'there', 'rules', 'other'];
  function factSection(f, kind) {
    const k = factKind(f);
    const fam = labelFamily(k);
    const placeish = ['place', 'group', 'thing', 'rule'].includes(kind);
    if (['sex', 'species', 'age', 'name', 'membership'].includes(k) || fam === 'membership') return 'who';
    if (fam === 'appearance') return 'appearance';
    if (fam === 'role') return 'role';
    if (fam === 'personality') return 'personality';
    if (fam === 'habit') return placeish ? 'works' : 'habits';
    if (fam === 'relationship') return 'relationships';
    if (fam === 'origin' || fam === 'history') return 'history';
    if (fam === 'state' || fam === 'possession') return 'state';
    if (k === 'residents' || k === 'members') return 'there';
    if (fam === 'description' || fam === 'location') return 'like';
    if (fam === 'function') return 'works';
    if (fam === 'rule') return placeish ? 'rules' : 'rules';
    return 'other';
  }

  /* ---------- entry files ---------- */

  // One Markdown file per entry (ARCHITECTURE §2.2). One line is one thing;
  // "## In my words" and all after it is the writer's and kept byte for byte.
  function newEntry(name, kind, id) {
    return { id: id || slug(name), name: one(name).trim(), kind: KINDS.includes(kind) ? kind : 'other', aliases: [], extra: [], profile: null, facts: [], story: [], setAside: [], lead: { top: [], facts: [], story: [], aside: [] }, words: '' };
  }

  // Written by hand in any editor, so a byte-order mark, Windows line ends,
  // trailing spaces, * bullets, tabs and a capitalised state all read. A line
  // Canon doesn't know (a note under a fact) is kept where it was, never
  // dropped; only broken front matter makes the file unreadable, and then
  // the answer says which line.
  const FACT_LINE = /^[-*] (.+?): (.*?)(?: \(([^()]*)\))? · (verified|unverified|yours|disagree|set aside|not right)$/i;
  const SOURCE_LINE = /^(?: {2,}|\t+)[-*] (.*?): "(.*)" \{([^{}]*)\}$/;
  const WRITTEN_LINE = /^(?: {2,}|\t+)[-*] Written in Canon$/i;
  // Story so far (docs/semantics/STORY.md): a key point, Canon's or the writer's
  const EVENT_LINE = /^[-*] (.+?)(?: · (canon['’]s note|yours))?$/i;
  // the mark of the words Canon wrote: changed, the line is the writer's
  const noteMark = (did) => textHash(norm(did)).split(':')[0].slice(-6);
  function parseEntry(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const bad = (line) => {
      const name = /^name: *(.+?) *$/m.exec(text);
      const kind = /^kind: *(\w+)/m.exec(text);
      return { error: 'unreadable', line, name: name ? name[1] : '', kind: kind && KINDS.includes(kind[1]) ? kind[1] : 'other' };
    };
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) return bad(1);
    const e = { ...newEntry('x', 'other'), id: '', name: '' };
    const fmLines = fm[1].split('\n');
    for (const [i, raw] of fmLines.entries()) {
      const line = raw.trimEnd();
      const m = /^([\w-]+): ?(.*)$/.exec(line);
      if (!m) { if (!line) continue; return bad(i + 2); }
      if (m[1] === 'id') e.id = m[2].trim();
      else if (m[1] === 'name') e.name = m[2].trim();
      else if (m[1] === 'kind') e.kind = KINDS.includes(m[2].trim().toLowerCase()) ? m[2].trim().toLowerCase() : 'other';
      else if (m[1] === 'aliases') e.aliases = (m[2].trim().replace(/^\[|\]$/g, '').match(/"[^"]*"|[^,]+/g) || []).map((s) => s.trim().replace(/^"|"$/g, '').trim()).filter(Boolean);
      else e.extra.push([m[1], m[2]]);
    }
    if (!e.name) return bad(2);
    if (!e.id) e.id = slug(e.name);
    let rest = text.slice(fm[0].length);
    const words = /(?:^|\n)## In my words\n/.exec(rest);
    if (words) { e.words = rest.slice(words.index + words[0].length); rest = rest.slice(0, words.index); }
    let list = null;
    let lead = e.lead.top;
    let profile = null;
    for (const raw of rest.split('\n')) {
      const line = raw.trimEnd();
      if (!line || /^# /.test(line)) continue;
      // Profile (READING.md §4): prose, its [n] sources, and Canon's mark
      if (/^## Profile$/i.test(line) && !list && !profile) { profile = { prose: [], cites: [], note: null }; continue; }
      if (profile && !list && !/^## /.test(line)) {
        const c = /^[-*] \[(\d+)\] (.*?): "(.*)" \{([^{}]*)\}$/.exec(line);
        const mark = /^[-*] Canon['’]s profile \{note:([^{}]*)\}$/i.exec(line);
        if (c) {
          const src = { n: +c[1], label: c[2], quote: c[3] };
          for (const part of c[4].split(',').map((x) => x.trim())) { const [k, ...v] = part.split(':'); if (k === 'book' || k === 'ch') src[k] = v.join(':').trim(); }
          profile.cites.push(src);
        } else if (mark) profile.note = mark[1].trim();
        else profile.prose.push(line);
        continue;
      }
      if (/^## Facts$/i.test(line)) { list = e.facts; lead = e.lead.facts; continue; }
      if (/^## Set aside$/i.test(line)) { list = e.setAside; lead = e.lead.aside; continue; }
      if (/^## Story so far$/i.test(line)) { list = e.story; lead = e.lead.story; continue; }
      const ev = list === e.story && !/^\s/.test(line) && EVENT_LINE.exec(line);
      if (ev) {
        list.push({ did: ev[1], state: ev[2] && /^canon/i.test(ev[2]) ? 'note' : 'yours', sources: [] });
        continue;
      }
      const f = list && list !== e.story && FACT_LINE.exec(line);
      if (f) {
        const attr = attrOf(f[1]) || 'other';
        list.push({ attr, label: attr === 'other' ? f[1] : undefined, value: f[2], as: f[3] || '', state: f[4].toLowerCase(), sources: [] });
        continue;
      }
      const last = list && list[list.length - 1];
      const s = last && SOURCE_LINE.exec(line);
      if (last && WRITTEN_LINE.test(line)) last.sources.push({ written: true });
      else if (s) {
        const src = { label: s[1], quote: s[2] };
        for (const part of s[3].split(',').map((x) => x.trim())) {
          const [k, ...v] = part.split(':');
          if (k === 'book' || k === 'ch') src[k] = v.join(':').trim();
          else if (k === 'said') src.said = v.length ? v.join(':') : true;
          else if (k === 'plan' || k === 'changed') src[k] = true;
          else if (k === 'note') src.note = v.join(':').trim();
        }
        last.sources.push(src);
      } else if (last) (last.notes = last.notes || []).push(raw);
      else lead.push(raw);
    }
    // a profile whose words aren't the ones Canon wrote is the writer's
    if (profile) {
      const text = profile.prose.join('\n');
      e.profile = { text, cites: profile.cites, state: profile.note && profile.note === noteMark(text) ? 'note' : 'yours' };
    }
    // a Canon's note whose words aren't the ones Canon wrote: the writer's now
    for (const x of e.story) if (x.state === 'note' && !x.sources.some((src) => src.note === noteMark(x.did))) x.state = 'yours';
    // the same fact twice is one (`merged`: how many, for the file to heal)
    const [facts, merged] = dedupFacts(e.facts);
    e.facts = facts;
    Object.defineProperty(e, 'merged', { value: merged, enumerable: false });
    return e;
  }

  // ## Profile: the prose (each sentence ending in its [n]), the sources,
  // and Canon's mark when the words are Canon's (READING.md §4)
  function profileLines(p) {
    if (!p || !(p.text || '').trim()) return [];
    const text = String(p.text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/^[-*#]/.test(l.trim()));
    if (!text.length) return [];
    return ['## Profile', ...text,
      ...(p.cites || []).map((c) => `- [${c.n}] ${one(c.label)}: "${one(c.quote)}" {book:${c.book}, ch:${c.ch}}`),
      ...(p.state === 'note' ? [`- Canon’s profile {note:${noteMark(text.join('\n'))}}`] : []), ''];
  }
  function serialiseEntry(e) {
    // never the same fact twice in the file
    const once = dedupFacts(e.facts.map((f) => ({ ...f, sources: f.sources.map((x) => ({ ...x })), notes: f.notes && f.notes.slice() })))[0];
    const factLines = (facts) => facts.flatMap((f) => [
      `- ${one(labelOf(f))}: ${one(f.value)}${f.as ? ` (${one(f.as)})` : ''} · ${f.state}`,
      ...f.sources.map((s) => s.written ? '  - Written in Canon'
        : `  - ${one(s.label)}: "${one(s.quote)}" {book:${s.book}, ch:${s.ch}${s.said ? (s.said === true ? ', said' : `, said:${one(s.said)}`) : ''}${s.plan ? ', plan' : ''}${s.changed ? ', changed' : ''}${s.note ? `, note:${s.note}` : ''}}`),
      ...(f.notes || [])
    ]);
    const storyLines = (story) => story.flatMap((x) => [
      `- ${one(x.did)} · ${x.state === 'note' ? 'Canon’s note' : 'yours'}`,
      ...factLines([{ attr: 'other', label: 'x', value: '', state: 'yours', sources: x.sources.map((s) => x.state === 'note' ? { ...s, note: noteMark(x.did) } : { ...s, note: undefined }), notes: x.notes }]).slice(1)
    ]);
    const lead = e.lead || {};
    const alias = (a) => (a.includes(',') ? `"${one(a)}"` : one(a));
    const lines = ['---', `id: ${e.id}`, `name: ${one(e.name)}`, `kind: ${e.kind}`, `aliases: [${e.aliases.map(alias).join(', ')}]`,
      ...e.extra.map(([k, v]) => `${k}: ${one(v)}`), '---', `# ${one(e.name)}`, '', ...(lead.top || []), ...((lead.top || []).length ? [''] : []),
      ...profileLines(e.profile), '## Facts', ...(lead.facts || []), ...factLines(once)];
    if ((e.story || []).length || (lead.story || []).length) lines.push('', '## Story so far', ...(lead.story || []), ...storyLines(e.story || []));
    if (e.setAside.length || (lead.aside || []).length) lines.push('', '## Set aside', ...(lead.aside || []), ...factLines(e.setAside));
    lines.push('', '## In my words');
    return lines.join('\n') + '\n' + (e.words || '');
  }

  // The writer's own moves on an entry, shared by the tab and the tests.
  // "That's right" makes a fact theirs; Set Aside and Not right move it to
  // the entry's Set aside (nothing is deleted); Restore brings it back theirs.
  function confirmFact(e, i) {
    let f = e.facts[i];
    if (!f) return;
    // what a character says (or a plan), made true by the writer: the
    // writer's fact now, citing the passage it came from. A fact of the
    // same value already there takes the passage instead, so It's true
    // twice is one fact, never two.
    if (talkOnly(f)) {
      const had = e.facts.find((x) => x !== f && sameFact(x, f) && !talkOnly(x));
      e.facts.splice(i, 1);
      if (had) {
        for (const s of f.sources) if (!had.sources.some((x) => sameSrc(x, s))) had.sources.push(s);
        if (!had.as && f.as) had.as = f.as;
        f = had;
      } else e.facts.splice(i, 0, f);
    }
    f.state = 'yours';
    for (const s of f.sources) delete s.changed;
    // the other values (checked or not) step aside
    for (const o of e.facts.filter((x) => x !== f && x.attr === f.attr && x.state !== 'yours' && norm(x.value) !== norm(f.value) && ATTRS[f.attr] && ATTRS[f.attr].single)) setAsideFact(e, e.facts.indexOf(o), false);
  }
  const sameFact = (x, y) => x.attr === y.attr && norm(x.value) === norm(y.value) && (x.attr !== 'other' || norm(x.label || '') === norm(y.label || ''));
  const sameSrc = (a, b) => a.written || b.written ? !!(a.written && b.written) : a.book === b.book && a.ch === b.ch && norm(a.quote) === norm(b.quote);
  // One fact for one value. Facts of the same attribute and value (what
  // the story says apart from what someone only says) are one, with every
  // source of each; nothing is lost but the repetition. An entry written
  // by an older Canon, whose It's true added a sourceless fact of the
  // writer's on every press, heals here: the copies are one, and the line
  // they confirmed joins it as its passage. → [facts, how many merged]
  function dedupFacts(facts) {
    const out = [];
    const copies = new Map();
    const RANK = { yours: 4, verified: 3, disagree: 2, unverified: 1 };
    for (const f of facts) {
      const had = out.find((x) => sameFact(x, f) && talkOnly(x) === talkOnly(f) && (!x.as || !f.as || norm(x.as) === norm(f.as)));
      if (!had) { out.push(f); continue; }
      copies.set(had, (copies.get(had) || 0) + 1);
      if ((RANK[f.state] || 0) > (RANK[had.state] || 0)) had.state = f.state;
      if (!had.as && f.as) had.as = f.as;
      for (const s of f.sources) if (!had.sources.some((x) => sameSrc(x, s))) had.sources.push(s);
      for (const n of f.notes || []) if (!(had.notes || []).includes(n)) (had.notes = had.notes || []).push(n);
    }
    let merged = [...copies.values()].reduce((a, b) => a + b, 0);
    for (const [f] of copies) {
      if (f.state !== 'yours' || !f.sources.every((s) => s.written)) continue;
      const talk = out.find((x) => x !== f && sameFact(x, f) && talkOnly(x));
      if (!talk) continue;
      for (const s of talk.sources) if (!f.sources.some((x) => sameSrc(x, s))) f.sources.push(s);
      for (const n of talk.notes || []) if (!(f.notes || []).includes(n)) (f.notes = f.notes || []).push(n);
      out.splice(out.indexOf(talk), 1);
      merged++;
    }
    return [out, merged];
  }
  function setAsideFact(e, i, notRight) {
    const [f] = e.facts.splice(i, 1);
    f.state = notRight ? 'not right' : 'set aside';
    e.setAside.push(f);
  }
  // A new value from the writer: the old one (for a single attribute, every
  // other value) goes to Set aside with its passages; the new one is theirs.
  function replaceFact(e, f, old) {
    const same = (x, y) => x.attr === y.attr && norm(x.value) === norm(y.value) && x.label === y.label;
    const single = ATTRS[f.attr] && ATTRS[f.attr].single;
    for (let i = e.facts.length - 1; i >= 0; i--) {
      const x = e.facts[i];
      if (!same(x, f) && ((old && same(x, old)) || (single && x.attr === f.attr))) setAsideFact(e, i, false);
    }
    // never a fact resting on what someone says or plans: the new value
    // cites the writer's choice, not the horse-trader's "gelding" (QA F7)
    const had = e.facts.find((x) => same(x, f) && !talkOnly(x));
    if (!had) { e.facts.push(f); return; }
    const talk = had.sources.filter((x) => x.said || x.plan);
    if (talk.length) {
      had.sources = had.sources.filter((x) => !x.said && !x.plan);
      e.facts.push({ attr: had.attr, label: had.label, value: had.value, as: had.as, state: 'unverified', sources: talk });
    }
    had.state = 'yours';
    if (f.as) had.as = f.as;
    if (!had.sources.some((x) => x.written)) had.sources.push({ written: true });
  }
  // Merge Into: `from` (the grey, split from Bramble) joins `into`. Its name
  // and aliases become aliases, its facts join (the same fact gains the
  // sources; a value that differs from a firm one waits as disagreeing),
  // its words follow the entry's own. The window then sets `from` aside.
  function mergeEntry(into, from) {
    const has = (a) => [into.name, ...into.aliases].some((x) => norm(x) === norm(a));
    for (const a of [from.name, ...from.aliases]) if (!has(a)) into.aliases.push(a);
    const same = (x, y) => x.attr === y.attr && norm(x.value) === norm(y.value) && x.label === y.label;
    for (const f of from.facts) {
      const had = into.facts.find((x) => same(x, f) && talkOnly(x) === talkOnly(f));
      if (!had) {
        const clash = ATTRS[f.attr] && ATTRS[f.attr].single && into.facts.some((x) => x.attr === f.attr && !same(x, f));
        into.facts.push({ ...f, state: clash && f.state !== 'yours' ? 'disagree' : f.state });
        continue;
      }
      if (f.state === 'yours' || (f.state === 'verified' && had.state !== 'yours')) had.state = f.state;
      for (const src of f.sources) if (!had.sources.some((x) => x.written ? src.written : x.book === src.book && x.ch === src.ch && x.quote === src.quote)) had.sources.push(src);
    }
    into.setAside.push(...from.setAside);
    for (const x of from.story || []) if (!into.story.some((y) => y.did === x.did)) into.story.push(x);
    if (from.words && from.words.trim()) into.words = (into.words ? into.words.replace(/\n*$/, '\n\n') : '') + from.words;
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
  // a value the checkers know the words for (female, grey); Eyes: violet
  // and Sex: they/them are recorded, never checked
  const lexical = (f) => f.attr === 'sex' ? ['female', 'male'].includes(f.value)
    : f.attr === 'eyes' || f.attr === 'hair' ? Object.values(COLOURS).includes(f.value) : true;
  // Each entry's firm facts by attribute (the writer's win), relations
  // listed. Two values the writer both wrote (mare and stallion) check
  // nothing until one goes: Canon doesn't pick.
  function worldOf(entries, out) {
    const world = new Map();
    for (const e of entries) {
      const k = { e, rel: [] };
      const clash = new Set();
      for (const f of e.facts) {
        if (!firmFact(f, out) || !lexical(f)) continue;
        if (!ATTRS[f.attr].single) k.rel.push(f);
        else if (k[f.attr] && k[f.attr].state === 'yours' && f.state === 'yours' && norm(k[f.attr].value) !== norm(f.value)) clash.add(f.attr);
        else if (!k[f.attr] || f.state === 'yours') k[f.attr] = f;
      }
      for (const a of clash) delete k[a];
      world.set(e.id, k);
    }
    return world;
  }

  // the word to put back for a colour: the writer's own one word ("gray"), else the value ("fair", not "fair as wet straw")
  const colourWord = (f) => (f.as && !/\s/.test(f.as.trim()) ? f.as.trim() : f.value);
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
  // what only a female (or male) can be or do: listed when a fact changes
  // across the series, never swapped (a stallion in foal needs the writer)
  const ONLY = { female: ['in foal', 'with foal', 'foaled', 'pregnant', 'gave birth', 'with child', 'in calf'], male: ['sired', 'at stud', 'fathered'] };
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

  // Words that bring someone (or some creature) else in: after John, "the
  // stranger turned. His blue eyes…" are the stranger's
  const OTHER_ONES = new Set(['stranger', 'man', 'men', 'woman', 'women', 'boy', 'girl', 'child', 'children', 'kid', 'baby', 'rider', 'soldier', 'guard', 'figure', 'person', 'people', 'someone', 'somebody', 'anyone', 'everyone', 'nobody', 'others', 'crowd', 'lad', 'lass', 'youth', 'knight', 'officer', 'sailor', 'driver', 'doctor', 'nurse', 'priest', 'merchant', 'trader', 'traveller', 'traveler', 'servant', 'friend', 'voice', 'king', 'queen', 'lord', 'lady', 'captain', 'master', 'mistress']);
  const otherOne = (lw) => OTHER_ONES.has(lw) || !!SEX_WORDS[lw] || !!SPECIES[lw] || !!KIN_NOUNS[lw]; // (KIN_NOUNS: further down)

  // Whom "his" or "her" in a sentence that names no one means, by the
  // paragraph: the one person (or creature) named before it, with no other
  // entry, capitalised name or "the stranger" between. Strong only within
  // three sentences and with no speech between, and never past a pronoun of
  // the other sex (`sex`, the asked pronoun's); `initials` are the
  // sentence-opening words between, which the dictionary must know (in
  // "John left. Mara turned. His…", Mara is a name).
  function referent(text, pos, si, ctx, sex) {
    const { every, pwords, sents, world, speech } = ctx;
    const personish = (m) => { const k = world.get(m.id); return k && (k.sex || k.e.kind === 'person' || k.e.kind === 'creature'); };
    const free = (m) => !speech.some(([a, b]) => m.start < b && m.end > a);
    const before = every.filter((m) => m.end <= pos);
    const ids = [...new Set(before.filter((m) => free(m) && personish(m)).map((m) => m.id))];
    if (ids.length !== 1) return null;
    const last = before.filter((m) => m.id === ids[0] && free(m)).pop();
    if (every.some((m) => m.id !== ids[0] && m.start >= last.start && m.start < pos)) return null;
    const initials = [];
    for (const w of pwords) {
      if (w.start < last.end || w.end > pos) continue;
      if (otherOne(w.lw)) return null;
      // "John came in. She…" before "his": two people are about
      if (PRONOUNS[w.lw] && sex && PRONOUNS[w.lw] !== sex) return null;
      if (!/^\p{Lu}/u.test(w.w) || w.w === 'I' || PRONOUNS[w.lw]) continue;
      if (!w.initial) return null;
      initials.push(w.w.replace(/['’]s$/, ''));
    }
    const at = sents.findIndex((s) => last.start >= s.start && last.start < s.end);
    const talk = speech.some(([a, b]) => a < pos && b > last.end);
    return { id: ids[0], k: world.get(ids[0]), weak: si - at > 3 || talk, initials, from: last.start };
  }

  // Candidate slips in one paragraph. Strong ones stand on their own; weak
  // ones are kept only if the reader agrees the word means that entry, and
  // are otherwise asked of the writer ("Worth a look").
  // Each: { kind, strength, id, attr, fact, start, end, to, si, ref?, initials? }.
  // a paragraph as referent() reads it: its mentions, sentences, words
  // (`initial`: opening a sentence or a quote) and speech
  function paraCtx(text, idx, world) {
    const sents = sentences(text);
    const pwords = [];
    sents.forEach((s, si) => {
      for (const m of s.text.matchAll(WORD)) {
        const start = s.start + m.index;
        const lead = text.slice(s.start, start);
        pwords.push({ w: m[0], lw: m[0].toLowerCase().replace(/['’]s$/, ''), start, end: start + m[0].length, si, initial: !/[\p{L}\p{N}]/u.test(lead) || /[“"‘«„—–:(]\s*$/u.test(lead) });
      }
    });
    return { every: mentions(text, idx), pwords, sents, world, speech: talkSpans(text) };
  }
  // "hair was cropped close to the skull and fair as wet straw": a colour
  // further on in the same clause, said of the hair itself (followed by the
  // clause's end, "as", "and", "or" or "like"; not "a red ribbon")
  function predicativeColour(words, from, text) {
    for (let k = from; k < words.length && k < from + 10; k++) {
      if (/[,;:—–()"“”]/.test(text.slice(words[k - 1].end, words[k].start))) return null;
      const w = words[k];
      if (!COLOURS[w.lw]) continue;
      const prev = words[k - 1];
      if (['a', 'an', 'the', 'her', 'his', 'its', 'their', 'some', 'with', 'of'].includes(prev.lw)) return null;
      const next = words[k + 1];
      const gap = next ? text.slice(w.end, next.start) : '';
      if (!next || /[,;:.!?—–]/.test(gap) || ['as', 'and', 'or', 'like', 'now'].includes(next.lw)) return w;
      return null;
    }
    return null;
  }
  function paraCandidates(text, idx, world, names) {
    const ctx = paraCtx(text, idx, world);
    const { every, sents, speech } = ctx;
    const free = (a, b) => !speech.some(([s, e]) => a < e && b > s);
    const all = every.filter((m) => free(m.start, m.end));
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
        // E … his: the nearest owning pronoun after a sexed entry, in its
        // clause; not after E's (in "Bramble's rider lost his hat" the
        // rider owns the hat)
        if (k.sex && !/^['’]s\b/.test(text.slice(m.end))) {
          for (let i = after(m.end), n = 0, from = m.end; i >= 0 && i < words.length && n < 6; i++, n++) {
            const w = words[i];
            if (/[,;:—–()"“”]/.test(text.slice(from, w.start)) || named(w) || (/^\p{Lu}/u.test(w.w) && w.w !== 'I' && !PRONOUNS[w.lw])) break;
            from = w.end;
            if (CLAUSE.has(w.lw)) break;
            const kind = pronounAt(words, i, text);
            if (!kind) continue;
            // ("The weigher took her right thumb": after a verb, the owner
            // may be the one acted on; after "on", "in", "with"… the subject)
            const prevW = i > 0 && words[i - 1].start >= m.end ? words[i - 1] : null;
            if (OWNING.has(kind) && ['her', 'his'].includes(w.lw) && prevW && HANDLING.test(prevW.lw)) break;
            if (OWNING.has(kind) && PRONOUNS[w.lw] !== k.sex.value) add({ kind: 'pronoun', strength: 'strong', id: m.id, attr: 'sex', fact: k.sex, start: w.start, end: w.end, to: swapPronoun(w.w, kind) });
            break;
          }
        }
        // E, the grey mare / E — mare / E was the only woman: an
        // appositive or a predicate naming its sex or species. The noun
        // heads the phrase (not "a stallion's rival"), an appositive's
        // closes it (not "the man who sold bread") and doesn't start a list
        // ("Bramble, the dog and the hens"), and it fits what E is: a mare
        // is no person, a woman no creature.
        let j = after(m.end);
        const sep = j >= 0 ? text.slice(m.end, words[j].start) : '';
        const is = j >= 0 && /^\s+$/.test(sep) && (words[j].lw === 'is' || words[j].lw === 'was');
        if (is) j++;
        const det = (w) => w && (['the', 'a', 'an', 'his', 'her', 'their'].includes(w.lw) || /^\p{Lu}.*['’]s$/u.test(w.w));
        const art = det(words[j]);
        if (j >= 0 && (is ? art : /^,\s+$/.test(sep) ? art : /^\s*[—–]\s*$/.test(sep))) {
          const from = art ? j + 1 : j;
          const n = words.slice(from, from + 3).findIndex((w) => SEX_WORDS[w.lw] || SPECIES[w.lw]);
          let noun = n >= 0 ? words[from + n] : null;
          const tail = noun ? text.slice(noun.end) : '';
          if (noun && (words.slice(from, from + n + 1).some((w) => /['’]s$/.test(w.w)) || (!is && (!/^\s*(?:[,;:.!?)—–]|$)/.test(tail) || /^\s*,\s*(?:and|or|nor)\b/i.test(tail))))) noun = null;
          const animal = noun && SEX_WORDS[noun.lw] ? !!SEX_WORDS[noun.lw][2] : !!noun;
          if (noun && ((k.e.kind === 'person' && animal) || (k.e.kind === 'creature' && !animal))) noun = null;
          if (noun) {
            const sw = SEX_WORDS[noun.lw];
            if (sw && k.sex && sw[0] !== k.sex.value) add({ kind: 'noun', strength: 'strong', id: m.id, attr: 'sex', fact: k.sex, start: noun.start, end: noun.end, to: keepCase(noun.w, sw[1]) });
            else if (SPECIES[noun.lw] && k.species && SPECIES[noun.lw] !== k.species.value) add({ kind: 'species', strength: 'strong', id: m.id, attr: 'species', fact: k.species, start: noun.start, end: noun.end, to: keepCase(noun.w, k.species.value) });
          }
        }
        // Tamsin, the elder: a kin word against the sibling fact (weak);
        // not after E's ("Mara's elder brother" is the brother's)
        for (const f of /^['’]s\b/.test(text.slice(m.end)) ? [] : k.rel.filter((x) => x.attr === 'sibling' && KIN_SWAP[x.as])) {
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
      // the first he/she/his/her of a sentence naming no one, against the
      // one sexed entry named earlier in the paragraph (weak only: the
      // reader, or nobody, decides)
      const pi = inS.length ? -1 : words.findIndex((w) => PRONOUNS[w.lw] && w.lw !== 'hers');
      if (pi >= 0 && !out.some((c) => c.start === words[pi].start)) {
        const w = words[pi];
        const r = referent(text, w.start, si, ctx, PRONOUNS[w.lw]);
        if (r && r.k.sex && PRONOUNS[w.lw] !== r.k.sex.value) add({ kind: 'pronoun', strength: 'weak', id: r.id, attr: 'sex', fact: r.k.sex, start: w.start, end: w.end, to: swapPronoun(w.w, pronounAt(words, pi, text)), initials: r.initials });
      }

      words.forEach((w, i) => {
        // the stallion, when the horse in the last few sentences is a mare (weak)
        const sw = SEX_WORDS[w.lw];
        if (sw && sw[2] && i > 0 && words[i - 1].lw === 'the' && !inS.some((m) => world.get(m.id).species && world.get(m.id).species.value === sw[2])) {
          const seen = all.filter((m) => m.start >= sents[Math.max(0, si - 3)].start && m.end <= w.start && world.get(m.id).species && world.get(m.id).species.value === sw[2]);
          const last = seen.length && world.get(seen[seen.length - 1].id);
          if (last && last.sex && last.sex.value !== sw[0] && !seen.some((m) => world.get(m.id).sex && world.get(m.id).sex.value === sw[0])) {
            add({ kind: 'noun', strength: 'weak', id: last.e.id, attr: 'sex', fact: last.sex, start: w.start, end: w.start + w.w.replace(/['’]s$/, '').length, to: keepCase(w.w, last.sex.as && SEX_WORDS[last.sex.as] && SEX_WORDS[last.sex.as][2] === sw[2] ? last.sex.as : sw[1]) });
          }
        }
        // brown eyes / eyes were brown, of the one entry the sentence names
        if (['eyes', 'eye', 'hair'].includes(w.lw)) {
          const attr = w.lw === 'hair' ? 'hair' : 'eyes';
          const ids = [...new Set(inS.map((m) => m.id))];
          let c = i > 0 && COLOURS[words[i - 1].lw] && /^[\s-]+$/.test(text.slice(words[i - 1].end, w.start)) ? words[i - 1] : null;
          if (!c && words[i + 1] && COPULA.has(words[i + 1].lw)) c = words.slice(i + 2, i + 5).find((x) => COLOURS[x.lw]) || predicativeColour(words, i + 2, text);
          // whose: the name's possessive right before ("Ilsa's brown eyes"),
          // or the one entry the sentence names when "her"/"his" agrees with
          // it; "the child's brown eyes" and "brown eyes in the dark" are no one's
          const det = words[(c && c.end <= w.start ? i - 1 : i) - 1];
          const sole = ids.length === 1 && inS[0].end <= w.start && world.get(inS[0].id);
          const agrees = det && sole && (det.lw === 'her' || det.lw === 'his') && (!sole.sex || PRONOUNS[det.lw] === sole.sex.value);
          // or a note's line: "Ilsa: grey eyes, born in Saltmere"
          const head = c && inS[0] && inS[0].start === s.start && /^\s*(?::|[—–]\s)/.test(text.slice(inS[0].end)) && !inS.some((m) => m !== inS[0] && m.start < c.start) ? inS[0] : null;
          // or the sentence's subject has them: "John has green eyes", "Mara had red hair"
          const haver = c && c.end <= w.start && inS.find((m) => {
            const j = after(m.end);
            return j >= 0 && ['has', 'had'].includes(words[j].lw) && /^\s+$/.test(text.slice(m.end, words[j].start)) && words[j].end <= c.start && i - j <= 3 && !words.slice(j + 1, i).some(named);
          });
          const owner = inS.find((m) => /^['’]s\s/.test(text.slice(m.end, m.end + 3)) && after(m.end + 2) >= i - 1 && after(m.end + 2) <= i) || (agrees && inS[0]) || head || haver;
          const k = owner && world.get(owner.id);
          if (k && k[attr] && c && COLOURS[c.lw] !== k[attr].value) add({ kind: 'colour', strength: 'strong', id: owner.id, attr, fact: k[attr], start: c.start, end: c.end, to: keepCase(c.w, colourWord(k[attr])) });
          // or, in a sentence naming no one, "his blue eyes" of the one person
          // the paragraph named before: strong when the entry's sex agrees,
          // close by; weak when its sex isn't known, or it's "their"
          else if (c && !inS.length && det && ['his', 'her', 'their'].includes(det.lw)) {
            const r = referent(text, det.start, si, ctx, PRONOUNS[det.lw]);
            const f = r && r.k[attr];
            const agree = r && r.k.sex && det.lw !== 'their' ? PRONOUNS[det.lw] === r.k.sex.value : null;
            if (f && agree !== false && COLOURS[c.lw] !== f.value) {
              add({ kind: 'colour', strength: agree && !r.weak ? 'strong' : 'weak', id: r.id, attr, fact: f, start: c.start, end: c.end, to: keepCase(c.w, colourWord(f)), ref: { start: det.start, end: det.end }, initials: r.initials });
            }
          }
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
  // `story` (storyIndex), `rank` (book/ch → place in reading order) and
  // `rare` (rarity) let the reader check a sentence against the story's
  // key points (STORY.md §5); without them, or a reader, it isn't.
  async function checkSources({ sources, entries, notSlips = [], reader = null, knownWords = null, out = {}, onSource = null, stop = null, paraOk = null, story = null, rank = null, rare = null, open = null }) {
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
      // (and a sentence's first word between "John" and "his" must be a word, not a name)
      const lower = [...new Set(found.flatMap((x) => (x.c.initials || []).map((w) => w.toLowerCase())))];
      const known = (odd.length || lower.length) && knownWords ? await knownWords([...odd, ...lower]) : {};
      for (const { c, p, s } of found) {
        if (c.kind === 'name' && (!knownWords || known[c.word] !== false)) continue;
        if ((c.initials || []).some((w) => known[w.toLowerCase()] === false)) continue;
        const e = byId.get(c.id);
        const key = c.fact ? factKey(e, c.fact) : `${e.id}/name`;
        const sentenceHash = textHash(norm(s.text));
        if (dismissed.has(key + '|' + sentenceHash)) continue;
        const span = p.text.slice(c.start, c.end);
        // the word whose meaning is in doubt: "his", for "his blue eyes"
        const ref = c.ref ? p.text.slice(c.ref.start, c.ref.end) : span;
        let ask = false;
        if (c.strength === 'weak') {
          // the reader says yes (a slip), no (dropped) or can't tell; with
          // no reader, or one not asked this ("he", for the quick reader),
          // the writer is asked instead: Worth a look. Not a lone pronoun
          // with no reader, though: "John came in. She…" is nearly always
          // someone else, and asking each time would be noise.
          const others = [...new Set(mentions(p.text, idx).map((m) => m.id))].filter((id) => id !== e.id).map((id) => byId.get(id).name);
          const said = reader ? await reader.refers({ sentence: s.text, span: ref, entity: e.name, paragraph: p.text, others }) : 'unasked';
          if (said === 'no') continue;
          if (said !== 'yes') {
            if (said !== 'unclear' && c.kind === 'pronoun') continue;
            ask = true;
          }
        }
        const srcs = c.fact ? c.fact.sources.filter((x) => !x.written) : [];
        slips.push({
          seq: all.length + slips.length, bookId: src.bookId, chId: src.chId, book: src.book, label: src.label, para: p.hash, sentence: s.text, sat: s.start, sentenceHash, at: c.start, span, to: c.to || null,
          kind: c.kind, strength: c.strength, entry: e.id, name: e.name, attr: c.attr, value: c.fact ? c.fact.value : e.name, as: c.fact ? c.fact.as : '',
          fact: key, sources: srcs.slice(0, 2).map((x) => ({ label: x.label, quote: x.quote })), more: Math.max(0, srcs.length - 2),
          written: !!(c.fact && c.fact.sources.some((x) => x.written)),
          ...(ask ? { ask: true, ref } : {})
        });
      }
      if (story && story.length && rank && rare && reader && typeof reader.contradicts === 'function') {
        const paras = sourceParas(src.html);
        for (const [j, p] of paras.entries()) {
          if (stop && stop()) break;
          if (paraOk && !paraOk(src, p)) continue;
          for (const x of await deedSlips({ src, p, pos: rank.get(src.bookId + '/' + src.chId) * 1e4 + j, idx, byId, story, rare, reader, dismissed })) slips.push({ ...x, seq: all.length + slips.length });
        }
      }
      // what the story bible keeps in its own words (open facts), said otherwise later
      if (open && open.length && rank && rank.has(src.bookId + '/' + src.chId) && Editor) {
        const paras = sourceParas(src.html);
        for (const [j, p] of paras.entries()) {
          if (stop && stop()) break;
          if (paraOk && !paraOk(src, p)) continue;
          for (const x of await openSlips({ src, p, pos: rank.get(src.bookId + '/' + src.chId) * 1e4 + j, idx, byId, open, reader, dismissed })) slips.push({ ...x, seq: all.length + slips.length });
        }
      }
      all.push(...slips);
      if (onSource) onSource(src, slips, ++n, sources.length);
    }
    // the slips, and apart from them the ones worth a look (`ask`)
    return { slips: all.filter((x) => !x.ask), asks: all.filter((x) => x.ask), facts };
  }

  // A sentence that gives an earlier key point's deed to someone else
  // ("It was Dave who touched the vortex", after John reached through it):
  // the stored points sharing a distinctive word with it, earlier in
  // reading order, whose who it doesn't name as the doer, asked of the
  // reader with both passages. yes: a slip on the name; unclear, or a
  // reader not asked (the quick one): worth a look; no: nothing.
  async function deedSlips({ src, p, pos, idx, byId, story, rare, reader, dismissed }) {
    const out = [];
    const talk = talkSpans(p.text);
    const every = mentions(p.text, idx).filter((m) => !talk.some(([a, b]) => m.start < b && m.end > a));
    const names = new Set([...byId.values()].flatMap((e) => [e.name, ...e.aliases]).flatMap(wordsOf).map(stemOf));
    for (const s of sentences(p.text)) {
      // a plan, or what someone says, believes or is told: not the story's word
      if (PLAN.test(s.text) || reportedSpans(p.text).some(([a, b]) => a < s.end && b > s.start)) continue;
      // the narrator's words only: what someone says or is said to have done is talk
      const plain = s.text.split('').map((ch, k) => talk.some(([a, b]) => s.start + k >= a && s.start + k < b) ? ' ' : ch).join('');
      const own = new Set(heavy(plain).map(stemOf).filter((w) => rare(w) && !names.has(w)));
      if (!own.size) continue;
      const here = every.filter((m) => m.start >= s.start && m.end <= s.end && byId.get(m.id) && ['person', 'creature'].includes(byId.get(m.id).kind));
      if (!here.length) continue;
      for (const ev of story) {
        // two distinctive words shared, or one found nowhere else ("vortex"),
        // or one with a deed of the same kind (a crust pressed into her hand;
        // the crust the warden had given her)
        const shared = [...ev.words].filter((w) => own.has(w));
        if (ev.pos >= pos || !(shared.length >= 2 || shared.some((w) => rare.only(w)) || (shared.length && sameDeed(ev.words, heavy(plain).map(stemOf))))) continue;
        // the one the sentence puts first is its doer; the doer named first
        // is let past only by a "not" ("It wasn't John, it was Dave")
        const other = here.find((m) => !ev.ids.includes(m.id));
        if (!other || (ev.ids.includes(here[0].id) && !/\b(?:not|never|wasn['’]t|weren['’]t|didn['’]t|n['’]t)\b/i.test(s.text))) continue;
        const named = here.some((m) => ev.ids.includes(m.id));
        const fact = `${ev.ids[0]}/event/${textHash(norm(ev.quote)).split(':')[0]}`;
        const sentenceHash = textHash(norm(s.text));
        if (dismissed.has(fact + '|' + sentenceHash)) continue;
        // the one question each passage is asked: who did it ("who gave the crust?")
        const kind = deedKind(ev.words, heavy(plain).map(stemOf));
        const thing = shared.length && (heavy(plain).find((w) => stemOf(w) === shared[0]) || shared[0]);
        const question = kind && thing ? `who ${kind} the ${thing}` : 'who ' + ev.did.replace(new RegExp('^\\s*' + ev.names[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '');
        const others = [...new Set(here.map((m) => byId.get(m.id).name))].filter((n) => n !== ev.names[0]);
        let said = await reader.contradicts({ a: ev.quote, label: ev.label, who: ev.names[0], did: ev.did, sentence: s.text, paragraph: p.text, question, others, kind: kind && thing ? kind : null });
        if (said === 'no') continue;
        // a sentence that names the doer too ("Dave remembered John…") is a
        // slip only on the reader's yes, never worth a look
        if (said !== 'yes' && named) continue;
        if (said !== 'yes') said = 'ask';
        const span = p.text.slice(other.start, other.end);
        // the plain fix: the one name, written once, swapped for the doer's
        const who = byId.get(ev.ids[0]);
        const form = /\s/.test(span) ? who.name : (nameParts(who.name).find((w) => hasWord(norm(ev.quote + ' ' + ev.did), norm(w))) || who.name.split(/\s+/)[0]);
        const once = here.filter((m) => m.id === other.id).length === 1 && ev.ids.length === 1;
        out.push({
          bookId: src.bookId, chId: src.chId, book: src.book, label: src.label, para: p.hash, sentence: s.text, sat: s.start, sentenceHash, at: other.start, span,
          to: once && form !== span ? form : null, kind: 'event', strength: 'weak', entry: who.id, name: who.name, attr: 'event', value: ev.did, as: '', fact,
          sources: [{ label: ev.label, quote: ev.quote }], more: 0, written: false, note: true,
          ...(said === 'ask' ? { ask: true, ref: span } : {})
        });
        break;
      }
    }
    return out;
  }

  // The story bible's own words, said otherwise later (READING.md §1 pass 5):
  // a sentence that names one (or opens with the pronoun the paragraph's
  // rules give it), against its kept open facts from earlier in reading
  // order. Code finds the candidates (Editor.clashCandidate: "not one
  // window" / "high windows"); the reader is asked both ways round. yes: a
  // slip on B's words; unclear, or the quick reader: worth a look; no, or
  // no reader: nothing. Never in speech, a plan, a belief or a question.
  function openIndex(entries, sources, rank) {
    const out = [];
    for (const e of entries) {
      for (const f of e.facts) {
        if (!(f.attr === 'other' || f.attr === 'state') || !['verified', 'yours'].includes(f.state)) continue;
        const s = f.sources.find((x) => !x.written && !x.changed && !x.said && !x.plan && rank.has(x.book + '/' + x.ch));
        if (!s) continue;
        const i = rank.get(s.book + '/' + s.ch);
        const para = sourceParas(sources[i].html).findIndex((p) => norm(p.text).includes(norm(s.quote)));
        if (para < 0) continue;
        out.push({ e, f, quote: s.quote, label: s.label, pos: (isNote(sources[i]) ? NOTE_AT : 0) + i * 1e4 + para });
      }
    }
    return out;
  }
  async function openSlips({ src, p, pos, idx, byId, open, reader, dismissed }) {
    const out = [];
    const talk = talkSpans(p.text);
    const every = mentions(p.text, idx).filter((m) => !talk.some(([a, b]) => m.start < b && m.end > a));
    const sents = sentences(p.text);
    for (const [si, s] of sents.entries()) {
      if (PLAN.test(s.text) || talk.some(([a, b]) => a < s.end && b > s.start)) continue;
      const here = every.filter((m) => m.start >= s.start && m.end <= s.end);
      // (a sentence opening with he or she: the one person the paragraph named last, before it)
      const ids = [...new Set(here.map((m) => m.id))];
      const lead = /^\s*(he|she|his|her)\b/i.exec(s.text);
      if (!ids.length && lead && si > 0) {
        const before = every.filter((m) => m.end <= s.start && byId.get(m.id) && ['person', 'creature'].includes(byId.get(m.id).kind));
        if (before.length) ids.push(before[before.length - 1].id);
      }
      for (const id of ids) {
        const e = byId.get(id);
        for (const o of open) {
          if (o.e.id !== id || o.pos >= pos) continue;
          const detail = Editor.clashDetail(o.f, o.quote, s.text, [e.name, ...e.aliases]);
          if (!detail) continue;
          const span = detail.span;
          const fact = factKey(o.e, o.f);
          const sentenceHash = textHash(norm(s.text));
          if (dismissed.has(fact + '|' + sentenceHash)) continue;
          const fact1 = `${labelOf(o.f)}: ${o.f.value}`;
          const said = reader && typeof reader.clash === 'function' ? await reader.clash({ name: e.name, a: o.quote, label: o.label, fact: fact1, sentence: s.text, paragraph: p.text, question: detail.q }) : null;
          if (!said || said === 'no') continue;
          const at = s.start + s.text.indexOf(span);
          out.push({
            bookId: src.bookId, chId: src.chId, book: src.book, label: src.label, para: p.hash, sentence: s.text, sat: s.start, sentenceHash, at, span,
            to: null, kind: 'open', strength: 'weak', entry: e.id, name: e.name, attr: 'other', value: o.f.value, as: labelOf(o.f), fact,
            sources: o.f.sources.filter((x) => !x.written).slice(0, 2).map((x) => ({ label: x.label, quote: x.quote })), more: 0, written: o.f.state === 'yours',
            ...(said !== 'yes' ? { ask: true, ref: span } : {})
          });
          break;
        }
        if (out.some((x) => x.sat === s.start)) break;
      }
    }
    return out;
  }

  // Sentences of a chapter a slip may stand on, before the chapter is read
  // the editor's way (READING.md §1): a value its facts must not be read
  // from. A trait that differs from one already kept ("her black hair"), an
  // open fact said otherwise, a deed already someone else's. Found by the
  // checkers' own candidates (no reader): a fact from such a sentence is
  // left out quietly; the pass decides whether it is a slip.
  // `kept`: [{ e, f }] read earlier in this read (not yet through the gates).
  function editorSuspects({ paras, entries, kept = [], told = [], rare = null }) {
    const ids = new Set();
    const live = entries.filter((e) => !e.locked);
    const idx = mentionIndex(live);
    // traits: the first value each entry has, kept or read
    const world = new Map(live.map((e) => [e.id, { e, rel: [] }]));
    const firm = (f) => ['verified', 'yours'].includes(f.state);
    for (const e of live) {
      for (const attr of Object.keys(TIED)) {
        const f = e.facts.find((x) => x.attr === attr && firm(x) && lexical(x)) || (kept.find((k) => k.e === e && k.f.attr === attr) || {}).f;
        if (f) world.get(e.id)[attr] = f;
      }
    }
    const names = nameTokens(live);
    let n = 0;
    const model = paras.map((p) => { const ss = sentences(p.text).map((x) => ({ ...x, id: ++n })); return { p, ss }; });
    for (const { p, ss } of model) {
      for (const c of paraCandidates(p.text, idx, world, names)) if (c.kind !== 'name' && ss[c.si]) ids.add(ss[c.si].id);
    }
    // open facts said otherwise: earlier ones, of the one a sentence names
    const opens = [...live.flatMap((e) => e.facts.filter((f) => (f.attr === 'other' || f.attr === 'state') && firm(f)).map((f) => ({ e, f }))), ...kept.filter((k) => k.f.attr === 'other' || k.f.attr === 'state')];
    // deeds: an earlier key point's distinctive words, with someone else named
    const deeds = told.map((ev) => ({ ids: ev.who.map((w) => w.id), words: new Set(heavy(ev.did + ' ' + ev.quote).map(stemOf)) }));
    const nameStems = new Set(live.flatMap((e) => [e.name, ...e.aliases]).flatMap(wordsOf).map(stemOf));
    for (const { p, ss } of model) {
      const talk = talkSpans(p.text);
      const every = mentions(p.text, idx).filter((m) => !talk.some(([a, b]) => m.start < b && m.end > a));
      for (const s of ss) {
        const here = every.filter((m) => m.start >= s.start && m.end <= s.end);
        for (const { e, f } of opens) {
          if (!here.some((m) => m.id === e.id)) continue;
          const q = (f.sources.find((x) => !x.written) || {}).quote || '';
          if (Editor.clashCandidate(f, q, s.text, [e.name, ...e.aliases])) ids.add(s.id);
        }
        if (rare && deeds.length) {
          const own = new Set(heavy(s.text).map(stemOf).filter((w) => rare(w) && !nameStems.has(w)));
          const people = here.filter((m) => { const x = live.find((y) => y.id === m.id); return x && ['person', 'creature'].includes(x.kind); });
          for (const d of deeds) {
            const shared = [...d.words].filter((w) => own.has(w));
            if (!(shared.length >= 2 || shared.some((w) => rare.only(w)) || (shared.length && sameDeed(d.words, heavy(s.text).map(stemOf))))) continue;
            if (people.some((m) => !d.ids.includes(m.id))) ids.add(s.id);
          }
        }
      }
    }
    return ids;
  }

  /* ---------- reading ---------- */

  // Bumped when the prompts change, so cached proposals are asked again
  const PROMPT = 2;
  const STORY_PROMPT = 1;
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
    // "The Salt Law" kept by hand is the reader's "Salt Law", and the other way round
    const is = (a) => norm(a) === n || norm(stripTitles(a)) === n;
    const whole = entries.find((e) => is(e.name) || e.aliases.some(is));
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
  // Does the text say this of this entry, by the slip checker's own rules?
  // Run against the opposite of the fact, the checker must flag a word in
  // it, for this entry, that means the fact's value: "Bramble, the grey
  // mare" says Bramble is a mare; "Bramble stood beside the stallion" says
  // nothing of Bramble, and "Tamsin led her own horse" nothing of the horse.
  const TIED = { sex: (w, kind) => kind === 'pronoun' ? PRONOUNS[w] : SEX_WORDS[w] && SEX_WORDS[w][0], species: (w) => SPECIES[w], eyes: (w) => COLOURS[w], hair: (w) => COLOURS[w] };
  // (`loose`, for letting a reading in to be checked: a pronoun, and the
  // weak cases too, like "He" opening the next sentence)
  function tiedTo(e, f, text, entries, loose) {
    if (!TIED[f.attr] || !entries.includes(e)) return false;
    const world = new Map(entries.map((x) => [x.id, { e: x, rel: [] }]));
    world.get(e.id)[f.attr] = { value: '\u0000', as: '', sources: [] };
    return paraCandidates(text, mentionIndex(entries), world, []).some((c) => c.id === e.id && c.attr === f.attr &&
      (loose || (c.strength === 'strong' && c.kind !== 'pronoun')) && TIED[f.attr](text.slice(c.start, c.end).toLowerCase().replace(/['’]s$/, ''), c.kind) === f.value);
  }

  // the value is in the quote itself, or a word the lexicon ties to it (a
  // pronoun only when it's the entry's own: "Bramble tossed her head")
  function valueInQuote(f, quote, e, entries) {
    const w = new Set(wordsOf(quote).map((x) => x.replace(/'s$/, '')));
    const any = (test) => [...w].some(test);
    if (f.attr === 'sex') return any((x) => SEX_WORDS[x] && SEX_WORDS[x][0] === f.value) || (!!e && tiedTo(e, f, quote, entries, true));
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
    // a quote inside a quotation, or touching reported speech, is talk
    return { said: speechSpans(text).some(([s, e]) => a >= s && b <= e + 1) || reportedSpans(text).some(([s, e]) => a < e && b > s), plan: /\?|\b(?:what if|maybe|perhaps)\b/i.test(sent) };
  }

  // One proposal through the gates, into its entry. Every way it can fail
  // drops it: a quote not in the source (P0 #7), an entity not named in it,
  // its paragraph or the one before (which the reader saw too), a value the
  // quote doesn't hold, a value the writer already said is not right.
  // The shelf's full names: two capitalised words together, neither a
  // title nor a word the shelf also writes in lower case ("Then Ilsa" is no
  // name). → Map one part (lower case) → Set of full names
  // Words that open a sentence and are no part of a name after them
  const LEADERS = new Set(['then', 'now', 'so', 'but', 'and', 'or', 'yet', 'still', 'soon', 'later', 'there', 'here', 'after', 'afterwards', 'before', 'once', 'when', 'while', 'whilst', 'if', 'as', 'because', 'since', 'until', 'till', 'though', 'although', 'where', 'why', 'how', 'what', 'who', 'whom', 'whose', 'which', 'meanwhile', 'today', 'tonight', 'tomorrow', 'yesterday', 'outside', 'inside', 'even', 'only', 'just', 'again', 'instead', 'besides', 'also', 'perhaps', 'maybe', 'surely', 'thus', 'hence', 'indeed', 'nor', 'neither', 'either', 'both', 'all', 'every', 'each', 'some', 'many', 'few', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'our', 'your', 'its', 'my', 'did', 'does', 'had', 'has', 'was', 'were', 'is', 'are', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'not', 'never', 'always', 'often', 'sometimes', 'oh', 'ah', 'yes', 'well', 'with', 'without', 'for', 'from', 'by', 'at', 'on', 'in', 'into', 'to', 'of', 'like', 'unlike', 'beside', 'behind', 'above', 'below', 'under', 'over', 'past', 'near', 'tell', 'ask', 'let', 'make', 'get', 'go', 'come', 'see', 'look', 'poor', 'dear', 'good', 'next', 'last', 'first', 'an', 'a',
    'suddenly', 'finally', 'slowly', 'quickly', 'quietly', 'eventually', 'gradually', 'instantly', 'immediately', 'luckily', 'unluckily', 'fortunately', 'unfortunately',
    'clearly', 'certainly', 'obviously', 'naturally', 'presumably', 'apparently', 'honestly', 'frankly', 'briefly', 'carefully', 'gently', 'softly', 'silently',
    'usually', 'normally', 'actually', 'really', 'recently', 'lately', 'nearly', 'merely', 'simply', 'surely', 'likely', 'possibly', 'probably', 'abruptly',
    'swiftly', 'hastily', 'reluctantly', 'sadly', 'happily', 'strangely', 'oddly', 'curiously', 'inevitably', 'initially', 'ultimately', 'originally', 'later',
    'somehow', 'somewhere', 'nowhere', 'anyway', 'otherwise', 'however', 'therefore', 'moreover', 'furthermore', 'nevertheless', 'nonetheless', 'already', 'almost', 'together', 'alone', 'beyond', 'across', 'along', 'around', 'during', 'upon', 'against', 'between', 'among', 'through', 'throughout', 'within', 'despite']);
  function shelfNames(texts) {
    const lower = new Set();
    for (const t of texts) for (const m of t.matchAll(/(?<![\p{L}'’])\p{Ll}[\p{L}\p{M}]*/gu)) lower.add(m[0]);
    const out = new Map();
    out.lower = lower;
    out.count = (w) => texts.reduce((n, t) => n + (t.match(new RegExp(`(?<![\\p{L}\\p{M}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'gu')) || []).length, 0);
    for (const t of texts) {
      // (overlapping: "Captain Ilsa Varr" holds "Ilsa Varr")
      for (const m of t.matchAll(/(?<![\p{L}\p{M}'’-])(\p{Lu}[\p{Ll}\p{M}]{2,})(?=\s+(\p{Lu}[\p{Ll}\p{M}]{2,})(?![\p{L}\p{M}]))/gu)) {
        const parts = [m[1], m[2]];
        if (parts.some((w) => TITLES.has(w.toLowerCase()) || lower.has(w.toLowerCase()))) continue;
        // a sentence's first word is capitalised anyway: "Then Mara", "Suddenly
        // Mara" is Mara, even on a shelf that never writes "then" in lower case
        if (LEADERS.has(m[1].toLowerCase())) continue;
        for (const w of parts) {
          if (!out.has(w.toLowerCase())) out.set(w.toLowerCase(), new Set());
          out.get(w.toLowerCase()).add(parts.join(' '));
        }
      }
    }
    return out;
  }

  // Places the shelf names plainly: a capitalised word after in, at, to,
  // from, below… three times or more, never written in lower case and no
  // part of a person's name. (So a misspelling of one can be seen for what
  // it is, whether or not the reader named the place.)
  function shelfPlaces(texts, names) {
    const count = new Map();
    for (const t of texts) {
      for (const m of t.matchAll(/(?<![\p{L}\p{M}])(?:in|at|to|from|of|below|above|near|towards?|through|into|past|beyond|outside)\s+(\p{Lu}[\p{Ll}\p{M}]{3,})(?![\p{L}\p{M}'’-])/gu)) {
        const w = m[1];
        if (names.lower.has(w.toLowerCase()) || names.has(w.toLowerCase()) || TITLES.has(w.toLowerCase())) continue;
        count.set(w, (count.get(w) || 0) + 1);
      }
    }
    return [...count].filter(([, n]) => n >= 3).map(([w]) => w);
  }

  const JOINS = new Set(['of', 'the', 'de', 'du', 'da', 'del', 'la', 'le', 'van', 'von', 'der', 'and', 'on', 'upon']);
  function accept(entries, prop, src, para, prev, full, names = new Map()) {
    // an entry is someone or something with a name: "the drover" is not one
    if (!prop || !prop.entity || !prop.quote) return;
    // "Then Mara" from a sentence's start is Mara
    const lead = String(prop.entity).trim().split(/\s+/);
    while (lead.length > 1 && LEADERS.has(lead[0].toLowerCase())) lead.shift();
    if (lead.join(' ') !== String(prop.entity).trim()) prop = { ...prop, entity: lead.join(' ') };
    if (!/^\p{Lu}/u.test(stripTitles(prop.entity))) return;
    const quote = gateQuote(prop.quote, full);
    if (!quote || !reaches(entries, prop.entity, quote, prev + '\n' + para.text)) return;
    let e = findEntry(entries, prop.entity);
    // one name for one person: the reader's "Varr" or "Ilsa" is the shelf's
    // "Ilsa Varr"; "Hale", which two people share, is no one in particular
    let name = stripTitles(prop.entity);
    if (!e && !/\s/.test(name) && names.has(name.toLowerCase())) {
      const all = names.get(name.toLowerCase());
      if (all.size > 1) return;
      name = [...all][0];
      e = findEntry(entries, name);
    }
    if (e && e.locked) return;
    let fresh = false;
    if (!e) {
      // a new name must be in the text as written ("Ponies" from "a string
      // of ponies" is no one), and not a slip of the pen for one already
      // there (Corwyck is Corwick misspelt, not a second town)
      const parts = name.split(/\s+/);
      if (!parts.every((w) => hasWord(prev + '\n' + para.text, w)) || misspelt(name, entries)) return;
      // a name's words are capitalised, but for small ones inside it ("House of
      // Varr"): "Keeper of Kellsharrow light" is a description
      if (!parts.every((w, i) => /^\p{Lu}/u.test(w) || (i > 0 && i < parts.length - 1 && JOINS.has(w)))) return;
      // nor a word the shelf writes in lower case too: "She", "Ponies"
      if (names.lower && parts.length === 1 && (names.lower.has(name.toLowerCase()) || PRONOUNS[name.toLowerCase()])) return;
      let id = slug(name);
      for (let n = 2; entries.some((x) => x.id === id); n++) id = slug(name) + '-' + n;
      e = newEntry(name, prop.kind, id);
      entries.push(e);
      fresh = true;
    }
    // a new entry stays only if what was said of it gets through
    const drop = () => { if (fresh && !e.facts.length) entries.splice(entries.indexOf(e), 1); };
    if (!prop.attr) return;
    if (!ATTRS[prop.attr]) return drop();
    const n = normaliseFact(prop.attr, prop.value, prop.asWritten);
    if (!n) return drop();
    // a single name as a value is the shelf's full one, if only one has it
    if (ATTRS[prop.attr].ref && !/\s/.test(n.value) && names.has && names.has(n.value.toLowerCase()) && names.get(n.value.toLowerCase()).size === 1) n.value = [...names.get(n.value.toLowerCase())][0];
    const ref = ATTRS[prop.attr].ref && findEntry(entries, n.value);
    // no one is their own owner, sister or home
    if (ATTRS[prop.attr].ref && (ref === e || norm(stripTitles(n.value)) === norm(stripTitles(e.name)))) return drop();
    const f = { attr: prop.attr, label: prop.attr === 'other' ? prop.label || 'Other' : undefined, value: ref ? ref.name : n.value, as: n.as, state: 'unverified', sources: [] };
    if (!valueInQuote(f, quote, e, entries)) return drop();
    // a place someone lives in or was born in, named on the shelf twice or
    // more, is an entry of its own (so "Corwyck" can be seen for the slip it
    // is); a name written once may be the slip itself
    if (!ref && (prop.attr === 'home' || prop.attr === 'birthplace') && names.count && !/\s/.test(f.value) && /^\p{Lu}/u.test(f.value)
      && !misspelt(f.value, entries) && !(names.lower || new Set()).has(f.value.toLowerCase()) && names.count(f.value) >= 2) {
      let id = slug(f.value);
      for (let k = 2; entries.some((x) => x.id === id); k++) id = slug(f.value) + '-' + k;
      entries.push(newEntry(f.value, 'place', id));
    }
    const where = quoteIn(quote, para.text);
    const source = { label: `${src.book}, ${src.label}`, quote, book: src.bookId, ch: src.chId };
    if (where.said) source.said = prop.said || true;
    if (where.plan) source.plan = true;
    const same = (a, b) => a.attr === b.attr && norm(a.value) === norm(b.value) && (a.attr !== 'other' || a.label === b.label);
    if (e.setAside.some((x) => x.state === 'not right' && same(x, f) && x.sources.some((s) => norm(s.quote) === norm(quote)))) return drop();
    // what someone says, once the writer decided it: It's true made it a
    // fact citing this passage; Only what's said set it aside with it
    if ((source.said || source.plan) && (e.facts.some((x) => same(x, f) && !talkOnly(x) && x.sources.some((s) => sameSrc(s, source)))
      || e.setAside.some((x) => same(x, f) && x.sources.some((s) => !s.written && norm(s.quote) === norm(quote))))) return drop();
    // what someone says, or a plan, is never a source of the story's own
    // fact, nor joins one: the trader's "that's a gelding" stays his
    const had = e.facts.find((x) => same(x, f) && talkOnly(x) === !!(source.said || source.plan));
    if (!had) { f.sources.push(source); e.facts.push(f); return; }
    if (!had.as && f.as) had.as = f.as;
    // the same passage twice (a whole sentence and a piece of it) is one source
    if (!had.sources.some((s) => s.book === source.book && s.ch === source.ch && (norm(s.quote).includes(norm(quote)) || norm(quote).includes(norm(s.quote))))) had.sources.push(source);
  }
  // a fact that rests only on speech or plans (the writer's own never does)
  const talkOnly = (f) => f.state !== 'yours' && !f.sources.some((s) => s.written) && f.sources.length > 0 && f.sources.every((s) => s.said || s.plan);

  const live = (s) => !s.written && !s.changed;
  const solid = (f) => f.state === 'yours' || f.sources.some((s) => live(s) && !s.said && !s.plan);

  // Checking by rule: the quote, not speech or a plan, ties a lexicon word
  // for the value to the entry the way a strong slip would (§8 cut 2; a
  // pronoun alone never checks a fact). Everything else, kin included, is
  // asked of the reader, one fact at a time; unsure stays unchecked.
  function ruleSupported(e, f, entries) {
    return f.sources.some((s) => live(s) && !s.said && !s.plan && tiedTo(e, f, s.quote, entries, false));
  }

  // A trait read from a sentence whose subject is a pronoun (the editor's
  // reading): "She was a narrow woman…", "Her hair was … fair as wet straw",
  // "her black hair". It counts when the pronoun is the entry's by the
  // paragraph's rules (referent, strong), or the reader said so when asked
  // whom it means (the careful readers only; the answer is kept in
  // canon.json `refs` against the sentence, so the next read and the next
  // device agree). Never in speech, a plan or a question.
  async function pronounTrait(e, f, src, para, entries, reader, refs) {
    if (!['person', 'creature'].includes(e.kind) || !['sex', 'hair', 'eyes'].includes(f.attr)) return false;
    const nm = normMap(para);
    const qa = nm.text.indexOf(norm(src.quote));
    if (qa < 0) return false;
    const a = nm.map[qa];
    const sents = sentences(para);
    const si = sents.findIndex((x) => x.end > a);
    const st = sents[si];
    if (!st || PLAN.test(st.text)) return false;
    const words = [...st.text.matchAll(WORD)].map((m) => ({ w: m[0], lw: m[0].toLowerCase().replace(/['’]s$/, ''), start: st.start + m.index, end: st.start + m.index + m[0].length }));
    let pron = null;
    if (f.attr === 'sex') {
      const w0 = words[0];
      if (!w0 || !['she', 'he'].includes(w0.lw) || !words[1] || !['was', 'is'].includes(words[1].lw) || PRONOUNS[w0.lw] !== f.value) return false;
      const noun = words.slice(2, 7).find((w) => SEX_WORDS[w.lw]);
      if (!noun || SEX_WORDS[noun.lw][0] !== f.value || !!SEX_WORDS[noun.lw][2] !== (e.kind === 'creature')) return false;
      // (the noun heads the phrase: "a narrow woman", not "a woman's coat")
      if (/^['’]s/.test(para.slice(noun.end))) return false;
      pron = w0;
    } else {
      const target = f.attr === 'hair' ? /^hair$/ : /^eyes?$/;
      for (let i = 1; i < words.length && !pron; i++) {
        if (!target.test(words[i].lw)) continue;
        const det = ['her', 'his'].includes(words[i - 1].lw) ? words[i - 1] : i > 1 && ['her', 'his'].includes(words[i - 2].lw) && COLOURS[words[i - 1].lw] ? words[i - 2] : null;
        if (!det) continue;
        const c = COLOURS[words[i - 1].lw] ? words[i - 1] : words[i + 1] && COPULA.has(words[i + 1].lw) ? predicativeColour(words.map((w) => ({ ...w, start: w.start - st.start, end: w.end - st.start })), i + 2, st.text) : null;
        if (c && COLOURS[c.lw] === f.value) pron = det;
      }
      // "He was a head shorter than she was and had black hair": the subject's
      if (!pron && words[0] && ['he', 'she'].includes(words[0].lw)) {
        for (let i = 2; i < words.length && !pron; i++) {
          if (!target.test(words[i].lw) || COLOURS[words[i - 1].lw] !== f.value) continue;
          const have = words.slice(Math.max(1, i - 4), i - 1).find((w) => ['had', 'has', 'with'].includes(w.lw));
          if (have && !/[;:]/.test(st.text.slice(0, have.start - st.start))) pron = words[0];
        }
      }
      if (!pron) return false;
    }
    if (talkSpans(para).some(([x, y]) => pron.start < y && pron.end > x)) return false;
    const live = entries.filter((x) => !x.locked);
    const idx = mentionIndex(live);
    const sexOf = (x) => { const g = x.facts.find((h) => h.attr === 'sex' && ['verified', 'yours'].includes(h.state)); return g ? { value: g.value } : undefined; };
    const world = new Map(live.map((x) => [x.id, { e: x, rel: [], ...(sexOf(x) ? { sex: sexOf(x) } : {}) }]));
    const r = referent(para, pron.start, si, paraCtx(para, idx, world), PRONOUNS[pron.lw]);
    if (r && r.id === e.id && !r.weak && (!r.k.sex || r.k.sex.value === PRONOUNS[pron.lw])) return true;
    const key = e.id + '|' + textHash(norm(st.text));
    if (refs && refs[key] !== undefined) return refs[key] === true;
    if (!reader || reader.tier === 'quick' || typeof reader.refers !== 'function') return false;
    const others = [...new Set(mentions(para, idx).map((m) => m.id))].filter((id) => id !== e.id).map((id) => live.find((x) => x.id === id).name);
    const said = await reader.refers({ sentence: st.text, span: pron.w, entity: e.name, paragraph: para, others });
    if (refs && (said === 'yes' || said === 'no')) refs[key] = said === 'yes';
    return said === 'yes';
  }

  /* ---------- story so far (docs/semantics/STORY.md) ---------- */

  // Words that carry no deed: never "invented", never what makes two
  // passages about the same thing
  const LIGHT = new Set([...STOP, 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'as', 'it', 'its', 'who', 'what', 'but', 'not', 'one', 'out', 'off', 'all', 'any', 'our', 'did', 'got', 'how', 'just', 'then', 'than', 'there', 'here', 'also', 'very', 'some', 'been', 'being', 'have', 'would', 'could', 'should', 'will', 'they', 'them', 'him', 'she', 'you', 'your', 'are', 'is', 'be', 'no', 'so', 'up', 'down', 'over', 'back', 'away', 'again', 'once', 'when', 'while', 'where', 'which', 'whose', 'only', 'even', 'still', 'more', 'most', 'much', 'many', 'such', 'own', 'other', 'another', 'each', 'every', 'something', 'someone', 'nothing', 'thing', 'things']);
  // (a suffix only off a word left with three letters: "red" stays red)
  const stemOf = (w) => { w = w.replace(/['’]s$/, ''); const m = /(?:ing|ed|es|s)$/.exec(w); return (m && m.index >= 3 ? w.slice(0, m.index) : w).slice(0, 5); };
  const heavy = (text) => wordsOf(text).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 3 && !LIGHT.has(w) && !PRONOUNS[w]);
  const MEMORY = /(?<![\p{L}])(?:remembered|remembers|recalled|recalls|recalling|remembering|dreamed|dreamt|dreams|imagined|imagines|pictured|wondered|thought of|thinking of)(?![\p{L}])/iu;
  const TALK_WORDS = /^(?:said|says|say|asked|asks|told|tells|called|calls|replied|answered|whispered|shouted|cried|muttered|heard|hears|thought|thinks|wondered)$/;
  const PLACE_WORDS = /^(?:in|at|on|by|near|under|inside|outside|beside|behind|across|through|into|onto|over|beneath|below|above|along|around|from)\s/i;

  // A name the reader gave that isn't an entry yet: one if the usual name
  // rules allow (as accept() does for facts), else null
  function newName(entries, name, text, names) {
    name = stripTitles(String(name || '').trim().split(/\s+/).filter((w, i, all) => !(i < all.length - 1 && LEADERS.has(w.toLowerCase()))).join(' '));
    if (!/^\p{Lu}/u.test(name)) return null;
    if (!/\s/.test(name) && names.has && names.has(name.toLowerCase())) {
      const all = names.get(name.toLowerCase());
      if (all.size > 1) return null;
      name = [...all][0];
    }
    const parts = name.split(/\s+/);
    if (!parts.every((w) => hasWord(text, w) && /^\p{Lu}/u.test(w)) || misspelt(name, entries)) return null;
    if (parts.length === 1 && (PRONOUNS[name.toLowerCase()] || LEADERS.has(name.toLowerCase()) || (names.lower && names.lower.has(name.toLowerCase())))) return null;
    return name;
  }

  // One event the reader proposed, through the gates (STORY.md §3): its
  // quote verbatim, not speech or a plan; each who an entry (or a name the
  // rules accept) named in the quote, or the one a pronoun in the quote
  // means by the paragraph's rule; every word of the line the writer's.
  // → { who: [entry], did, quote, fresh: [new entries] } or { why }
  function gateEvent(entries, ev, para, prev, full, names = new Map()) {
    if (!ev || !ev.quote || !ev.did || !Array.isArray(ev.who) || !ev.who.length || ev.who.length > 3) return { why: 'shape' };
    const quote = gateQuote(ev.quote, full);
    if (!quote || !norm(para.text).includes(norm(quote))) return { why: 'quote' };
    if (quote.split(/\s+/).length > 30) return { why: 'long' };
    const where = quoteIn(quote, para.text);
    if (where.said || where.plan) return { why: where.said ? 'said' : 'plan' };
    // (a quote that is mostly speech: “Hello,” John said.)
    const talk = talkSpans(para.text);
    const src = normMap(para.text);
    const qat = src.text.indexOf(norm(quote));
    const qa = src.map[qat];
    const qb = src.map[qat + norm(quote).length - 1] + 1;
    const outside = para.text.slice(qa, qb).split('').map((ch, k) => talk.some(([a, b]) => qa + k >= a && qa + k < b) ? ' ' : ch).join('');
    if (!heavy(outside).some((w) => !TALK_WORDS.test(w) && !/^\p{Lu}/u.test((outside.match(new RegExp(`(?<![\\p{L}])${w}`, 'iu')) || [''])[0]))) return { why: 'said' };
    // a memory, a dream, a thought is no deed of the story's now
    if (MEMORY.test(para.text.slice(Math.max(0, qa - 40), qb))) return { why: 'memory' };
    let did = one(ev.did).trim().replace(/[.;:,!?]+$/, '');
    if (!did || /["“”«»]/.test(did)) return { why: 'did' };
    // the sentences that hold the quote: the words a line may use
    const sents = sentences(para.text).filter((x) => x.end > qa && x.start < qb);
    const told = sents.map((x) => x.text).join(' ');
    const at = one(ev.where || '').trim().replace(/[.,;]+$/, '');
    const toldStems = new Set(heavy(told).map(stemOf));
    if (at && PLACE_WORDS.test(at) && !norm(did).includes(norm(at)) && heavy(at).length && heavy(at).every((w) => toldStems.has(stemOf(w)))) did += ' ' + at;
    if (did.split(/\s+/).length > 14) return { why: 'long' };
    // who: each an entry, or a name the rules let in
    const fresh = [];
    const who = [];
    const text = prev + '\n' + para.text;
    for (const name of ev.who) {
      let e = findEntry(entries, name) || fresh.find((x) => norm(x.name) === norm(stripTitles(name)));
      if (!e) {
        const n = newName(entries, name, text, names);
        if (!n) return { why: 'who' };
        e = findEntry(entries, n) || newEntry(n, 'person');
        if (!entries.includes(e)) fresh.push(e);
      }
      // someone who acts: a person, a creature, a group (not a place or a thing)
      if (e.locked || !['person', 'creature', 'group', 'other'].includes(e.kind)) return { why: 'who' };
      if (!who.includes(e)) who.push(e);
    }
    // each named in the quote, or the one its first pronoun means
    const all = [...entries, ...fresh];
    const idx = mentionIndex(all);
    const world = worldOf(all, {});
    const ctx = paraCtx(para.text, idx, world);
    const pr = ctx.pwords.find((w) => w.start >= qa && w.end <= qb && PRONOUNS[w.lw] && w.lw !== 'hers');
    for (const e of who) {
      const forms = [e.name, ...e.aliases, ...nameParts(e.name)].map(norm);
      if (forms.some((x) => hasWord(norm(quote), x))) continue;
      const r = pr && referent(para.text, pr.start, pr.si, ctx, PRONOUNS[pr.lw]);
      const k = r && world.get(r.id);
      if (!r || r.weak || r.id !== e.id || (k.sex && k.sex.value !== PRONOUNS[pr.lw])) return { why: 'who' };
    }
    // no word the writer didn't write: names from the paragraph, the rest from the quote's sentences
    const mine = new Set(who.flatMap((e) => [e.name, ...e.aliases]).flatMap(wordsOf));
    const near = new Set(wordsOf(text));
    const stems = new Set(heavy(told).map(stemOf));
    for (const m of did.matchAll(WORD)) {
      const w = norm(m[0]).replace(/['’]s$/, '');
      if (mine.has(w)) continue;
      if (/^\p{Lu}/u.test(m[0]) && m.index > 0 && !near.has(w)) return { why: 'invented' };
      if (w.length < 3 || LIGHT.has(w) || PRONOUNS[w]) continue;
      if (!stems.has(stemOf(w))) return { why: 'invented' };
    }
    return { who, did: did.charAt(0).toUpperCase() + did.slice(1), quote, fresh };
  }

  // Every key point on the shelf, once each, with all the entries it is
  // kept on, and where it is in reading order: [{ ids, names, did, quote,
  // book, ch, label, pos, key }]
  function storyIndex(entries, sources, rank) {
    const out = new Map();
    for (const e of entries) {
      for (const x of e.story || []) {
        const s = x.sources.find((y) => !y.written && !y.changed);
        if (!s || !rank.has(s.book + '/' + s.ch)) continue;
        const key = s.book + '/' + s.ch + '|' + norm(s.quote);
        if (!out.has(key)) {
          const i = rank.get(s.book + '/' + s.ch);
          const para = sourceParas(sources[i].html).findIndex((p) => norm(p.text).includes(norm(s.quote)));
          if (para < 0) continue;
          out.set(key, { ids: [], names: [], did: x.did, quote: s.quote, book: s.book, ch: s.ch, label: s.label, pos: i * 1e4 + para, key, words: new Set(heavy(x.did + ' ' + s.quote).map(stemOf)) });
        }
        const k = out.get(key);
        if (!k.ids.includes(e.id)) { k.ids.push(e.id); k.names.push(e.name); }
      }
    }
    return [...out.values()];
  }

  // Deeds of one kind: giving (gave, handed, pressed into), striking,
  // taking, opening, killing, finding. Two passages sharing a distinctive
  // thing and a deed of one kind may be one deed done by two people.
  const DEEDS = [['give', 'gave', 'given', 'gives', 'giving', 'hand', 'handed', 'press', 'pressed', 'pass', 'passed', 'slip', 'slipped', 'offer', 'offered', 'lend', 'lent', 'brought', 'bring', 'gift', 'gifted', 'save', 'saved'],
    ['hit', 'strike', 'struck', 'punch', 'punched', 'slap', 'slapped', 'kick', 'kicked', 'beat', 'beaten'], ['take', 'took', 'taken', 'steal', 'stole', 'stolen', 'grab', 'grabbed', 'snatch', 'snatched'],
    ['open', 'opened', 'unlock', 'unlocked', 'unbolt', 'unbolted'], ['kill', 'killed', 'murder', 'murdered', 'stab', 'stabbed', 'shot', 'shoot', 'drown', 'drowned'],
    ['find', 'found', 'discover', 'discovered'], ['write', 'wrote', 'written', 'sign', 'signed'], ['burn', 'burnt', 'burned', 'set fire']].map((g) => new Set(g.map(stemOf)));
  const DEED_VERB = ['gave', 'struck', 'took', 'opened', 'killed', 'found', 'wrote', 'burnt'];
  const deedKind = (a, b) => { const B = new Set(b); const i = DEEDS.findIndex((g) => [...a].some((w) => g.has(w)) && [...B].some((w) => g.has(w))); return i < 0 ? null : DEED_VERB[i]; };
  const sameDeed = (a, b) => { const B = new Set(b); return DEEDS.some((g) => [...a].some((w) => g.has(w)) && [...B].some((w) => g.has(w))); };

  // what nearly every story's paragraphs do and have: never what ties two deeds
  const COMMON = new Set(['rode', 'ride', 'head', 'came', 'come', 'went', 'turn', 'look', 'back', 'gate', 'door', 'room', 'hand', 'eyes', 'eye', 'wate', 'road', 'nigh', 'morn', 'time', 'kept', 'keep', 'took', 'take', 'made', 'make', 'found', 'find', 'stood', 'stand', 'walk', 'told', 'tell', 'felt', 'feel', 'left', 'leave', 'wait', 'light', 'house', 'town', 'away', 'there', 'first', 'last', 'long', 'little', 'great', 'every', 'never', 'always', 'again'].map(stemOf));
  // A distinctive word: in few of the shelf's paragraphs ("vortex"; not
  // "hand", "room"). → stem → is it rare
  function rarity(sources) {
    const df = new Map();
    let n = 0;
    for (const src of sources) {
      for (const p of sourceParas(src.html)) {
        n++;
        for (const w of new Set(heavy(p.text).map(stemOf))) df.set(w, (df.get(w) || 0) + 1);
      }
    }
    const most = Math.max(5, Math.ceil(n * 0.03));
    const rare = (w) => w.length >= 3 && !COMMON.has(w) && (df.get(w) || 0) <= most;
    // in two paragraphs at most: the deed's own and the one that retells it
    rare.only = (w) => rare(w) && (df.get(w) || 0) <= 2;
    return rare;
  }

  /* ---------- the gates on checking (docs/semantics/ACCURACY.md) ---------- */

  // A fact is checked only by what the text shows deterministically, or by
  // an explicit yes from the reader to a plain question that it also
  // answers no to the opposite of. Anything else stays unchecked, and an
  // unchecked fact raises no slips. A wrong fact marked checked is worse
  // than a right one left for the writer.

  const PLAN = /\?|\b(?:what if|maybe|perhaps|might|could be)\b/i;
  const NO_VALUE = { value: '\u0000', as: '', sources: [] };

  // a capitalised word a letter or two from a name it isn't (Corwyck for
  // Corwick): a value that is one is a slip of the pen, not a place
  function misspelt(value, entries) {
    const names = nameTokens(entries);
    return String(value || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}'’-]/gu, '').replace(/['’]s$/, '')).some((w) => {
      const low = w.toLowerCase();
      if (w.length < 5 || names.some(([n]) => n === low)) return false;
      return names.some(([n]) => editDistance(low, n) <= (n.length >= 8 ? 2 : 1));
    });
  }

  // The shelf's own evidence for each entry's traits: every passage that
  // ties a word to an entry the way a strong slip would ("Bramble, the grey
  // mare", "Captain Varr's eyes were the grey of wet slate", "Ilsa: grey
  // eyes"). Never a pronoun, speech, a question or a maybe, or a sentence
  // the writer said is not a slip. → Map 'id/attr' → Map value → [where]
  function shelfEvidence(sources, entries, notSlips = []) {
    const idx = mentionIndex(entries);
    const world = new Map(entries.map((x) => [x.id, { e: x, rel: [], sex: NO_VALUE, species: NO_VALUE, eyes: NO_VALUE, hair: NO_VALUE }]));
    const dismissed = new Set(notSlips.map((n) => n.fact + '|' + n.sentence));
    const out = new Map();
    const add = (id, attr, value, w) => {
      const k = id + '/' + attr;
      if (!out.has(k)) out.set(k, new Map());
      const m = out.get(k);
      if (!m.has(value)) m.set(value, []);
      if (!m.get(value).some((x) => x.chapter === w.chapter && x.quote === w.quote)) m.get(value).push(w);
    };
    sources.forEach((src, order) => {
      for (const p of sourceParas(src.html)) {
        const sents = sentences(p.text);
        for (const c of paraCandidates(p.text, idx, world, [])) {
          if (c.strength !== 'strong' || c.kind === 'pronoun' || !TIED[c.attr]) continue;
          const s = sents[c.si];
          if (PLAN.test(s.text)) continue;
          const e = world.get(c.id).e;
          if (dismissed.has(`${e.id}/${c.attr}|${textHash(norm(s.text))}`)) continue;
          const word = p.text.slice(c.start, c.end).toLowerCase().replace(/['’]s$/, '');
          const value = TIED[c.attr](word, c.kind);
          if (!value) continue;
          // the sentence is the quote, cut to 30 words around the word if longer
          const words = s.text.split(/\s+/);
          let quote = s.text;
          if (words.length > 30) {
            const at = s.text.slice(0, c.start - s.start).split(/\s+/).length - 1;
            quote = words.slice(Math.max(0, at - 14), Math.max(0, at - 14) + 30).join(' ');
          }
          const w = { chapter: src.bookId + '/' + src.chId, order, quote, src, as: SEX_WORDS[word] || c.attr === 'species' ? word : COLOURS[word] && COLOURS[word] !== word ? word : '' };
          add(e.id, c.attr, value, w);
          // a mare is a horse
          if (c.attr === 'sex' && SEX_WORDS[word] && SEX_WORDS[word][2]) add(e.id, 'species', SEX_WORDS[word][2], { ...w, as: '' });
        }
      }
    });
    return out;
  }
  // What the narration calls each person or creature: the she or he that
  // the slip checker's own rules tie to them (Pio … her bed; a sentence
  // naming no one, after one that names Pio alone: referent()). Never what
  // anyone says. → Map id → Map 'female'|'male' → [{ pos, note, quote, src, key }],
  // one per sentence, in reading order.
  // a verb whose object is often someone else's hand, arm or face: "took her right thumb"
  const HANDLING = /^(?:took|take|takes|taking|held|hold|holds|grabbed|grab|touched|kissed|squeezed|pricked|gripped|seized|caught|stroked|patted|clasped|tugged|slapped|bandaged)$/;
  // after one of these, an owning his or her is the subject's own ("sat on her bed")
  const OF_PLACE = new Set(['on', 'in', 'at', 'to', 'into', 'onto', 'from', 'with', 'by', 'over', 'under', 'behind', 'beside', 'across', 'through', 'against', 'around', 'off', 'up', 'down', 'of', 'and', 'was', 'were', 'is', 'for', 'about', 'between', 'near', 'past', 'toward', 'towards', 'inside', 'outside', 'upon', 'within', 'without']);
  function pronounEvidence(sources, entries) {
    const idx = mentionIndex(entries);
    const world = new Map(entries.map((x) => [x.id, { e: x, rel: [], ...(x.kind === 'person' || x.kind === 'creature' ? { sex: NO_VALUE } : {}) }]));
    const out = new Map();
    sources.forEach((src, order) => {
      sourceParas(src.html).forEach((p, pi) => {
        const sents = sentences(p.text);
        for (const c of paraCandidates(p.text, idx, world, [])) {
          if (c.kind !== 'pronoun' || c.attr !== 'sex' || !world.get(c.id).sex) continue;
          const word = p.text.slice(c.start, c.end).toLowerCase();
          const value = PRONOUNS[word];
          if (!value) continue;
          // (an owning "her" after the entry may be another's: "The weigher
          // took her right thumb"; a he or she, the sentence's subject, is not)
          if (c.kind === 'pronoun' && c.strength === 'strong' && !['he', 'she'].includes(word)) {
            const before = (p.text.slice(0, c.start).match(/([\p{L}'’]+)\s*$/u) || [])[1];
            if (before && !OF_PLACE.has(before.toLowerCase())) continue;
          }
          const s = sents[c.si];
          if (PLAN.test(s.text)) continue;
          const key = `${src.bookId}/${src.chId}/${pi}/${c.si}`;
          if (!out.has(c.id)) out.set(c.id, new Map());
          const m = out.get(c.id);
          if (!m.has(value)) m.set(value, []);
          if (m.get(value).some((w) => w.key === key)) continue;
          m.get(value).push({ key, pos: (isNote(src) ? NOTE_AT : 0) + order * 1e4 + pi, note: isNote(src), quote: s.text.split(/\s+/).length > 30 ? s.text.split(/\s+/).slice(0, 30).join(' ') : s.text, src });
        }
      });
    });
    return out;
  }
  // The sex the narration gives someone: the same pronoun in two sentences
  // or more, and the other in none. (A pronoun alone checks nothing; two
  // that agree, with none against, are the story's word.)
  function pronounSex(ev) {
    if (!ev || ev.size !== 1) return null;
    const [[value, ws]] = [...ev];
    return ws.length >= 2 ? { value, ws } : null;
  }

  // Where a passage stands in reading order: the writer's own Notes and
  // notebook pages come first (they are the writer's word, not the story's
  // telling), then the books' chapters in shelf order, paragraph by paragraph.
  const NOTE_AT = -1e9;
  const isNote = (src) => !!(src && (src.notes || src.notebook));
  // Of the values the shelf shows for one trait, the one it establishes:
  // first said, first kept. The writer's notes before the prose; if the
  // notes say two things, or say one thing and the prose first says
  // another, the shelf disagrees with itself (null): the writer is asked.
  // undefined: it shows none.
  function established(ev) {
    if (!ev || !ev.size) return undefined;
    const first = (ws, note) => Math.min(...ws.filter((w) => isNote(w.src) === note).map((w) => w.order));
    const notes = [...ev].filter(([, ws]) => Number.isFinite(first(ws, true))).map(([v]) => v);
    let prose;
    for (const [v, ws] of ev) if (Number.isFinite(first(ws, false)) && (prose === undefined || first(ws, false) < first(ev.get(prose), false))) prose = v;
    if (notes.length > 1 || (notes.length === 1 && prose !== undefined && prose !== notes[0])) return null;
    return notes.length ? notes[0] : prose;
  }

  // Where each attribute of an entry stands after a read (ACCURACY.md,
  // "First said, first kept"). `gated` maps every fact that got through
  // the gates (its quote, its value, its entity tied to the quote by rule
  // or by the reader's double answer) to where it is said: [{ pos, note }].
  //   The writer's value stands; a value from the text that agrees is
  //   checked, one that differs is the slip the pass finds, not a fact.
  //   Otherwise the first value said is checked, without asking: the
  //   writer's notes first, then the books in reading order. A later value
  //   that differs is a slip on its passage, not a question.
  //   The writer's notes against the prose (or against each other) are the
  //   one thing asked: every value waits as "Which is right?" (disagree),
  //   no slip, until the writer picks.
  //   An attribute that may change (owner, home, title) or hold several
  //   values (kin) keeps every value that got through.
  // → the facts to leave out (later values that differ)
  function firstCome(e, gated) {
    const later = new Set();
    for (const attr of new Set(e.facts.map((f) => f.attr))) {
      const these = e.facts.filter((f) => f.attr === attr && (f.state === 'yours' || gated.has(f)));
      const others = these.filter((f) => f.state !== 'yours');
      if (!ATTRS[attr] || !ATTRS[attr].single || !ATTRS[attr].slips) { for (const f of others) f.state = 'verified'; continue; }
      const mine = new Set(these.filter((f) => f.state === 'yours').map((f) => norm(f.value)));
      if (mine.size) {
        for (const f of others) if (mine.has(norm(f.value))) f.state = 'verified'; else later.add(f);
        continue;
      }
      const at = (f, note) => Math.min(...gated.get(f).filter((w) => w.note === note).map((w) => w.pos));
      const notes = new Set(others.filter((f) => Number.isFinite(at(f, true))).map((f) => norm(f.value)));
      let prose = null;
      for (const f of others) if (Number.isFinite(at(f, false)) && (!prose || at(f, false) < at(prose, false))) prose = f;
      if (notes.size > 1 || (notes.size === 1 && prose && !notes.has(norm(prose.value)))) {
        for (const f of others) f.state = 'disagree';
        continue;
      }
      const win = notes.size ? [...notes][0] : prose && norm(prose.value);
      for (const f of others) if (norm(f.value) === win) f.state = 'verified'; else later.add(f);
    }
    return later;
  }

  const evSource = (w) => ({ label: `${w.src.book}, ${w.src.label}`, quote: w.quote, book: w.src.bookId, ch: w.src.chId });
  const sameSource = (a, b) => a.book === b.book && a.ch === b.ch && (norm(a.quote).includes(norm(b.quote)) || norm(b.quote).includes(norm(a.quote)));

  // Relations (owner, kin, spouse, where someone lives or was born) are
  // where small readers go most wrong: "Captain Varr knelt beside him" made
  // Tamsin her sister. The sentence holding the quote must name both and
  // hold a word for the relation between them ('rule' when the words say
  // which way round, 'linked' when only that they are tied), else nothing.
  const REL_WORDS = {
    sibling: ['sister', 'brother', 'sibling', 'siblings', 'twin', 'twins'],
    parent: ['father', 'mother', 'parent', 'son', 'daughter', 'child', 'children'],
    child: ['father', 'mother', 'parent', 'son', 'daughter', 'child', 'children'],
    spouse: ['wife', 'husband', 'married', 'marry', 'wed', 'wedded', 'widow', 'widower', 'spouse'],
    owner: ['own', 'owned', 'owns', 'owner', 'belonged', 'belongs', 'belong'],
    home: ['lived', 'lives', 'live', 'living', 'home', 'house', 'dwelt', 'dwells', 'settled'],
    birthplace: ['born', 'native', 'birthplace']
  };
  const KIN_NOUNS = { sister: 'sib', brother: 'sib', twin: 'sib', sibling: 'sib', father: 'up', mother: 'up', parent: 'up', son: 'down', daughter: 'down', child: 'down', wife: 'wed', husband: 'wed' };
  const PERSON_NOUNS = new Set([...Object.keys(KIN_NOUNS), 'friend', 'servant', 'man', 'woman', 'boy', 'girl', 'master', 'captain', 'aunt', 'uncle', 'cousin', 'niece', 'nephew']);
  // Kin the shelf states outright between two entries: "Tamsin Hale,
  // Oren's younger sister", "Teodor Brisk, Ansel's father", a note's "Mara:
  // …, Jory's younger sister". → [{ id, attr, value, as, quote, src }]
  // (each then goes through relation() like any reading)
  function kinEvidence(sources, entries) {
    const idx = mentionIndex(entries);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const out = [];
    for (const src of sources) {
      for (const p of sourceParas(src.html)) {
        for (const s of sentences(p.text)) {
          if (PLAN.test(s.text)) continue;
          const S = s.text;
          const speech = talkSpans(S);
          const ms = mentions(S, idx).filter((m) => byId.get(m.id).kind === 'person' && !speech.some(([a, b]) => m.start < b && m.end > a));
          const words = [...S.matchAll(WORD)].map((m) => ({ lw: m[0].toLowerCase().replace(/['’]s$/, ''), poss: /['’]s$/.test(m[0]), start: m.index, end: m.index + m[0].length }));
          for (const x of ms.filter((m) => /^['’]s\b/.test(S.slice(m.end)))) {
            const i = words.findIndex((w) => w.end > x.end);
            const run = words.slice(i + 1, i + 4);
            const k = run.find((w) => KIN_NOUNS[w.lw]);
            if (!k || !['sib', 'up', 'down'].includes(KIN_NOUNS[k.lw])) continue;
            const adj = run.slice(0, run.indexOf(k)).map((w) => KIN[w.lw]).find(Boolean) || '';
            const y = ms.find((m) => m.id !== x.id && ((m.end <= x.start && (/^\s*(?:,|[—–]|was|is)\s*$/.test(S.slice(m.end, x.start))
              || (m.start === 0 && /^\s*:/.test(S.slice(m.end)) && !ms.some((o) => o !== m && o !== x && o.start > m.end && o.end <= x.start))))
              || (m.start >= k.end && /^\s*,?\s*$/.test(S.slice(k.end, m.start)))));
            if (!y) continue;
            const kind = KIN_NOUNS[k.lw];
            const words30 = S.split(/\s+/);
            out.push({ id: y.id, attr: kind === 'sib' ? 'sibling' : kind === 'up' ? 'parent' : 'child', value: byId.get(x.id).name, as: kind === 'sib' ? adj : '',
              quote: words30.length <= 30 ? S : words30.slice(0, 30).join(' '), src });
          }
        }
      }
    }
    return out;
  }

  function relation(e, f, quote, para, entries) {
    const idx = mentionIndex(entries);
    const target = findEntry(entries, f.value);
    const nm = normMap(para);
    const qa = nm.text.indexOf(norm(quote));
    if (qa < 0) return null;
    const a = nm.map[qa];
    const b = nm.map[qa + norm(quote).length - 1] + 1;
    const sents = sentences(para).filter((s) => s.end > a && s.start < b);
    if (!sents.length) return null;
    const S = para.slice(sents[0].start, sents[sents.length - 1].end);
    const ms = mentions(S, idx);
    const isE = (m) => m.id === e.id;
    const vs = target ? ms.filter((m) => m.id === target.id) : [];
    if (!target) {
      // a value with no entry yet: its words as written
      // (or a part of it the entry's own name doesn't share: "Ansel's" for Ansel Brisk)
      const own = new Set(nameParts(e.name).map((x) => x.toLowerCase()));
      for (const w of [f.value, ...(/\s/.test(f.value) ? nameParts(f.value).filter((x) => !own.has(x.toLowerCase())) : [])]) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
        for (const m of S.matchAll(re)) if (!vs.some((v) => v.start <= m.index && v.end >= m.index + m[0].length)) vs.push({ id: null, start: m.index, end: m.index + m[0].length });
      }
    }
    const es = ms.filter(isE);
    if (!es.length || !vs.length || (target && target.id === e.id)) return null;
    const words = [...S.matchAll(WORD)].map((m) => ({ lw: m[0].toLowerCase().replace(/['’]s$/, ''), poss: /['’]s$/.test(m[0]), start: m.index, end: m.index + m[0].length }));
    const wi = (pos) => { const i = words.findIndex((w) => w.end > pos); return i < 0 ? words.length : i; };
    const between = (x, y) => ms.filter((m) => m !== x && m !== y && m.start >= Math.min(x.end, y.end) && m.end <= Math.max(x.start, y.start));
    const living = (m) => { const o = entries.find((z) => z.id === m.id); return o && (o.kind === 'person' || o.kind === 'creature'); };
    const possOf = (m) => /^['’]s\b/.test(S.slice(m.end));
    const gap = (x, y) => S.slice(x.end, y.start);
    const attr = f.attr;
    const head = (m) => m.start === 0 && /^\s*(?::|[—–]\s)/.test(S.slice(m.end));

    // which way round, from the words: X's [two words] K, with Y beside it
    // ("Tamsin Hale, Oren's younger sister"; "Oren's sister, Tamsin"; a
    // note's "Mara: …, Jory's younger sister")
    // the noun X's owns: a kin or person word, or a creature's, within
    // three words ("Oren's younger sister", "Teodor's black bull")
    const possessed = (x) => {
      const i = wi(x.end);
      const run = words.slice(i, i + 4).filter((w) => !w.poss).slice(0, 3);
      return run.find((w) => KIN_NOUNS[w.lw] || PERSON_NOUNS.has(w.lw)) || run.find((w) => SEX_WORDS[w.lw] || SPECIES[w.lw]) || run[0] || null;
    };
    const beside = (x, y, k) => (y.end <= x.start && (/^\s*(?:,|[—–]|was|is|,\s*(?:was|is))\s*$/.test(gap(y, x)) || (head(y) && !between(y, x).some(living))))
      || (k && y.start >= k.end && /^\s*,?\s*$/.test(S.slice(k.end, y.start)));
    for (const x of [...ms, ...vs.filter((v) => v.id === null)].filter(possOf)) {
      const k = possessed(x);
      const kin = k && KIN_NOUNS[k.lw];
      for (const y of [...es, ...vs]) {
        if (y === x || (y.id && y.id === x.id) || !beside(x, y, k)) continue;
        // y is x's k: which of the two is the entry, which the value
        const eIs = isE(y) ? 'y' : isE(x) ? 'x' : null;
        const vIs = vs.includes(y) ? 'y' : vs.some((v) => v.start === x.start) ? 'x' : null;
        if (!eIs || !vIs || eIs === vIs) continue;
        if (attr === 'sibling' && kin === 'sib') return 'rule';
        if (attr === 'spouse' && kin === 'wed') return 'rule';
        // Y is X's father: Y parent of X; Y is X's son: Y child of X
        if (attr === 'parent' && ((kin === 'up' && eIs === 'y') || (kin === 'down' && eIs === 'x'))) return 'rule';
        if (attr === 'child' && ((kin === 'down' && eIs === 'y') || (kin === 'up' && eIs === 'x'))) return 'rule';
        // Hector, Teodor's black bull; Rook — stallion, Oren's: Y is X's
        if (attr === 'owner' && eIs === 'y' && !(k && PERSON_NOUNS.has(k.lw))) return 'rule';
      }
    }
    // Clover … belonged to Mara; Rook, owned by Oren
    if (attr === 'owner') {
      for (const x of es) {
        for (const v of vs) {
          const t = norm(gap(x, v));
          if (v.start > x.end && /(?:^|\s)(?:belonged|belongs|belonging) to$|(?:^|\s)owned by$/.test(t) && !between(x, v).some(living)) return 'rule';
          if (x.start > v.end && /^(?:owned|owns|bought|bred)(?: (?:a|an|the|her|his|their)\b.*)?$/.test(norm(gap(v, x))) && gap(v, x).split(/\s+/).length <= 5) return 'rule';
        }
      }
    }
    // Mara lived in Kellsharrow; Ilsa: grey eyes, born in Saltmere
    if (attr === 'home' || attr === 'birthplace') {
      const verbs = attr === 'home' ? /^(?:lived|lives|living|dwelt|dwells|settled)$/ : /^born$/;
      for (const v of vs) {
        const i = wi(v.start);
        if (!(i >= 2 && verbs.test(words[i - 2].lw) && ['in', 'at'].includes(words[i - 1].lw))) continue;
        const people = ms.filter((m) => living(m) && m.start < v.start);
        if (people.length && people.every(isE) && wi(people[people.length - 1].end) >= i - 12) return 'rule';
      }
    }
    // tied, but not which way round: both named near a word for it
    const rel = new Set(REL_WORDS[attr] || []);
    for (const x of es) {
      for (const v of vs) {
        const lo = Math.min(wi(x.start), wi(v.start));
        const hi = Math.max(wi(x.start), wi(v.start));
        if (hi - lo > 10 || between(x, v).some(living)) continue;
        const near = words.slice(Math.max(0, lo - 3), hi + 4);
        if (near.some((w) => rel.has(w.lw)) || (attr === 'owner' && possOf(v))) return 'linked';
      }
    }
    return null;
  }

  /* ---------- the engine ---------- */

  // The pipelines over one Canon. `io` is the only way to the files (main.js
  // gives one over the library; the tests one over a folder):
  //   sources() → [{ bookId, chId, book, label, html, notes? }] in reading order
  //   meta() / saveMeta(m), entries() → [{ id, text }] / saveEntry(id, text),
  //   notSlips(), cache() / saveCache(c) (this device only), knownWords(words)
  function createEngine({ io, reader = null }) {
    // the file's name is the entry's id, whatever its front matter says
    const parsed = async () => (await io.entries()).map((x) => ({ ...parseEntry(x.text), id: x.id }));
    const loadEntries = async () => (await parsed()).filter((e) => !e.error);
    const shelf = async () => {
      const out = (await io.meta()).out || {};
      return { sources: (await io.sources()).filter((s) => !(out[s.bookId] || []).includes(s.chId)), entries: await loadEntries() };
    };
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
        const entries = await loadEntries();
        // the story's key points, for the reader to check against (STORY.md §5)
        let told = {};
        const opens = reader && typeof reader.clash === 'function' && entries.some((e) => e.facts.some((f) => f.attr === 'other' && ['verified', 'yours'].includes(f.state)));
        if ((reader && typeof reader.contradicts === 'function' && entries.some((e) => e.story.length)) || opens) {
          const shelf = (await io.sources()).filter((s) => !(out[s.bookId] || []).includes(s.chId))
            .map((s) => s.bookId === bookId && typeof html[s.chId] === 'string' ? { ...s, html: html[s.chId] } : s);
          const rank = new Map(shelf.map((s, i) => [s.bookId + '/' + s.chId, i]));
          told = { story: storyIndex(entries, shelf, rank), rank, rare: rarity(shelf.filter((s) => !isNote(s))), open: opens ? openIndex(entries, shelf, rank) : null };
        }
        return checkSources({ sources, entries, notSlips: await io.notSlips(), reader, knownWords: io.knownWords, out, onSource, stop, paraOk, ...told });
      },

      // Changing a fact across the series (PRODUCT §4.7), once the writer
      // has made the change in the entry: every passage on the shelf (books,
      // their Notes, notebooks; not what's left out of Canon) that now says
      // otherwise of that entry's `attr`, found by the pass's own checkers,
      // dismissals ignored, in reading order. A word that can't simply be
      // swapped ("in foal", for a stallion) comes with `to: null`.
      async passages({ entryId, attr, bookId = null, html = {} }) {
        const out = (await io.meta()).out || {};
        const sources = (await io.sources()).filter((s) => !(out[s.bookId] || []).includes(s.chId))
          .map((s) => s.bookId === bookId && typeof html[s.chId] === 'string' ? { ...s, html: html[s.chId] } : s);
        const entries = await loadEntries();
        const e = entries.find((x) => x.id === entryId);
        const k = e && worldOf([e], out).get(e.id)[attr];
        if (!k) return [];
        const { slips } = await checkSources({ sources, entries, reader, out });
        const items = slips.filter((x) => x.entry === entryId && x.attr === attr);
        const idx = mentionIndex(entries);
        const words = attr === 'sex' ? ONLY[k.value === 'male' ? 'female' : 'male'] : [];
        sources.forEach((src, n) => {
          for (const p of sourceParas(src.html)) {
            for (const st of sentences(p.text)) {
              if (!mentions(st.text, idx).some((m) => m.id === entryId)) continue;
              const low = st.text.toLowerCase();
              const w = words.find((x) => hasWord(low, x));
              if (!w) continue;
              const i = low.search(new RegExp(`(^|[^\\p{L}])${w}`, 'u'));
              const at = st.start + i + (/^\p{L}/u.test(low[i]) ? 0 : 1);
              items.push({ bookId: src.bookId, chId: src.chId, book: src.book, label: src.label, para: p.hash, sentence: st.text, sat: st.start, at, span: p.text.slice(at, at + w.length), to: null, entry: entryId, name: e.name, attr, kind: 'words', n });
            }
          }
        });
        const rank = new Map(sources.map((s, i) => [s.bookId + '/' + s.chId, i]));
        const pos = (x) => [rank.get(x.bookId + '/' + x.chId), sourceParas(sources[rank.get(x.bookId + '/' + x.chId)].html).findIndex((p) => p.hash === x.para), x.at];
        return items.map((x) => ({ x, r: pos(x) })).sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2]).map(({ x }) => {
          const { bookId, chId, book, label, para, sentence, sat, at, span, to, kind } = x;
          return { bookId, chId, book, label, notes: !!sources[rank.get(bookId + '/' + chId)].notes, para, sentence, sat, at, span, to, kind };
        });
      },

      // The shelf as the IDE views read it (IDE.md §6): built on demand,
      // never written; pages left out of Canon are not in it
      async index() { const w = await shelf(); return worldIndex(w.sources, w.entries); },
      async mentionsOf(entryId, opts) { const w = await shelf(); return mentionPassages(w.sources, w.entries, entryId, opts); },
      async search(q) { const w = await shelf(); return searchPassages(w.sources, q); },

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
        // the story's key points: asked of a reader that can, kept apart (STORY.md)
        const telling = typeof reader.events === 'function';
        meta.story = meta.story || {};
        if (telling && cache.storyPrompt !== STORY_PROMPT) Object.assign(cache, { storyPrompt: STORY_PROMPT, events: {} });
        // the editor's reading (READING.md), for a reader that does it; the
        // chapters it has read are `edited` (a reading of another kind, or
        // another version of the prompts, reads them again)
        const editing = !!(Editor && reader.editor && typeof reader.cast === 'function');
        if (editing && (!cache.ed || cache.ed.v !== Editor.EDITOR_PROMPT)) cache.ed = { v: Editor.EDITOR_PROMPT, cast: {}, dossier: {}, verdict: {}, profile: {}, dropped: {} };
        const edMark = editing ? reader.id + '/' + Editor.EDITOR_PROMPT : null;
        meta.edited = meta.edited || {};
        meta.refs = meta.refs || {};
        const cacheWas = JSON.stringify(cache);
        const files = await parsed();
        const entries = [];
        const before = new Map();
        for (const e of files) {
          // a file Canon can't read is left as it is, but its name stays
          // taken: what's read about it waits until the file reads again
          if (e.error) { entries.push({ ...newEntry(e.name || e.id, e.kind, e.id), locked: true }); continue; }
          entries.push(e);
          before.set(e.id, serialiseEntry(e));
        }
        const taken = new Set(files.map((x) => x.id));
        const sources = (await io.sources()).filter((s) => !(out[s.bookId] || []).includes(s.chId));
        const texts = new Map();
        // what there is to read: changed sources (or `only` the one), and in
        // them the paragraphs with cues the cache has no answer for
        const ctxKey = (paras, j) => textHash([reader.id, PROMPT, j ? paras[j - 1].text : '', paras[j].text].join('\n'));
        const evKey = (paras, j) => textHash([reader.id, 'story', STORY_PROMPT, j ? paras[j - 1].text : '', paras[j].text].join('\n'));
        // (the story is the books' chapters: notes and notebooks hold no events)
        const storied = (src) => telling && !isNote(src);
        const todo = [];
        let left = 0;
        for (const src of sources) {
          const key = src.bookId + '/' + src.chId;
          const paras = sourceParas(src.html);
          texts.set(key, paras.map((p) => p.text).join('\n'));
          if (only && key !== only) continue;
          const h = textHash(src.html);
          const facts = again || meta.read[key] !== h || (editing && meta.edited[key] !== edMark + '/' + h);
          const story = storied(src) && (again || meta.story[key] !== h);
          if (!facts && !story) continue;
          // (an empty page is read at once, and never counted as one to read)
          if (!paras.length) { meta.read[key] = h; if (storied(src)) meta.story[key] = h; continue; }
          todo.push({ src, key, paras, facts, story });
          const idx = mentionIndex(entries);
          left += paras.filter((p, j) => cueful(p.text, idx) && ((facts && !editing && !cache.proposals[ctxKey(paras, j)]) + (story && !cache.events[evKey(paras, j)]))).length;
        }
        // (the editor's reading: a chapter's cast, a dossier a cast member, a
        // verdict a fact; counted as they come, timed by their kind)
        const plan = { ch: editing ? todo.filter((x) => x.facts).length : 0, dossiers: 0, verify: 0, profile: 0 };
        const pace = { cast: [], dossier: [], verify: [], event: [], profile: [], read: [] };
        const names = shelfNames([...texts.values()]);
        let calls = 0;
        let spent = 0;
        let stopped = false;
        // How long is left, honestly: the calls still to make of each kind,
        // each at what that kind has taken here so far (or a first guess:
        // a dossier ~5 events' worth, a verdict a fifth of one)
        const avg = (k, guess) => pace[k].length ? pace[k].reduce((a, b) => a + b, 0) / pace[k].length : guess;
        const eta = () => {
          const unit = avg('event', avg('read', avg('dossier', 20000) / 5));
          const ms = Math.max(0, left - pace.event.length - pace.read.length) * unit + plan.ch * avg('cast', unit * 8) + plan.dossiers * avg('dossier', unit * 5) + plan.verify * avg('verify', unit / 5) + plan.profile * avg('profile', unit * 1.5);
          return Math.round(ms / 1000);
        };
        let phase = { phase: 'read' };
        const tell = (src, n) => onProgress && onProgress({ phase: 'read', ...phase, book: src.book, label: src.label, n: phase.n || n, of: phase.of || todo.length, chapter: n, chapters: todo.length, calls, left: Math.max(0, left - calls), ms: calls ? Math.round(spent / calls) : 0, eta: eta() });
        // the facts the editor's reading kept this time (open ones the reader
        // said yes to: `fresh`), and the trait proposals it read
        const fresh = new WeakSet();
        const keptRead = [];
        const freshTraits = new WeakSet();
        const told = new Map(); // a chapter read whole for its story → [{ who, did, quote, src }]
        const lost = {};
        for (const [n, { src, key, paras, facts, story }] of todo.entries()) {
          if (stop && stop()) { stopped = true; break; }
          phase = { phase: 'read' };
          tell(src, n + 1);
          const events = [];
          if (editing && facts) {
            // a chapter read again has Canon's facts from it made afresh: its
            // passages leave Canon's facts (the writer's stay as they are)
            for (const e of entries) {
              if (e.locked) continue;
              e.facts = e.facts.filter((f) => {
                if (f.state === 'yours') return true;
                f.sources = f.sources.filter((x) => x.written || x.book !== src.bookId || x.ch !== src.chId);
                return f.sources.length > 0;
              });
            }
            const earlier = [...told.values()].flat();
            const suspect = editorSuspects({ paras, entries, kept: keptRead, told: earlier, rare: rarity(sources.filter((x) => !isNote(x))) });
            const sexOf = (e) => { const f = e.facts.find((x) => x.attr === 'sex' && ['verified', 'yours'].includes(x.state)); return f ? f.value : null; };
            let r;
            try {
              r = await Editor.readChapter({ src, paras, entries, reader, cache: cache.ed, names, stop, suspect, sexOf,
                tell: (p) => {
                  if (p.phase === 'dossier' && !p.of) return;
                  if (p.phase === 'cast') phase = { phase: 'cast' };
                  else if (p.phase === 'dossier') { phase = { phase: 'dossier', name: p.name, n: p.n, of: p.of }; plan.dossiers = p.of - p.n + 1; }
                  else if (p.phase === 'verify') { phase = { phase: 'verify', n: p.n, of: p.of }; plan.dossiers = 0; plan.verify = p.of - p.n + 1; }
                  tell(src, n + 1);
                },
                timed: (kind, ms) => { pace[kind].push(ms); spent += ms; calls++; } });
            } catch (err) {
              if (stop && stop()) { stopped = true; break; }
              throw err;
            }
            plan.ch = Math.max(0, plan.ch - 1);
            plan.verify = 0;
            if (!r || r.stopped || (stop && stop())) { stopped = true; break; }
            cache.ed.dropped[key] = r.dropped;
            for (const k of r.kept) {
              const { e, f } = k;
              // the same fact again (another passage) is one fact
              const had = e.facts.find((x) => sameFact(x, f) && talkOnly(x) === talkOnly(f));
              if (had) { for (const x of f.sources) if (!had.sources.some((y) => sameSrc(y, x))) had.sources.push(x); }
              const g = had || f;
              if (!had) e.facts.push(f);
              if (k.trait) freshTraits.add(g); else fresh.add(g);
              keptRead.push({ e, f: g });
            }
            meta.edited[key] = edMark + '/' + textHash(src.html);
          } else if (facts && !editing) delete meta.edited[key];
          for (let j = 0; j < paras.length && !stopped; j++) {
            const p = paras[j];
            const idx = mentionIndex(entries);
            if (!cueful(p.text, idx)) continue;
            const prev = j ? paras[j - 1].text : '';
            const ck = ctxKey(paras, j);
            let props = facts && !editing ? cache.proposals[ck] : [];
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
              pace.read.push(Date.now() - t0);
              calls++;
              cache.proposals[ck] = props;
              tell(src, n + 1);
            }
            for (const prop of props || []) accept(entries, prop, src, p, prev, texts.get(key), names);
            if (!story || stopped) continue;
            // what happens here, once per paragraph and the one before it
            const ek = evKey(paras, j);
            let evs = cache.events[ek];
            if (!evs) {
              if (editing) { phase = { phase: 'events', n: j + 1, of: paras.length }; tell(src, n + 1); }
              const near = new Set(mentions(prev + '\n' + p.text, idx).map((m) => m.id));
              const t0 = Date.now();
              try {
                evs = await reader.events({ text: p.text, before: prev, known: entries.filter((e) => near.has(e.id)).map((e) => ({ name: e.name, kind: e.kind, aliases: e.aliases })) });
              } catch (err) {
                if (stop && stop()) { stopped = true; break; }
                throw err;
              }
              spent += Date.now() - t0;
              pace.event.push(Date.now() - t0);
              calls++;
              cache.events[ek] = evs || [];
              tell(src, n + 1);
            }
            for (const ev of evs || []) {
              const g = gateEvent(entries.filter((e) => !e.locked), ev, p, prev, texts.get(key), names);
              if (!g.who) { lost[ek + '|' + textHash(norm(String(ev && ev.did)))] = { did: ev && ev.did, quote: ev && ev.quote, why: g.why }; continue; }
              for (const e of g.fresh) {
                let id = slug(e.name);
                for (let k = 2; entries.some((x) => x.id === id); k++) id = slug(e.name) + '-' + k;
                e.id = id;
                entries.push(e);
              }
              events.push({ ...g, src });
            }
          }
          if (stopped) continue;
          if (facts) meta.read[key] = textHash(src.html);
          if (story) { meta.story[key] = textHash(src.html); told.set(key, events); }
        }
        if (telling) cache.lostEvents = lost;
        // places the shelf names plainly, misspellings aside
        for (const w of shelfPlaces([...texts.values()], names)) {
          if (findEntry(entries, w) || misspelt(w, entries.filter((e) => !e.locked))) continue;
          let id = slug(w);
          for (let k = 2; entries.some((x) => x.id === id); k++) id = slug(w) + '-' + k;
          entries.push(newEntry(w, 'place', id));
        }
        // a new entry never takes the name of a file Canon couldn't read
        for (const e of entries) if (!e.locked && !before.has(e.id) && taken.has(e.id)) e.id += '-' + entries.length;
        for (let i = entries.length - 1; i >= 0; i--) if (entries[i].locked) entries.splice(i, 1);

        // the story so far: a chapter read again has its Canon's notes made
        // afresh; the writer's lines stay, and win over a note on the same passage
        for (const e of entries) {
          e.story = (e.story || []).filter((x) => x.state !== 'note' || !x.sources.some((s) => told.has(s.book + '/' + s.ch)));
        }
        for (const list of told.values()) {
          for (const { who, did, quote, src } of list) {
            const source = { label: `${src.book}, ${src.label}`, quote, book: src.bookId, ch: src.chId };
            for (const e of who) {
              if (!entries.includes(e)) continue;
              if (e.story.some((x) => x.sources.some((s) => s.book === source.book && s.ch === source.ch && norm(s.quote) === norm(quote)))) continue;
              e.story.push({ did, state: 'note', sources: [source] });
            }
          }
        }
        // passages edited away, then where each value stands, then checking
        const paraOf = (s) => (texts.get(s.book + '/' + s.ch) || '').split('\n').find((t) => norm(t).includes(norm(s.quote))) || s.quote;
        for (const e of entries) {
          for (const f of e.facts) {
            for (const s of f.sources) {
              if (s.written || !texts.has(s.book + '/' + s.ch)) continue;
              if (gateQuote(s.quote, texts.get(s.book + '/' + s.ch))) delete s.changed;
              else s.changed = true;
              // narration an older reading took for dialogue (one stray
              // quotation mark) is narration again
              if (s.said && !s.changed && !quoteIn(s.quote, paraOf(s)).said) delete s.said;
            }
            if (f.state === 'verified' && !f.sources.some(live)) f.state = 'unverified';
          }
          for (const x of e.story) {
            for (const s of x.sources) {
              if (s.written || !texts.has(s.book + '/' + s.ch)) continue;
              if (gateQuote(s.quote, texts.get(s.book + '/' + s.ch))) delete s.changed;
              else s.changed = true;
            }
          }
        }
        // in reading order: book, chapter, paragraph (a line with no source after the one before it)
        {
          const at = new Map(sources.map((x, i) => [x.bookId + '/' + x.chId, i]));
          for (const e of entries) {
            let last = -1;
            const placed = e.story.map((x, i) => {
              const s = x.sources.find((y) => !y.written && at.has(y.book + '/' + y.ch));
              if (s) last = at.get(s.book + '/' + s.ch) * 1e4 + Math.max(0, texts.get(s.book + '/' + s.ch).split('\n').findIndex((t) => norm(t).includes(norm(s.quote))));
              return { x, pos: last, i };
            });
            e.story = placed.sort((a, b) => a.pos - b.pos || a.i - b.i).map((y) => y.x);
          }
        }
        // what the shelf itself shows of each trait, as the checker reads it
        // kin the shelf states outright, if no reading has it yet (nor the writer set it aside)
        for (const k of kinEvidence(sources, entries)) {
          const e = entries.find((x) => x.id === k.id);
          const same = (f) => f.attr === k.attr && norm(f.value) === norm(k.value);
          if (!e || e.facts.some(same) || e.setAside.some(same)) continue;
          e.facts.push({ attr: k.attr, value: k.value, as: k.as, state: 'unverified', sources: [{ label: `${k.src.book}, ${k.src.label}`, quote: k.quote, book: k.src.bookId, ch: k.src.chId }] });
        }
        const evidence = shelfEvidence(sources, entries.filter((e) => !e.locked), await io.notSlips());
        // where a passage stands in reading order (the writer's notes first)
        const rank = new Map(sources.map((x, i) => [x.bookId + '/' + x.chId, i]));
        const where = (s) => {
          const i = rank.get(s.book + '/' + s.ch);
          if (i === undefined) return null;
          const para = (texts.get(s.book + '/' + s.ch) || '').split('\n').findIndex((t) => norm(t).includes(norm(s.quote)));
          const note = isNote(sources[i]);
          return { pos: (note ? NOTE_AT : 0) + i * 1e4 + Math.max(0, para), note };
        };
        // the shelf's own ties are values too, where no reading has them
        // (an open fact the file has as checked, not read again this time,
        // stays checked while its passage is there: `trusted`; this device's
        // cache may not know it)
        const trusted = new WeakSet();
        for (const e of entries) {
          for (const f of e.facts) if (f.state === 'verified' && !TIED[f.attr] && !ATTRS[f.attr].ref && !fresh.has(f) && (f.attr === 'other' || f.attr === 'state')) trusted.add(f);
          for (const f of e.facts) if (f.state === 'verified' || f.state === 'disagree') f.state = 'unverified';
          for (const attr of Object.keys(TIED)) {
            const ev = evidence.get(e.id + '/' + attr);
            // (beside a reading of the same trait: a tie alone, "Dunmore, Jory's
            // younger sister", is no reason for a fact)
            if (!ev || e.facts.some((f) => f.attr === attr && f.state === 'yours') || !e.facts.some((f) => f.attr === attr && solid(f))) continue;
            for (const [value, ws] of ev) {
              if (e.facts.some((f) => f.attr === attr && norm(f.value) === value && !talkOnly(f))) continue;
              if (e.setAside.some((f) => f.attr === attr && norm(f.value) === value)) continue;
              const n = normaliseFact(attr, value, ws[0].as) || { value, as: '' };
              e.facts.push({ attr, value: n.value, as: n.as, state: 'unverified', sources: ws.slice(0, 3).map(evSource) });
            }
          }
        }

        // the gates: what the text shows deterministically, else one plain
        // question to the reader, asked the other way round as well. What
        // gets through is placed in reading order; what doesn't is left out
        // quietly (the cache keeps why), never asked of the writer.
        const gated = new Map();
        const weakTraits = new Map(); // a trait read from a pronoun's sentence → { e, ws }
        const pass = (f, ws) => { const at = ws.filter(Boolean); if (at.length) gated.set(f, at); };
        const dropped = {};
        const check = [];
        for (const e of entries) {
          for (const f of e.facts) {
            if (f.state === 'yours' || !solid(f)) continue; // speech and plans stay as they are
            const firm = f.sources.filter((x) => live(x) && !x.said && !x.plan);
            // what the editor's reading kept (the reader's yes after the
            // gates), or a checked open fact whose passage is still there
            if (!TIED[f.attr] && !ATTRS[f.attr].ref && (fresh.has(f) || trusted.has(f) || f.attr === 'other')) {
              if (fresh.has(f) || trusted.has(f)) pass(f, firm.map(where));
              continue;
            }
            if (TIED[f.attr]) {
              // a trait is checked only by the text: the shelf's own ties
              // ("Bramble, the grey mare"), or its own quote tying the word to
              // the entry. A pronoun, or a word the rules don't tie, is left out.
              const ev = (evidence.get(e.id + '/' + f.attr) || new Map()).get(norm(f.value));
              const ws = [...(ev || []).map((w) => ({ pos: (isNote(w.src) ? NOTE_AT : 0) + w.order * 1e4 + Math.max(0, sourceParas(w.src.html).findIndex((p) => norm(p.text).includes(norm(w.quote)))), note: isNote(w.src) })),
                ...(ruleSupported(e, f, entries) ? firm.map(where) : [])];
              // a pronoun's trait ("She was a narrow woman", "Her hair was …
              // fair"): when the pronoun is the entry's by the paragraph's
              // rules, or the reader said so (kept in canon.json `refs`)
              // (weaker than the text's own words: it counts only where nothing
              // else gives the attribute a value, like the narration's she and he)
              if (!ws.length) {
                const weak = [];
                for (const x of firm) {
                  if (await pronounTrait(e, f, x, paraOf(x), entries, freshTraits.has(f) ? reader : null, meta.refs)) weak.push(where(x));
                }
                if (weak.length) weakTraits.set(f, { e, ws: weak });
              }
              pass(f, ws);
              // checked by the shelf's own words: they are its source too
              if (ev && !f.sources.some((s) => live(s) && ev.some((w) => sameSource(s, evSource(w))))) f.sources.push(evSource(ev[0]));
              continue;
            }
            if (ATTRS[f.attr].ref) {
              // a slip of the pen is no place; a relation needs both names and its word
              if (misspelt(f.value, entries)) continue;
              const how = firm.map((x) => relation(e, f, x.quote, paraOf(x), entries));
              if (how.includes('rule')) { pass(f, firm.filter((_, i) => how[i] === 'rule').map(where)); continue; }
              if (!how.includes('linked') || !reader.judgeRelations) continue;
            }
            const s = firm.find((x) => !ATTRS[f.attr].ref || relation(e, f, x.quote, paraOf(x), entries)) || firm[0];
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
          if (cache.judged[jk] === 'yes') pass(f, [where(s)]);
        }
        // a pronoun's trait, where nothing else gives the attribute a value:
        // no value the text ties by its own words, none the writer kept
        for (const [f, { e, ws }] of weakTraits) {
          const others = e.facts.filter((g) => g.attr === f.attr && g !== f && (gated.has(g) || g.state === 'yours'));
          if (others.length || [...(evidence.get(e.id + '/' + f.attr) || new Map()).keys()].length) continue;
          if (e.setAside.some((g) => g.attr === f.attr && norm(g.value) === norm(f.value))) continue;
          pass(f, ws);
        }
        // the narration's she or he, where nothing else gives a sex: two
        // sentences or more that agree, none against, no other value read
        // from the story, and not one the writer set aside
        const pron = pronounEvidence(sources, entries.filter((e) => !e.locked));
        for (const e of entries) {
          const got = pronounSex(pron.get(e.id));
          if (!got) continue;
          const { value, ws } = got;
          const sexFacts = e.facts.filter((f) => f.attr === 'sex' && !talkOnly(f));
          if (sexFacts.some((f) => f.state === 'yours' || (gated.has(f) && norm(f.value) !== value))) continue;
          if ([...(evidence.get(e.id + '/sex') || new Map()).keys()].some((v) => v !== value)) continue;
          if (e.setAside.some((f) => f.attr === 'sex' && norm(f.value) === value)) continue;
          let f = sexFacts.find((x) => norm(x.value) === value);
          if (!f) { f = { attr: 'sex', value, as: '', state: 'unverified', sources: [] }; e.facts.push(f); }
          for (const w of ws.slice(0, 3)) if (!f.sources.some((x) => !x.written && sameSource(x, evSource(w)))) f.sources.push(evSource(w));
          gated.set(f, [...(gated.get(f) || []), ...ws.map((w) => ({ pos: w.pos, note: w.note }))]);
        }
        // first said, first kept; what didn't get through, and a later value
        // that differs (the pass's slip), leave the entry
        for (const e of entries) {
          const later = firstCome(e, gated);
          e.facts = e.facts.filter((f) => {
            if (f.state === 'yours' || talkOnly(f) || (f.state !== 'unverified' && !later.has(f))) return true;
            if (!later.has(f) && f.sources.some((s) => s.changed)) return true; // a passage edited away: kept, marked
            const s = f.sources.find(live) || f.sources[0] || {};
            dropped[factKey(e, f) + '|' + textHash(norm(s.quote || ''))] = { entry: e.name, attr: f.attr, value: f.value, quote: s.quote || '', why: later.has(f) ? 'later' : 'gate' };
            return false;
          });
        }
        // the editor's pass (READING.md §1 pass 4): the same thing said twice
        // is one fact (the earliest wording, every passage); an age said
        // otherwise later is the pass's to find, not a second fact; facts in
        // their sections' order, then reading order
        if (editing) {
          const posOf = (f) => { const x = f.sources.find(live); const w = x && where(x); return w ? w.pos : Infinity; };
          for (const e of entries) {
            if (e.locked) continue;
            const open = e.facts.filter((f) => (f.attr === 'other' || f.attr === 'state') && f.state === 'verified').sort((a, b) => posOf(a) - posOf(b));
            const keep = [];
            for (const f of open) {
              const k = factKind(f);
              const same = keep.find((g) => labelFamily(factKind(g)) === labelFamily(k) && Editor.overlap(g.value, f.value) >= 0.6);
              if (same) {
                for (const x of f.sources) if (!same.sources.some((y) => sameSrc(y, x))) same.sources.push(x);
                e.facts.splice(e.facts.indexOf(f), 1);
                continue;
              }
              if (k === 'age' && keep.some((g) => factKind(g) === 'age')) {
                const x = f.sources.find(live) || {};
                dropped[factKey(e, f) + '|' + textHash(norm(x.quote || ''))] = { entry: e.name, attr: f.attr, value: f.value, quote: x.quote || '', why: 'later' };
                e.facts.splice(e.facts.indexOf(f), 1);
                continue;
              }
              keep.push(f);
            }
            const rank = (f) => SECTIONS.indexOf(factSection(f, e.kind));
            e.facts = e.facts.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || (a.f.state === 'yours' || b.f.state === 'yours' ? a.i - b.i : posOf(a.f) - posOf(b.f) || a.i - b.i)).map((x) => x.f);
          }
        }
        cache.dropped = dropped;

        // profiles (READING.md §1 pass 4): a few sentences from the kept
        // facts, every word of them in those facts, each citing its passages.
        // Made again only when the kept facts change; a profile the writer
        // changed is theirs and never rewritten.
        if (editing && typeof reader.profile === 'function' && !stopped) {
          const want = entries.filter((e) => !e.locked && !(e.profile && e.profile.state === 'yours'));
          const keptOf = (e) => e.facts.filter((f) => (f.state === 'verified' || f.state === 'yours') && !talkOnly(f) && f.sources.some((x) => live(x) && !x.said && !x.plan));
          const asks = want.filter((e) => keptOf(e).length >= 2);
          plan.profile = asks.length;
          let made = 0;
          for (const e of want) {
            const kept = keptOf(e);
            if (kept.length < 2) { if (e.profile && e.profile.state === 'note') e.profile = null; continue; }
            if (stop && stop()) { stopped = true; break; }
            const facts = kept.slice(0, 24).map((f, i) => ({ n: i + 1, label: labelOf(f), value: f.value + (f.as && norm(f.as) !== norm(f.value) ? ` (${f.as})` : ''), f }));
            const hash = textHash(JSON.stringify([reader.id, e.name, e.kind, facts.map((x) => [x.label, x.value])]));
            let got = cache.ed.profile[e.id];
            if (!got || got.hash !== hash) {
              phase = { phase: 'profile', name: e.name, n: ++made, of: asks.length };
              if (onProgress && todo.length) tell(todo[todo.length - 1].src, todo.length);
              const t0 = Date.now();
              let answer;
              try { answer = await reader.profile({ name: e.name, kind: e.kind, facts: facts.map(({ n, label, value }) => ({ n, label, value })) }); } catch (err) {
                if (stop && stop()) { stopped = true; break; }
                throw err;
              }
              pace.profile.push(Date.now() - t0);
              spent += Date.now() - t0;
              calls++;
              plan.profile = Math.max(0, plan.profile - 1);
              got = cache.ed.profile[e.id] = { hash, answer: answer || [] };
            }
            const cites = [];
            const lines = [];
            for (const x of got.answer || []) {
              const used = [...new Set((x.f || []).map((n) => facts.find((y) => y.n === +n)).filter(Boolean))];
              // (the reader's own marks of its ids, "(2,4)", "f: [1][2]", come off)
              const t = String(x.t || '').replace(/\s*(?:\b[fF]\s*:\s*)?(?:\[[\d,\s]*\]|\((?:\d+\s*,?\s*)+\))/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!\s]+$/, '').replace(/\s*\b[fF]\s*:?$/, '');
              if (!used.length || !t || !Editor.profileOk(t, used.map((y) => y.f), e)) continue;
              const refs = [];
              for (const y of used) {
                const src = y.f.sources.find((z) => live(z) && !z.said && !z.plan);
                if (!src) continue;
                let c = cites.find((z) => z.book === src.book && z.ch === src.ch && norm(z.quote) === norm(src.quote));
                if (!c) { c = { n: cites.length + 1, label: src.label, quote: src.quote, book: src.book, ch: src.ch }; cites.push(c); }
                if (!refs.includes(c.n)) refs.push(c.n);
              }
              if (!refs.length) continue;
              lines.push(`${t} ${refs.map((n) => `[${n}]`).join('')}.`);
            }
            e.profile = lines.length ? { text: lines.join(' '), cites, state: 'note' } : (e.profile && e.profile.state === 'note' ? null : e.profile);
          }
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
          // what waits for the writer: notes against the prose, and what's only said or planned
          // (a line whose value the facts already hold asks nothing)
          needs: entries.flatMap((e) => e.facts.filter((f) => f.state === 'disagree' || (f.state === 'unverified' && talkOnly(f) && f.attr !== 'other'
            && !e.facts.some((x) => x !== f && sameFact(x, f) && !talkOnly(x) && (x.state === 'yours' || x.state === 'verified'))))).length
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
      judgeRelations: true,
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
      // the story's key points: [{ para, events: [{ who, did, where, quote }] }]
      async events({ text }) {
        this.calls++;
        const hit = (answers.events || []).find((x) => starts(text, x.para));
        return hit ? hit.events.map((x) => ({ ...x })) : [];
      },
      // [{ sentence (its first words), who, answer }]; no answer is no
      async contradicts({ sentence, who }) {
        const hit = (answers.contradicts || []).find((x) => starts(sentence, x.sentence) && (!x.who || norm(x.who) === norm(who)));
        return hit ? hit.answer : 'no';
      },
      // the editor's reading, when the file has it: cast by the chapter's
      // first words, dossiers by name (and the part's first sentence), a
      // verdict by "name|value" (none: yes), profiles by name, clashes by
      // the later sentence's first words
      editor: !!(answers.cast || answers.dossier),
      parallel: answers.parallel || 1,
      async cast({ text }) {
        this.calls++;
        const hit = (answers.cast || []).find((x) => norm(text).includes(norm(x.para)));
        return { cast: hit ? hit.cast.map((x) => ({ name: x.n, kind: x.k, aliases: x.a || [] })) : [], setting: (hit && hit.s) || '' };
      },
      async dossier({ name, text }) {
        this.calls++;
        const hits = (answers.dossier || []).filter((x) => norm(x.name) === norm(name) && (!x.part || norm(text).includes(norm(x.part))));
        // (a sentence named by its words in the file: its number in this part,
        // or none, which the gates see as a citation that isn't there)
        const lines = [...text.matchAll(/\[(\d+)\] ([^[]*)/g)].map((m) => [+m[1], m[2]]);
        const id = (s) => typeof s === 'number' ? s : ((lines.find(([, t]) => norm(t).includes(norm(s))) || [])[0] || 999);
        return hits.flatMap((x) => x.facts.map((f) => ({ x: 0, ...f, s: [].concat(f.s).map(id) })));
      },
      async verify({ name, value, strict, other, lasting }) {
        const v = (answers.verify || {})[norm(name + '|' + value)];
        if (other) return v === 'other' ? 'yes' : 'no';
        if (lasting) return v === 'moment' ? 'no' : 'yes';
        return v === undefined ? 'yes' : strict && v === 'guess' ? 'no' : v === 'guess' ? 'yes' : v;
      },
      async profile({ name, facts }) {
        this.calls++;
        const hit = (answers.profile || []).find((x) => norm(x.name) === norm(name));
        if (!hit) return [];
        // (a fact named by its value in the file: its number here)
        return hit.p.map((x) => ({ t: x.t, f: x.f.map((v) => typeof v === 'number' ? v : (facts.find((f) => norm(f.value) === norm(v)) || {}).n).filter(Boolean) }));
      },
      async clash({ sentence }) {
        const hit = (answers.clash || []).find((x) => starts(sentence, x.sentence));
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
  const ASK_KINDS = ['person', 'creature', 'place', 'thing', 'group', 'rule'];
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
  const JUDGE_SCHEMA = { type: 'object', properties: { a: { enum: ['yes', 'no', 'unsure'] } }, required: ['a'] };
  const JUDGE_SYSTEM = 'You check one statement against a paragraph of a novel. Answer yes only if the paragraph itself plainly says the statement is true in the story. Answer no if the paragraph says otherwise. Answer unsure if the paragraph does not say, or only a character says it, or it is a question, a wish or a plan.';
  // the claim as a plain statement, and its opposite: a reader that says
  // yes to both is saying yes to anything, and its yes counts for nothing
  const STATEMENTS = {
    title: (e, v) => [`${e} has the title or rank "${v}".`, `${e} does not have the title or rank "${v}".`],
    birthplace: (e, v) => [`${e} was born in ${v}.`, `${e} was not born in ${v}.`],
    home: (e, v) => [`${e} lives in ${v}.`, `${e} does not live in ${v}.`],
    owner: (e, v) => [`${e} belongs to ${v}.`, `${e} does not belong to ${v}.`],
    sibling: (e, v) => [`${e} and ${v} are brother or sister to each other.`, `${e} and ${v} are not brother or sister to each other.`],
    parent: (e, v) => [`${e} is the father or mother of ${v}.`, `${e} is not the father or mother of ${v}.`],
    child: (e, v) => [`${e} is the son or daughter of ${v}.`, `${e} is not the son or daughter of ${v}.`],
    spouse: (e, v) => [`${e} is married to ${v}.`, `${e} is not married to ${v}.`]
  };
  const statements = (c) => (STATEMENTS[c.attr] || ((e, v) => [`This is true of ${e}: ${v}.`, `This is false of ${e}: ${v}.`]))(c.entity, c.value);
  // the story's key points (STORY.md): who did what, in the writer's words
  const STORY_SYSTEM = [
    'You note the key things that happen in one paragraph of a novel, for an index of the story.',
    'Report at most two events: something a named character (or one the paragraph calls he or she) does, or that happens to them. Leave out what is only said in dialogue, thought, planned, wished or asked.',
    'For each event: w = who, as names (for he or she, the name it refers to), d = what happened in one short line of at most 12 words, past tense, starting with the name, using the paragraph\'s own words, p = where, if the paragraph says (else ""), q = the words of the paragraph that say it, copied exactly (at most 25 words).',
    'No event: {"v":[]}.',
    'Example. Paragraph: Moll Teague pushed the gate open and led the bay gelding into the yard. “Shut it,” Tom said.',
    'Answer: {"v":[{"w":["Moll Teague"],"d":"Moll Teague led the bay gelding into the yard","p":"into the yard","q":"Moll Teague pushed the gate open and led the bay gelding into the yard"}]}'
  ].join('\n');
  const STORY_SCHEMA = {
    type: 'object',
    properties: {
      v: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          properties: { w: { type: 'array', maxItems: 3, items: { type: 'string' } }, d: { type: 'string' }, p: { type: 'string' }, q: { type: 'string' } },
          required: ['w', 'd', 'p', 'q']
        }
      }
    },
    required: ['v']
  };
  const REFERS_SYSTEM = 'You read a paragraph of a novel and say who or what one word in one of its sentences refers to. Choose only from the options given. If the word means someone or something not in the options, or you cannot tell, say so.';
  const ELSE = 'someone or something else';
  const NOT_SAID = 'the sentence does not say';
  const SAME_EVENT_SYSTEM = 'You compare two passages of a novel. Answer yes if B tells of the very same event as A (the same act, at the same time, perhaps with a different doer named), no if B tells of another event (another time, or someone else doing something of the same kind), unclear if you cannot tell.';
  const WHO_SYSTEM = 'You read one sentence of a novel and say who did something in it, according to that sentence alone. Choose from the options. If the sentence only says someone remembers, imagines, plans or claims it, or does not say who, choose that the sentence does not say.';
  const ALONE_SYSTEM = 'You answer one question about a sentence of a novel, from that sentence alone. Answer yes or no if the sentence says; unclear if it does not, or if it only pretends, remembers or supposes.';
  const UNSURE = 'cannot tell';

  // The editor's reading (docs/semantics/READING.md): a chapter's cast, one
  // dossier per entity from its sentences (cited by number: the reader
  // never writes a quote), a verifier asked of each fact, a profile from
  // the kept facts, and the later sentence that says otherwise.
  const CAST_KINDS = ['person', 'creature', 'place', 'group', 'thing', 'rule'];
  const CAST_SYSTEM = [
    'You are a story editor making the cast list of one chapter of a novel: every person, creature, place, group, thing and rule of the story\'s world that the chapter names, or calls by a role ("the warden", "the cook").',
    'For each one: n = the name exactly as the chapter writes it (a role with "the"); k = person, creature, place, group, thing or rule; a = the other names the chapter uses for the same one, exactly as written (a nickname, a real name the chapter gives), else [].',
    'Then s = the building, institution, town or ship the chapter is set in, as the chapter names it (not a single room), else "".',
    'Leave out pronouns, crowds ("the children"), and everyday objects (cups, lamps, clothes, food) unless the story names them or they matter beyond one moment. One item for one person, however many names they have.',
    'Example. Chapter: ¶1 Old Bren unbolted the gate of Ashen Mill. The miller\'s girl, Wren, ran past him to the yard with a cup of milk. ¶2 "Bren the Bolt," the boys called him. The mill had stood by the ford for a century; the yard behind it was mud.',
    'Answer: {"c":[{"n":"Bren","k":"person","a":["Bren the Bolt"]},{"n":"Wren","k":"person","a":[]},{"n":"Ashen Mill","k":"place","a":["the mill"]},{"n":"the yard","k":"place","a":[]},{"n":"the ford","k":"place","a":[]}],"s":"Ashen Mill"}'
  ].join('\n');
  const CAST_SCHEMA = {
    type: 'object',
    properties: { c: { type: 'array', maxItems: 24, items: { type: 'object', properties: { n: { type: 'string' }, k: { enum: CAST_KINDS }, a: { type: 'array', maxItems: 4, items: { type: 'string' } } }, required: ['n', 'k', 'a'] } }, s: { type: 'string' } },
    required: ['c', 's']
  };
  const FACT_GROUPS = ['appearance', 'age', 'sex', 'role', 'personality', 'habit', 'relationship', 'origin', 'history', 'state', 'possession', 'description', 'location', 'rule', 'membership', 'other'];
  const DOSSIER_WHAT = {
    person: 'appearance (body, height, hair, eyes, face, clothing, marks), age, sex, role or work, personality, habits and routines, relationships, origin and history, state (health, situation), possessions',
    creature: 'appearance, age, sex, what it is, habits, who it belongs to, its history and state',
    place: 'what it is like (what is seen, heard, smelt, how warm), its layout and parts, how it works (its routines and rules), who is there, where it is',
    group: 'who belongs, how you tell them, their customs, routines and rules, where they come from',
    thing: 'what it is like, what it is for, its effects, who uses it and how',
    rule: 'the rule itself, what happens to whoever breaks it, who keeps it'
  };
  const dossierSystem = (kind) => [
    'You are a story editor keeping a story bible. From the numbered sentences only, list the lasting facts about the one named: ' + (DOSSIER_WHAT[kind] || DOSSIER_WHAT.thing) + '.',
    'Lasting means true beyond one moment: how they look, who and what they are, what they always or usually do, what happened to them before, how they stand with others. Leave out single actions and passing moments (stood up, drank, looked at, walked with): those are the story, not the bible.',
    'One fact per item: g = its group; a = a short label (1 to 3 words); v = the value, at most 10 words, in the sentences\' own words; s = the numbers of the sentences that state it (1 to 3); x = 1 if it is only said by a character (in quotation marks, or "he said that…"), else 0.',
    'Only what the sentences state about the one named: not about anyone else, not a guess. Each fact once.',
    'Example. Sentences about Bren: [1] Every morning old Bren unbolted the mill gate. [2] He was a broad man with a white beard and a limp. [3] He dropped the key. [4] "Bren the Bolt," the boys called him.',
    'Answer: {"f":[{"g":"age","a":"age","v":"old","s":[1],"x":0},{"g":"habit","a":"mornings","v":"unbolts the mill gate every morning","s":[1],"x":0},{"g":"appearance","a":"build","v":"broad","s":[2],"x":0},{"g":"appearance","a":"beard","v":"white beard","s":[2],"x":0},{"g":"appearance","a":"walk","v":"a limp","s":[2],"x":0},{"g":"other","a":"nickname","v":"Bren the Bolt","s":[4],"x":0}]}'
  ].join('\n');
  const DOSSIER_SCHEMA = {
    type: 'object',
    properties: { f: { type: 'array', maxItems: 20, items: { type: 'object', properties: { g: { enum: FACT_GROUPS }, a: { type: 'string' }, v: { type: 'string' }, s: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'integer' } }, x: { enum: [0, 1] } }, required: ['g', 'a', 'v', 's', 'x'] } } },
    required: ['f']
  };
  const VERIFY_SYSTEM = 'You check one claim about a novel against a passage from it. Answer yes only if the passage itself states the claim, as true in the story, about the one named. Answer no if the passage says otherwise, or says it about someone or something else. Answer unclear if the passage does not say it, if only a character says it, or if it is only a guess.';
  const OTHER_SYSTEM = 'You read a claim about one person, place or thing of a novel and the passage it comes from. Answer yes if in the passage the claim is really about someone or something else (another character, another place, an object). Answer no if it is about the one named. Answer unclear if you cannot tell.';
  const LASTING_SYSTEM = 'You sort the facts of a story bible. Answer yes if the claim is something lasting about the one named (how they look, who or what they are, what they always or usually do, how a place is or how it works, what happened to them before). Answer no if it is only one action or one passing moment of the scene. Answer unclear if you cannot tell.';
  const STATED_SYSTEM = 'You check one claim about a novel against a passage from it. Answer yes only if the passage states it in so many words or shows it plainly. Answer no if it is only an impression, a guess or a reading between the lines. Answer unclear if you cannot tell.';
  const PROFILE_SYSTEM = [
    'You write the short introduction to one entry of a story bible, using only the numbered facts given.',
    'Write 2 to 4 short sentences, plain and factual. In f, list the numbers of the facts each sentence uses. Use the facts\' own words; add nothing that is not in them: no guesses, no feelings, no opinions, no quotation marks.'
  ].join('\n');
  const PROFILE_SCHEMA = {
    type: 'object',
    properties: { p: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: { t: { type: 'string' }, f: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'integer' } } }, required: ['t', 'f'] } } },
    required: ['p']
  };

  // `tier`: the quick reader (Qwen2.5-1.5B) is never asked about relations:
  // measured, it answers yes to who owns, fathers or marries whom on almost
  // any sentence naming both (docs/semantics/ACCURACY.md). They wait for the
  // writer, or the text's own words (relation 'rule').
  function localReader({ id, ask, tier = null, editor = false }) {
    // an answer that went wrong is no answer; stopping is passed on
    const safe = async (msg, none) => {
      try { return await ask(msg); } catch (err) { if (err && err.code) throw err; return none; }
    };
    const yesNo = async (paragraph, statement) => {
      const r = await safe({ system: JUDGE_SYSTEM, user: `Paragraph:\n${paragraph}\n\nStatement: ${statement}\nDoes the paragraph say this is true in the story?`, schema: JUDGE_SCHEMA, maxTokens: 12 }, null);
      return (r && r.a) || 'unsure';
    };
    return {
      id,
      calls: 0,
      judgeRelations: tier !== 'quick',
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
      // yes only when it says yes to the claim and no to its opposite
      async judge({ claim, quote, paragraph }) {
        // a sex read from a pronoun alone ("Tamsin rode her") is left to the
        // writer: who a pronoun means is where small models go wrong
        if (claim.attr === 'sex' && !wordsOf(quote).some((x) => SEX_WORDS[x.replace(/'s$/, '')])) return 'unclear';
        const [is, isNot] = statements(claim);
        if (await yesNo(paragraph, is) !== 'yes') return 'unclear';
        return await yesNo(paragraph, isNot) === 'no' ? 'yes' : 'unclear';
      },
      // a choice, not a yes: the entity, the others named nearby, someone else
      async refers({ sentence, span, entity, paragraph, others = [] }) {
        // the quick reader picks the one name it is offered for "He" or
        // "She", whoever the sentence means (ACCURACY.md): not asked
        if (tier === 'quick' && PRONOUNS[norm(span)]) return 'unasked';
        // (in name order: the one asked about isn't always first)
        const options = [...new Set([entity, ...others.slice(0, 4)])].sort((a, b) => a.localeCompare(b)).concat(ELSE, UNSURE);
        const r = await safe({ system: REFERS_SYSTEM, user: `Paragraph:\n${paragraph}\n\nSentence: "${sentence}"\nIn this sentence, who or what does the word "${span}" refer to?\nOptions: ${options.join('; ')}`, schema: { type: 'object', properties: { a: { enum: options } }, required: ['a'] }, maxTokens: 24 }, null);
        // another of the options, or someone else: no; "cannot tell" or no answer: unclear
        return !r || r.a === UNSURE ? 'unclear' : r.a === entity ? 'yes' : 'no';
      },
      // 0–2 events of one paragraph; the gates (gateEvent) do the rest
      async events({ text, known = [] }) {
        this.calls++;
        const names = known.map((k) => `${k.name} (${k.kind})`).join(', ');
        const r = await safe({ system: STORY_SYSTEM, user: (names ? `Known names: ${names}\n\n` : '') + `Paragraph:\n${text}`, schema: STORY_SCHEMA, maxTokens: 220 }, null);
        return ((r && r.v) || []).map((x) => ({ who: x.w || [], did: x.d, where: x.p, quote: x.q }));
      },
      // does B give A's deed to someone else? The quick reader isn't asked:
      // the writer is (Worth a look)
      // Asked of each passage on its own, a choice: who did it, by this
      // sentence? (A small reader shown both passages takes A's word for
      // it.) B names someone else and A the one Canon has: yes; B the same:
      // no; anything else: unclear.
      // A deed of one kind done to one distinctive thing (the crust given)
      // is one event; anything else (two people sitting on beds) must also
      // be told as the very same event, asked with both passages.
      async contradicts({ a, who, did, sentence, question, others = [], kind = null }) {
        if (tier === 'quick') return 'unasked';
        const q = question || ('who ' + String(did || '').replace(new RegExp('^\\s*' + String(who).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), ''));
        const options = [...new Set([who, ...others.slice(0, 3)])].concat(ELSE, NOT_SAID);
        const choose = async (text) => {
          const r = await safe({ system: WHO_SYSTEM, user: `Sentence: "${text}"\nAccording to this sentence, ${q}?`, schema: { type: 'object', properties: { a: { enum: options } }, required: ['a'] }, maxTokens: 24, compact: true }, null);
          return r && r.a;
        };
        const inB = await choose(sentence);
        if (inB === who) return 'no';
        if (inB === NOT_SAID || !inB) return 'no';
        if (inB === ELSE) return 'unclear';
        if ((await choose(a)) !== who) return 'unclear';
        if (kind) return 'yes';
        const r = await safe({ system: SAME_EVENT_SYSTEM, user: `A: "${a}"\nB: "${sentence}"\nIs B about the same event as A?`, schema: ANSWER_SCHEMA, maxTokens: 10, compact: true }, null);
        return r && r.a === 'yes' ? 'yes' : 'no';
      },
      tier,
      // the editor's reading (READING.md), for the readers that do it
      editor: !!editor,
      parallel: 1,
      // (`names`: the capitalised names code found, so none is overlooked)
      async cast({ text, known = [], names: found = [] }) {
        this.calls++;
        const names = known.map((k) => `${k.name} (${k.kind}${k.aliases && k.aliases.length ? ': ' + k.aliases.join(', ') : ''})`).join('; ');
        const user = (names ? `Already in the story bible: ${names}\n\n` : '') + `Chapter:\n${text}\n\n` + (found.length ? `Names written in this chapter: ${found.join(', ')}\n` : '') + 'The cast list as JSON.';
        const r = await safe({ system: CAST_SYSTEM, user, schema: CAST_SCHEMA, maxTokens: 700, compact: true }, null);
        return { cast: ((r && r.c) || []).map((x) => ({ name: x.n, kind: x.k, aliases: x.a || [] })), setting: (r && r.s) || '' };
      },
      async dossier({ name, kind, aliases = [], text }) {
        this.calls++;
        const also = aliases.filter((a) => norm(a) !== norm(name.replace(/^the\s+/i, ''))).slice(0, 4);
        const r = await safe({ system: dossierSystem(kind), user: `Sentences about ${name} (${kind}${also.length ? ', also called ' + also.join(', ') : ''}):\n${text}\n\nFacts about ${name} as JSON.`, schema: DOSSIER_SCHEMA, maxTokens: 900, compact: true }, null);
        return (r && r.f) || [];
      },
      // `setting`: the chapter happens there, so its routines need not name it;
      // `other`: is it really someone else's; `lasting`: or one moment
      async verify({ name, label, value, passage, strict = false, setting = false, other = false, lasting = false }) {
        const about = setting ? `${name} (where this passage takes place)` : name;
        const q = strict ? `Is this stated, rather than guessed, about ${name}?` : other ? `Is this really about someone or something other than ${name}?`
          : lasting ? `Is this something lasting about ${name}, not one passing moment?` : setting ? `Does the passage state this as how things are or are done in ${name}?` : `Does the passage state this about ${name}?`;
        const user = `Passage:\n${passage}\n\nClaim about ${about}: ${label}: ${value}\n${q}`;
        const r = await safe({ system: strict ? STATED_SYSTEM : other ? OTHER_SYSTEM : lasting ? LASTING_SYSTEM : VERIFY_SYSTEM, user, schema: ANSWER_SCHEMA, maxTokens: 10, compact: true }, null);
        return (r && r.a) || 'unclear';
      },
      async profile({ name, kind, facts }) {
        this.calls++;
        const r = await safe({ system: PROFILE_SYSTEM, user: `${name} (${kind}). Facts:\n${facts.map((f) => `[${f.n}] ${f.label}: ${f.value}`).join('\n')}\n\nThe introduction as JSON.`, schema: PROFILE_SCHEMA, maxTokens: 260, compact: true }, null);
        return ((r && r.p) || []).map((x) => ({ t: String(x.t || ''), f: x.f || [] }));
      },
      // does B say otherwise of a kept fact? asked both ways: yes, and then
      // no to "can both be true"; the quick reader isn't asked (worth a look)
      async clash({ a, sentence, question }) {
        if (tier === 'quick') return 'unasked';
        if (!question) return 'no';
        const one = async (text) => { const r = await safe({ system: ALONE_SYSTEM, user: `Sentence: "${text}"\nAccording to this sentence, ${question}`, schema: ANSWER_SCHEMA, maxTokens: 10, compact: true }, null); return (r && r.a) || 'unclear'; };
        const inB = await one(sentence);
        if (inB === 'unclear') return 'no';
        const inA = await one(a);
        if (inA === 'unclear') return 'unclear';
        return inA !== inB ? 'yes' : 'no';
      },
      async pick() { return null; },
      abort() {}
    };
  }

  // The editor's reading (canon-editor.js), with the helpers it shares.
  // Main and the tests load it; the window has no need of it (it never reads).
  const Editor = typeof require === 'function' && typeof module === 'object' && module.exports ? (() => {
    try {
      return require('./canon-editor.js')({ norm, normMap, textHash, sentences, speechSpans, reportedSpans, mentions, mentionIndex, nameParts, wordsOf, slug, newEntry,
        findEntry, misspelt, gateQuote, PRONOUNS, SEX_WORDS, COLOURS, SPECIES, TITLES, LEADERS, ATTRS, canonLabel, labelFamily, KNOWN_KEYS, openLabel });
    } catch { return null; }
  })() : null;

  return {
    Editor, LABELS, canonLabel, labelFamily, KNOWN_KEYS, openLabel, factKind, factSection, SECTIONS, openIndex, editorSuspects,
    CAST_SCHEMA, DOSSIER_SCHEMA, PROFILE_SCHEMA,
    localReader, PROPOSE_SCHEMA, ANSWER_SCHEMA, JUDGE_SCHEMA,
    textHash, norm, normMap, decode, sourceParas, speechSpans, reportedSpans, sentences, mentionIndex, mentions, gateQuote,
    inSpans, nameParts, WORD, replaceInHtml,
    parseLinks, resolveName, entryLinks, linkGraph, backlinks, paraEntries, snippetAround, worldIndex, mentionPassages, searchPassages,
    ATTRS, KINDS, STATES, SEX_WORDS, PRONOUNS, PRONOUN_SWAP, KIN_SWAP, COLOURS, SPECIES, KIN, slug, attrOf, labelOf, normaliseFact, handFact, factKey,
    pronounEvidence, pronounSex, quoteIn,
    newEntry, parseEntry, serialiseEntry, dedupFacts, confirmFact, setAsideFact, replaceFact, mergeEntry, restoreFact, lexical,
    firmFact, editDistance, checkSources, createEngine, fakeReader,
    shelfEvidence, established, relation, misspelt, shelfNames, kinEvidence, shelfPlaces,
    gateEvent, storyIndex, rarity, STORY_SCHEMA
  };
});
