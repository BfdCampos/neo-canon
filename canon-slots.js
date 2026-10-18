// NEO — Canon's slots (READING.md §14, round 4): where a value stands, so
// two values of one thing meet whatever the reader called them.
//
// The real reader's labels drift ("Where", "Situated", "Address" for one
// place's place; "Shift start" and "Routine" for one woman's hours), and a
// later value filed under another label was kept as a second fact instead of
// meeting the first. Here a value's own shape says what it is a value of: a
// floor, a wing, a river's bank, a street, a compass point of something, the
// hour something is done, a school year, the subject someone teaches. Two
// claims of one entity in one slot that differ are a clash:
//
//   sure    the same slot, values that can't both hold (the second floor and
//           the third; ten every night and eight every night; Mill Lane and
//           Quay Road): a later one is the pass's slip, never a second fact
//   look    the same slot, values that may both hold (next to the chapel and
//           next to the sports hall; teaches biology and chemistry): worth a
//           look in the pass, Which is right? between the notes and the prose
//
// No I/O; nothing here reads a model. canon.js loads it with its helpers.
'use strict';

module.exports = function canonSlots(C) {
  const { norm } = C;

  const ORD = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, basement: -1 };
  const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };
  const num = (w) => { const t = norm(w); if (/^\d+$/.test(t)) return +t; if (UNITS[t] != null) return UNITS[t]; const m = /^(\d+)(?:st|nd|rd|th)$/.exec(t); if (m) return +m[1]; return ORD[t] != null ? ORD[t] : null; };
  const COMPASS = '(?:north|south|east|west)(?:-?(?:east|west))?';
  const CHANGE = /(?<![\p{L}])(?:moved|move|moving|relocated|rebuilt|now|newly|had become|became|used to|once|formerly|no longer|since the move|after the move|temporar\w*)(?![\p{L}])/iu;

  // the hour a thing is done: "at ten", "at half past eight", "at ten to nine", "at 6.30"
  const HOUR = '(?:\\d{1,2}(?:[.:]\\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  const TIME_RE = new RegExp(`(?<![\\p{L}])(?:at|from|until|till)\\s+((?:(?:half|quarter|five|ten|twenty|twenty-five)\\s+(?:past|to)\\s+${HOUR})|${HOUR}(?:\\s*(?:o['’]clock|am|pm|a\\.m\\.|p\\.m\\.))?|noon|midday|midnight)(?![\\p{L}\\d])`, 'giu');
  function minutes(t) {
    const s = norm(t).replace(/\s*o['’]clock$/, '');
    if (s === 'noon' || s === 'midday') return 12 * 60;
    if (s === 'midnight') return 0;
    let m = /^(half|quarter|five|ten|twenty|twenty-five)\s+(past|to)\s+(.+)$/.exec(s);
    if (m) {
      const h = num(m[3]);
      if (h == null) return null;
      const by = { half: 30, quarter: 15, five: 5, ten: 10, twenty: 20, 'twenty-five': 25 }[m[1]];
      return ((h % 12) * 60 + (m[2] === 'past' ? by : -by) + 720) % 720;
    }
    m = /^(\d{1,2})[.:](\d{2})/.exec(s);
    if (m) return ((+m[1] % 12) * 60 + +m[2]) % 720;
    const h = num(s.replace(/\s*(?:am|pm|a\.m\.|p\.m\.)$/, ''));
    return h == null || h > 24 ? null : (h % 12) * 60;
  }
  // what is done at that hour, by the words before it in its clause
  const ACTS = [
    ['start', /(?<![\p{L}])(?:start(?:s|ed)?|began|begins?|came on|comes? on|clock(?:s|ed)? on|went on duty|goes on duty|on duty|open(?:s|ed)?|shift)(?![\p{L}])/iu],
    ['end', /(?<![\p{L}])(?:end(?:s|ed)?|finish(?:es|ed)?|came off|comes? off|clock(?:s|ed)? off|knock(?:s|ed)? off|close[sd]?|shut)(?![\p{L}])/iu],
    ['wake', /(?<![\p{L}])(?:rose|rises?|woke|wakes?|got up|gets up|up)(?![\p{L}])/iu],
    ['bed', /(?<![\p{L}])(?:went to bed|goes to bed|to bed|lights out|turned in)(?![\p{L}])/iu]
  ];
  const EVENTS = /(?<![\p{L}])(assembly|mass|service|prayers|chapel|evensong|matins|roll call|roll-call|curfew|breakfast|lunch|luncheon|dinner|supper|tea|the post|the train|the bus|the ferry|the tide|the bell|the bells|visiting|visiting hours|surgery|school|class|lessons|parade|drill)(?![\p{L}])/iu;
  function actOf(before, label = '') {
    // (the nearest cue wins: "Her shift started at ten … and ended at six" gives the end its own)
    let best = null;
    for (const [k, re] of ACTS) {
      const all = [...before.matchAll(new RegExp(re.source, 'giu'))];
      const last = all[all.length - 1];
      if (last && (!best || last.index > best.at)) best = { k, at: last.index };
    }
    const ev = [...before.matchAll(new RegExp(EVENTS.source, 'giu'))].pop();
    if (ev && (!best || ev.index > best.at)) best = { k: norm(ev[1]).replace(/^the\s+/, ''), at: ev.index };
    if (best) return best.k;
    for (const [k, re] of ACTS) if (re.test(label)) return k;
    const e2 = EVENTS.exec(label);
    return e2 ? norm(e2[1]).replace(/^the\s+/, '') : null;
  }
  const HABIT = /(?<![\p{L}])(?:every|each|always|usually|nightly|daily|weekly|never|as (?:she|he|they|it|we|i) (?:did|does|had|always did)|as it was|as they were|on (?:mon|tues|wednes|thurs|fri|satur|sun)days|in the (?:mornings|evenings)|of a morning|of an evening)(?![\p{L}])/iu;

  // the slots a stretch of text gives values to → [{ slot, val, sure, span, start, end }]
  // `label`: the reader's label, for a bare value ("Shift start: eight")
  function claims(text, { label = '', bare = false } = {}) {
    const out = [];
    const t = String(text || '');
    const push = (slot, val, m, at, sure = true, extra = {}) => out.push({ slot, val: String(val), sure, span: m, start: at, end: at + m.length, ...extra });
    // a floor ("the second floor", "third-floor", "floor 3")
    for (const m of t.matchAll(/(?<![\p{L}])(ground|basement|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|top|\d+(?:st|nd|rd|th))[- ](?:floor|storey|story)(?!s)(?![\p{L}])/giu)) {
      const v = norm(m[1]) === 'top' ? 'top' : num(m[1]);
      if (v != null) push('floor', v, m[0], m.index, v !== 'top');
    }
    for (const m of t.matchAll(/(?<![\p{L}])floor\s+(\d+)(?![\p{L}\d])/giu)) push('floor', +m[1], m[0], m.index);
    // a wing, a bank, a compass side of something
    for (const m of t.matchAll(new RegExp(`(?<![\\p{L}])(${COMPASS}|left|right|old|new)[- ]wing(?![\\p{L}])`, 'giu'))) push('wing', norm(m[1]).replace(/-/g, ''), m[0], m.index, /north|south|east|west/i.test(m[1]));
    for (const m of t.matchAll(new RegExp(`(?<![\\p{L}])(${COMPASS}|left|right)[- ]bank(?![\\p{L}])`, 'giu'))) push('bank', norm(m[1]).replace(/-/g, ''), m[0], m.index);
    for (const m of t.matchAll(new RegExp(`(?<![\\p{L}])(${COMPASS})(?:ern)?\\s+(?:side|end|edge)\\s+of\\s+(?:the\\s+)?([\\p{L}][\\p{L}'’-]+)`, 'giu'))) push('side:' + norm(m[2]), norm(m[1]).replace(/-/g, ''), m[0], m.index);
    for (const m of t.matchAll(new RegExp(`(?<![\\p{L}])(${COMPASS})\\s+of\\s+(?:the\\s+)?([\\p{L}][\\p{L}'’-]+)`, 'giu'))) if (!/(?:side|end|edge)$/i.test(t.slice(0, m.index).trim())) push('of:' + norm(m[2]), norm(m[1]).replace(/-/g, ''), m[0], m.index);
    // a street ("on Mill Lane", "in Quay Road")
    for (const m of t.matchAll(/(?<![\p{L}])(?:on|in|off|along|at|down|up)\s+((?:\p{Lu}[\p{L}'’-]+\s+){1,3}(?:Street|Road|Lane|Avenue|Row|Square|Way|Close|Terrace|Place|Crescent|Drive|Gardens|Walk|Parade|Mews|Green|Hill))(?![\p{L}])/gu)) push('street', norm(m[1]), m[1], m.index + m[0].indexOf(m[1]));
    // a neighbour: what may stand beside two things at once (worth a look at most)
    for (const m of t.matchAll(/(?<![\p{L}])(?:next to|beside|alongside|opposite|across from|behind|in front of)\s+(?:the|a|an)\s+((?:[\p{Ll}-]+\s+){0,2}?[\p{Ll}-]+)(?=\s*(?:[,.;:]|$|\s+(?:and|with|which|where|that|on|in|at|of|had|has|was|were|is)\b))/gu)) push('near', norm(m[1]).split(/\s+/).pop(), m[0], m.index, false);
    // the hour something is done
    for (const m of t.matchAll(TIME_RE)) {
      const mins = minutes(m[1]);
      if (mins == null) continue;
      const before = t.slice(Math.max(0, t.lastIndexOf(';', m.index) + 1, t.lastIndexOf(':', m.index) + 1), m.index);
      // ("at ten she left school" is an age; "at ten years old")
      if (/^\s*(?:years?|months?|minutes?|miles?|feet)\b/i.test(t.slice(m.index + m[0].length))) continue;
      const act = actOf(before, label);
      if (!act) continue;
      push('time:' + act, mins, m[1], m.index + m[0].indexOf(m[1]), true, { habit: HABIT.test(t) });
    }
    // a bare value, its slot by the label: "Shift start: eight", "Situated: west bank"
    if (bare && !out.length) {
      const v = String(text).trim();
      const mins = /^(?:at\s+)?[\p{L}\d.:'’ -]+$/u.test(v) ? minutes(v.replace(/^at\s+/i, '')) : null;
      const act = mins != null && /\b(?:shift|start|starts|came on|on duty|time|hours?|schedule|timetable|routine|daily|rises?|wakes?|bed|ends?|finish)\b/i.test(label) ? actOf('', label) || 'start' : null;
      if (act) push('time:' + act, mins, v, 0, true, { habit: true });
    }
    // a school year, a form ("Year Ten", "Year 10", "the fifth form")
    for (const m of t.matchAll(/(?<![\p{L}])Year\s+(\d{1,2}|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen)(?![\p{L}\d])/gu)) push('year', num(m[1]), m[0], m.index, false);
    for (const m of t.matchAll(/(?<![\p{L}])(first|second|third|fourth|fifth|sixth|lower sixth|upper sixth)[- ]form(?![\p{L}])/giu)) push('year', norm(m[1]), m[0], m.index, false);
    // the subject someone teaches
    for (const m of t.matchAll(/(?<![\p{L}])(?:teach|teaches|taught|teaching)\s+(?!(?:him|her|them|me|us|you|it|the|a|an|at|in|for|to|there|here|school|children|girls|boys|pupils)\b)(\p{L}[\p{L}-]+)/giu)) push('teaches', norm(m[1]), m[0], m.index, false);
    return out;
  }

  // Which slots an entity of each kind holds one value in. A place stands on
  // one floor, in one wing, on one bank and one street; a person's floors are
  // many things' (where she was born, where she sleeps), so a person has the
  // hours of what they do, a school year and what they teach.
  const KIND_SLOTS = {
    place: /^(?:floor|wing|bank|street|side:|of:|near|time:)/, thing: /^(?:floor|wing|bank|street|side:|of:|near|time:)/, group: /^(?:time:)/,
    person: /^(?:time:|year|teaches)/, creature: /^(?:time:)/
  };
  const forKind = (kind, xs) => xs.filter((x) => (KIND_SLOTS[kind] || /^time:/).test(x.slot));
  // a fact's claims: its value's own (the reader's label for a bare value);
  // a routine's hour from its quote when the value leaves it out
  function factClaims(f, quote = '', kind = 'thing') {
    const label = f.label || '';
    const v = claims(f.value, { label, bare: true });
    if (v.length) return forKind(kind, v);
    if (quote && /routine|habit|schedule|shift|custom/i.test(label)) return forKind(kind, claims(quote, { label }).filter((x) => x.slot.startsWith('time:')));
    return [];
  }

  // Two claims of one entity: { sure } when they meet and differ, else null.
  // A time meets a time of the same doing; both must be what is done every
  // day, night or week (one late morning is no routine).
  function clash(a, b) {
    if (!a || !b || a.slot !== b.slot) return null;
    if (String(a.val) === String(b.val)) return null;
    if (a.slot.startsWith('time:') && !(a.habit && b.habit)) return null;
    return { slot: a.slot, sure: a.sure && b.sure };
  }
  // any clash between two lists of claims → the first { a, b, sure } or null
  function clashOf(as, bs) {
    let look = null;
    for (const a of as) {
      for (const b of bs) {
        const c = clash(a, b);
        if (c && c.sure) return { a, b, sure: true };
        if (c && !look) look = { a, b, sure: false };
      }
    }
    return look;
  }

  // The claims a sentence makes of one entity: those in the clause its name
  // (or its sentence-opening pronoun) starts, after it, with no other of the
  // cast named between. `at`: [start, end] of its mentions in the sentence;
  // `others`: the same for everyone else. A clause that tells a change
  // ("had moved to the third floor") says nothing against what was.
  function claimsAbout(sentence, at, others = [], kind = 'thing') {
    const out = [];
    for (const c of forKind(kind, claims(sentence))) {
      const mine = at.filter(([, e]) => e <= c.start).pop();
      if (!mine) continue;
      const between = sentence.slice(mine[1], c.start);
      // (the same clause: no full stop, semicolon or ", and" with a new subject between)
      if (/[;.!?]/.test(between) || /,\s+(?:and|but)\s+(?:he|she|they|it|\p{Lu})/u.test(between) || /\b(?:who|which|that|where)\s+\p{Ll}+/u.test(between) && between.split(/\s+/).length > 8) continue;
      if (others.some(([s, e]) => s >= mine[1] && e <= c.start)) continue;
      const clause = sentence.slice(Math.max(0, sentence.lastIndexOf(',', mine[0]) + 1), c.end + 30);
      if (CHANGE.test(clause)) continue;
      out.push(c);
    }
    return out;
  }

  return { claims, factClaims, clash, clashOf, claimsAbout, minutes, forKind, CHANGE, HABIT };
};
