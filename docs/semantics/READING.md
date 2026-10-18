# Reading like an editor — Canon's reading engine, rebuilt

The owner's user test, on a 1,345-word chapter of their own: Canon kept *Pio · Sex: female* and nothing about the Academy. A story editor would have written a page. The causes were the engine's design, not the model alone: a closed vocabulary (sex, species, eyes, hair, born, kin, owner, home), one paragraph at a time with no cast list and no chapter, and a 4B model asked to do everything in one pass. This page is the rebuild the owner approved: a multi-pass *editor workflow*. The principle stays: **the reader proposes, code decides; never generate prose for the book.** What changes is what the reader is allowed to propose (open facts), what it sees (an entity's every passage), and how many times it is checked (a verifier and an editor pass).

Targets: recall a writer finds useful (a lead character ~15 facts per chapter like this one, the main place ~10), precision ≥ 95% on open facts and 100% on hard traits, **zero false slips**. Accuracy over speed.

## 1. The passes

```
chapter text ──► 1 CAST ──► 2 DOSSIERS (one per entity, in parallel) ──► 3 VERIFY ──► 4 EDITOR ──► entries/*.md
                 (model)     code gathers passages; model lists facts    (model,      (code merges,
                                                                          per fact)    model: profile)
later chapters ──► 5 SLIPS: hard traits by rule (as now) · open facts: code finds candidates, model confirms
                   · deeds: Story so far (STORY.md, as now)
```

Every pass's answer is grammar-constrained JSON (node-llama-cpp `createGrammarForJsonSchema`), short keys, temperature 0. Every pass is cached per input hash (§7). The model never writes a quote: **it cites sentence ids, and code copies the writer's words** — so a misquote is impossible by construction and output tokens fall by ~70%.

### Pass 1 — Cast (one call per chapter)

Input: the chapter, paragraphs numbered `¶1…¶n`; the Canon's existing cast (`name · kind · aliases`) so the reader reuses names. Prompt sketch: *"List every person, creature, place, group, thing and rule of the world this chapter names or refers to by role ('the warden'). Include aliases exactly as written."*

```json
{"c":[{"n":"Hesper","k":"person","a":["Forty-one"],"p":[1,3]},{"n":"the warden","k":"person","a":[],"p":[3,5]},
      {"n":"the Spared","k":"group","a":[],"p":[8]}]}
```
`n` name, `k` kind (person|creature|place|group|thing|rule), `a` aliases, `p` paragraphs where it appears.

Code decides:
- Each name and alias must be in the chapter, verbatim, with its capitals (a role name "the warden" in lower case, written ≥ 2 times). A pronoun, a misspelling (`misspelt`), a word the shelf writes both ways ("Ponies") is dropped, as ACCURACY.md rule 5.
- A cast name equal to an entry's name or alias joins that entry. A role name that a later passage ties to a proper name ("His name … was Anselm") becomes an alias by rule — the model may propose the tie, the quote must state it ("name … was", "called", "known as").
- Deterministic extras stay: `shelfPlaces`, `kinEvidence`, scare-quoted capitalised terms (`the “Spared”`) as group candidates.

### Pass 2 — Dossiers (one call per entity per chapter, in parallel)

Code gathers the **passage pack** for an entity: every sentence that names it or an alias; the sentences after it whose subject pronoun agrees with the entity and no other entity is named in between (the `referent` rule, ACCURACY.md 9, extended across sentences of one paragraph); and for places and groups, every sentence in a paragraph that opens with the place ("Forty beds ran down the Long Room…"). Sentences are numbered `[s1]…[sN]` and carry their paragraph's speech spans (marked «…» so the model sees what is said). Capped at ~1,500 tokens; a long pack is split and the halves' facts merged by the editor.

Prompt sketch (per kind; the person version): *"From these sentences only, list what a story editor would note about HESPER: appearance (body, height, hair, eyes, face, clothing, marks), age, role/job, personality, habits and routines, relationships, origin and history, state, possessions. One fact per line, value ≤ 10 words in the text's own words, cite the sentence ids that state it. Skip anything only said by a character (mark it said), guessed, or about someone else."* Places: what it is like (sight, sound, smell, temperature), layout and parts, how it works (routines, rules), who is there. Groups: who belongs, how you tell, customs, rules. Rules of the world: the rule, its consequence, who keeps it.

```json
{"f":[{"g":"appearance","a":"hair","v":"cropped close, fair as wet straw","s":[7]},
      {"g":"origin","a":"born","v":"third floor, room with the green tiles","s":[14]},
      {"g":"relationship","a":"friend","v":"Coll","s":[11],"x":0}]}
```
`g` group (closed enum, §4), `a` open label (≤ 3 words), `v` value, `s` sentence ids (1–3), `x` 1 if only said in speech. The schema caps `f` at 25 items; `v` at 80 characters.

**Self-consistency (GPU tiers):** the dossier is asked twice — the second time with the pack's sentences in reverse order inside each paragraph — and a fact is kept only when both lists hold it (same group, value token overlap ≥ 0.5, a shared sentence id). Facts in only one go to the verifier with a stricter bar (both directions, §3). On the CPU this is off; the verifier carries it.

### Pass 3 — Verifier (one short call per fact)

The gates, in order; failing any drops the fact quietly into the cache's `dropped` with the reason (never Needs You):
1. **Cited** — every `s` id exists in the pack. The quote is the cited sentence(s), copied by code; trimmed to the clause holding the value's words when that clause stands alone.
2. **Tied** — the cited sentence names the entity (name or alias), or its subject pronoun resolves to it by `referent` (strong), or — for places and groups — the sentence lies in a paragraph the entity opens. Otherwise the verifier is asked *"In this sentence, who or what does 'she' refer to?"* with options (as `refers` today); only the entity's name passes.
3. **Grounded** — at least half the value's content words share a stem with the cited sentences, or map through the lexicon (`girl` → female, `tallest` → tall, `not one window` → no windows). Interpretive groups (personality, relationship) may instead pass on a double *yes* (step 4 asked twice, the second as "Is this stated, not guessed?").
4. **Supported** — *"Sentences: … Claim: Hesper — hair: cropped close, fair as wet straw. Do the sentences state this about Hesper? yes / no / unclear"*. Only *yes* keeps it. A fact the dossier marked `x` (said) is kept as said, never as true; one the code finds inside speech or reported speech (`speechSpans`, `reportedSpans`) is said whatever the model marked.
5. **Hard traits** (sex, species, eye and hair colour) still need deterministic evidence (`shelfEvidence`, ACCURACY.md 2): an open fact can carry "fair as wet straw", but only the rule makes *Hair: fair* a trait that raises slips.

Schema: `{"a":"yes"|"no"|"unclear"}`, max 4 tokens. On the CPU, facts sharing a cited sentence are verified together (`{"a":["yes","no",…]}`, ≤ 6 per call); on the GPU each alone.

### Pass 4 — Editor (code first; one model call per entity)

Code: normalises each label to the canonical set (§4); merges facts of one entity with the same canonical attribute and value-token overlap ≥ 0.6 (sources unioned, the earliest wording kept); applies **first said, first kept** (ACCURACY.md 10) to single-valued attributes (sex, species, eyes, hair colour, age, born in, height when stated as a measure); keeps every value of attributes that change (state, role, location, possession, relationship). Conflicts follow today's rules: the writer's notes against the prose → *Which is right?* in Needs You; a later prose value → the pass's slip, not a fact.

Model (one call per entity whose kept facts changed): near-duplicates code didn't catch — *"Which of these numbered facts say the same thing? Give groups of ids and the id whose wording is best."* `{"m":[[3,7],[9,12]],"best":[7,9]}`; code applies a merge only within one canonical family. Then the **profile**:

*"Write 2–4 short sentences introducing HESPER for a story bible, using only these numbered facts. End each sentence with the ids it uses, like [2,5]. No fact not listed; no guess."* `{"p":[{"t":"Hesper is fifteen, the tallest girl in her year, and one of the Spared.","f":[1,2,6]}]}`

Code keeps a profile sentence only when every content word in it stems from its cited facts' values or quotes, or is a function word or the entity's name; ids map to the facts' first sources. A profile is made again only when the kept facts' hash changes. A profile is the second place (after Story so far) where the reader writes words, and like it is labelled *Canon's profile*, never manuscript text.

### Pass 5 — Slips

- **Hard traits**: unchanged (the deterministic checkers in `checkSources`, the reader asked only for weak referents).
- **Deeds**: unchanged (STORY.md §5).
- **Open facts** (new, verify-then-flag): for each sentence checked (not speech, plan, question, or belief — the existing exclusions), code retrieves the entity's kept open facts from *earlier* in reading order that (a) the sentence is tied to by Pass 3's rule 2, and (b) share a distinctive word with it or a polarity cue against it (`no/not/never/nothing/always/only` on one side, the same head noun on the other: *window*). Then the reader: *"A (Ch 1): 'and not one window between the lot'. Canon has: the Long Room — no windows. B: 'Grey light came down through the Long Room's high windows…' Does B contradict A about the Long Room?"* and, on yes, the other way round *"Can A and B both be true?"* Only yes-then-no is a slip (mark on the span B's words share with the fact); *unclear* or the Quick reader → Worth a look; no reader → nothing. A sentence about another entity of the same kind (the infirmary's one window) fails the tie and is never asked. An exception stated as one ("On feast days it went twelve") is the reader's to answer — the dev set holds it as a decoy.

Kept open facts never raise a slip on their own unchecked state: a fact that failed a gate isn't in the entry, and unverified facts never flag (unchanged rule).

## 2. Who decides what

| Decision | Model proposes | Code decides |
|---|---|---|
| Who is in the chapter | cast list, aliases, kind | verbatim names, capitals, misspellings, joining entries |
| Which passages are about X | — | name/alias matches, pronoun chains (`referent`), place paragraphs |
| What the facts are | group, label, value, sentence ids | quote = cited sentence(s); tie; grounding; speech → said |
| Whether a fact holds | yes / no / unclear (once or twice) | only yes keeps; hard traits need rule evidence |
| Duplicates, labels, conflicts | merge groups (one family only) | canonical labels, first said first kept, Needs You |
| Profile | sentences with fact ids | every word grounded in cited facts, else dropped |
| Slips | contradiction yes/no both ways | candidates, ties, exclusions, the mark's span |

## 3. Attribute groups and normalisation

Closed **groups** (the schema enum): `appearance, age, sex, role, personality, habit, relationship, origin, history, state, possession, description, location, rule, membership, other`. Open **labels** under them, mapped to canonical keys by a table in `canon.js` (the one `scripts/canon-score.js` uses, `canonLabel`): `appearance.{hair, eyes, height, build, face, clothing, mark, other}`, `sex`, `age`, `role`/`occupation`, `personality`, `manner.speech`, `habit`/`routine`/`custom`, `relationship.{friend, kin, enemy}`, `origin`, `history`, `state`, `possession`, `location.{home, part}`, `description`, `atmosphere`, `residents`, `rule`, `membership`/`members`, `function`/`use`/`effect`, `name`. A label the table doesn't know stays as written under its group. Today's attributes keep their meaning: Eyes = `appearance.eyes`, Born in = `origin`, Sibling/Parent of/Child of/Married to = `relationship.kin`, Owner = `possession` (inverse), Lives in = `location.home`, Title = `role`.

## 4. In the entry, and in the file

The entry page groups facts under small headings in a fixed order — Profile, **Appearance**, **Who they are** (age, role, personality, membership), **Habits and routines**, **Relationships**, **Origin and history**, **State**, then for places **What it's like**, **How it works**, **Who's there**, then **Other** — each group folded after six lines. The group is derived from the label through the table, so the file needs no new syntax:

```markdown
---
id: hesper
name: Hesper
kind: person
aliases: [Forty-one]
---
# Hesper

## Profile
Hesper is fifteen, the tallest girl in her year, and one of the Spared [1]. She was born on the third floor and has never been further than the outer gate [2].
- [1] Under the Line, Ch 1: "Hesper was fifteen and the tallest girl in her year" {book:book-under-the-line-wh1, ch:c1}
- [2] Under the Line, Ch 1: "Hesper had been born on the third floor, in the room with the green tiles, and she had never once been further than the outer gate" {book:book-under-the-line-wh1, ch:c1}
- Canon’s profile {note:k3d9xa}

## Facts
- Sex: female (girl) · verified
  - Under the Line, Ch 1: "Hesper was fifteen and the tallest girl in her year" {book:book-under-the-line-wh1, ch:c1}
- Hair: fair (fair as wet straw) · verified
  - Under the Line, Ch 1: "Her hair was cropped close to the skull and fair as wet straw" {book:book-under-the-line-wh1, ch:c1}
- Habit: keeps her hands still · verified
  - Under the Line, Ch 1: "She kept her hands still." {book:book-under-the-line-wh1, ch:c1}
```

Compatibility, checked against `parseEntry` today:
- `## Profile` comes before `## Facts`. Today's parser keeps every line there in `lead.top` and writes it back byte for byte, so an older build (or Pocket) round-trips a profile untouched. The new parser reads the citation lines with the source-line syntax.
- `- [n] …` lines are the profile's sources; `note:` is the hash of the prose Canon wrote. Words that no longer match it are the writer's: never rewritten, still checked for citations (STORY.md's rule for Canon's notes).
- Open facts are ordinary fact lines with a label (`attr: 'other', label`), as a hand-typed fact is now. States are unchanged: a verified open fact is `verified`; one only said is `unverified` with `said`. Facts are written in group order, then reading order.
- A writer's hand-typed fact, a fact line Canon doesn't know, a note under a fact: kept where they are, as today.

## 5. Parallelism and hardware

The worker (`canon-worker.js`) gains `sequences`: the context is created with `sequences: N` and each prompt takes a free `LlamaContextSequence`; node-llama-cpp batches the sequences' tokens together on the GPU. N = 4 on a GPU with room (Thorough on a 10 GB card: weights 5.0 GB + KV cache f16 ~144 KB/token × 4 sequences × 4,096 tokens ≈ 2.4 GB), 2 on Apple silicon, 1 on the CPU (parallel sequences only split the same cores). `canon.js` runs each pass as a promise pool of size `reader.parallel`. Dossiers of different entities, and verifications of different facts, are independent; the editor pass waits for its entity's verifications.

Qwen3-8B and 14B are hybrid-thinking models: the worker loads them with `QwenChatWrapper({ thoughts: 'discourage' })` (and the grammar leaves no room for a think block). Context 8,192 for the cast pass, 4,096 for the rest.

## 6. Time budget (measured on the dev chapter, M1)

The dev shelf (*The Weighhouse*, 1,670 words in two chapters), model time summed over every call, 4-core CPU VM with no GPU, 4 threads, one sequence; cold load not included (Careful 4B: 251 s from a cold disk, 15 s warm). See §11 for the Thorough run.

| Pass | Calls (dev) | Careful 4B, CPU, measured | RTX 3080, Thorough 8B, 4 sequences (estimate; the owner measures) |
|---|---|---|---|
| Cast | 2 (one a chapter) | 62 s a call | ~5 s |
| Dossiers | 20 (13 entities, long packs in two parts) | 46 s a call (13–170 s) | ~25 s |
| Verifier and the referent / "someone else" / "lasting" questions | 142 | 2.1 s a call (a passage asked about twice is read once) | ~15 s |
| Story so far (events, as before) | 35 | 8.1 s a call | ~10 s |
| Profiles | 10 | 17 s a call | ~10 s |
| The pass (slips, later chapter) | ~10 | ~3 s a call | ~5 s |
| **Total** | 209 | **~31 min for 1,670 words** (1,887 s read + 12 s pass) | **~1–1.5 min a chapter** |

Thorough 8B on the same CPU (plain Node, to check quality, not speed): cast 131 s, dossier 87 s, a question 4.8 s, events 13 s, profiles 24 s a call; 286 calls, **~60 min** of model time for the dev shelf.

The progress line names the pass ("Finding who and what is here…", "Reading about Hesper… (3 of 12)", "Checking facts… (40 of 104)", "Noting what happens…", "Writing profiles…") and estimates what is left from how long each kind of question has taken on this computer.

A 90,000-word novel is a first read of ~1.5–2 h on the 3080 (once; every later read is the changed chapters only) and is not a reasonable first read on a 4-core CPU with Careful (~20 h): there the Quick tier keeps today's per-paragraph engine, and the editor workflow runs per chapter on request. Reading still pauses while the writer types (`CANON_RESUME_MS`).

## 7. Caching and incrementality

`canon-cache/<canonId>/index.json` (device only) gains, keyed by model id and prompt version:
- `cast[book/ch]` by the chapter's text hash;
- `dossier[entity/book/ch]` by the hash of the entity's passage pack (a chapter edit far from Hesper leaves her dossier cached);
- `verdict[fact]` by hash of (claim, cited sentences);
- `profile[entity]` by the hash of its kept facts;
- `dropped` as today, with the gate that dropped each proposal.
`canon.json` `read` keeps the chapters whose facts are current. Facts are re-derived per chapter like Story so far: a chapter read again replaces Canon's facts whose sources are all in it; the writer's facts (`yours`), set-aside and not-right lines are never touched.

## 8. Readers

| Tier | Writer sees | File (pinned) | Size | Picked when |
|---|---|---|---|---|
| `thorough` (new) | Thorough reader | `Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974` · `Qwen3-8B-Q4_K_M.gguf` · sha256 `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` | 5,027,783,488 B | GPU ≥ 8 GB; Apple silicon ≥ 24 GB |
| `deep` (settings only) | Deep reader | `Qwen/Qwen3-14B-GGUF` @ `530227a7d994db8eca5ab5ced2fb692b614357fd` · `Qwen3-14B-Q4_K_M.gguf` · sha256 `500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0` | 9,001,752,960 B | offered at GPU ≥ 12 GB; on 10 GB it spills layers to the CPU |
| `careful` | Careful reader | unchanged (Qwen3-4B-Instruct-2507) | 2.5 GB | GPU 6–8 GB; Apple silicon 16 GB |
| `quick` | Quick reader | unchanged (Qwen2.5-1.5B) | 1.1 GB | CPU only, ≥ 8 GB |

Both new files were checked against the Hugging Face API (repo sha, file size, LFS sha256; `resolve/<sha>/<file>` answers 302 to the CDN). Licence Apache-2.0. `readerPick` gains the `vramGB >= 8 → thorough` branch; the owner's RTX 3080 (10 GB) gets Thorough. **Provider slot:** every pass goes through the reader interface (`cast, dossier, verify, merge, profile, contradicts`), so stage 2's `httpReader` (ARCHITECTURE.md §5.5) drops in with the same prompts and JSON schemas; `reader.id` in every cache key keeps answers apart.

## 9. Measuring: answer sheets and `scripts/canon-score.js`

Two sets, written for this rebuild (original text, the owner's chapter's shape: an institution with routines, a sensory place, a lead seen through action and pronouns, people known by role, a caste term in quotes, scare quotes, straight and curly dialogue, a rule of the world in narration, and a short Ch 2 with three slips — a hard trait, an open-fact contradiction, a deed swap — and decoys):
- **dev**: *The Weighhouse* (`scripts/fixtures/canon-editor/dev/`): 1,284 + 386 words; 13 entities, 94 facts (41 must), 10 key points, 3 slips (+1 optional), 9 decoys. Build against it.
- **held-out**: kept outside the repository by the evaluation lead; never read by the builder. The final gate.

`answers.json`: entities (kind, aliases, weight, `profile`), facts (canonical attr, value, verbatim `quote`, `also`, `alt` phrasings, must/should/nice, `hard`, `said`), `traps` (claims a reader is likely to make that are wrong), key points, slips with span and the passage they contradict, decoys. `node scripts/canon-score.js --check <answers.json>` proves every quote verbatim.

`node scripts/canon-score.js <run> <answers.json> [--review] [--reviewed <file>] [--json <file>]`, where `<run>` is what `node scripts/canon-eval.js --fixture <dir> --model <tier> --keep <out>` leaves (`canon/entries/*.md` and `slips.json`). Deterministic matching: canonical attribute family (exact 1, family 0.8, catch-all 0.5), value tokens (stemmed, stop words out, a synonym table, the sheet's `alt` phrases), quote overlap; the value must overlap or it is a different claim from the same quote. Precision: a kept fact is *supported* (matches the sheet), *wrong* (a trap, a misquote, a said fact kept as true) or *to review* — quote verbatim, claim not on the sheet — listed for a person, whose judgement goes in `--reviewed` (never guessed). Slips: found / missed / false (decoys named), Worth a look apart. Profiles: present, every sentence cited, every citation verbatim. `scripts/canon-score.test.js` (in `npm test`) holds the matcher to a perfect run (100%) and to its traps.

### Baseline (current engine, before the rebuild)

| Engine / reader | Set | Entities | Must facts | Weighted facts | Precision | Key points | Slips | False slips | Model time |
|---|---|---|---|---|---|---|---|---|---|
| fake reader | Ashfall Road (legacy expected.json) | 7/7 | 13/13 | 95% | 100% | 4/4 | 6/6 | 0 | — |
| no reader | dev | 0/13 | 0/41 | 0% | — | 0/10 | 0/3 | 0 | — |
| Careful (4B, CPU) | dev | 2/13 | 0/41 | 0% | — (0 kept) | 4/10 (must 1/5) | 0/3 | 0 | 1,203 s (60 calls, 4 threads) |

The legacy fixture scores full marks because its expected facts *are* the closed vocabulary; on the dev chapter the same engine finds what the owner saw: two entries (Hesper, Coll), no place, group or role-named person, and one fact — *Sex: female*, left unverified and wrongly marked as said, because "too tall, the warden said" later in the sentence counts as reported speech touching the quote. Its 15 Story so far lines are verbatim and sensible, 4 of them on the sheet; the three slips are missed (hair was never established; there is no Long Room; the crust deed is on Coll but "the warden" is no entry).

## 10. Milestones and acceptance (dev set; held-out is the final gate)

| M | Build | Accept on dev (Careful on this CPU; Thorough on the owner's 3080, from a memo file he sends back) |
|---|---|---|
| M1 | Worker: `sequences`, `thoughts: 'discourage'`, Thorough/Deep in the catalogue, `readerPick`; time the passes on CPU (and the 3080 by the owner) | Thorough loads; parallel answers equal sequential ones; §6 table replaced by measurements |
| M2 | Cast pass + passage packs (code) | entity recall must 100%, weighted ≥ 90%; no pronoun or misspelt entry; packs hold ≥ 95% of the sheet's must quotes |
| M3 | Dossiers + verifier + gates; open facts in the file | must-fact recall ≥ 80% (Thorough) / ≥ 65% (Careful); weighted ≥ 65%; precision ≥ 95% after review; 0 traps; 0 misquotes; hard traits 100% precise |
| M4 | Editor: normalisation, merges, first said first kept, profiles | profiles present and fully cited for every `profile: true` entity; no duplicate facts (same family, overlap ≥ 0.6); existing `npm test` green |
| M5 | Open-fact slips (verify-then-flag) | dev slips 3/3, 0 false slips, decoys never flagged; Ashfall and Lantern Coast unchanged (100% precision, 0 false slips) |
| M6 | UI: grouped facts, profile, Needs You copy; e2e; docs | the owner re-runs his own chapter; then the **held-out set once**: must recall ≥ 75%, precision ≥ 95%, 0 false slips, profiles cited |

A miss on the held-out set sends the work back to dev with a written reason; the held-out sheet is not opened by the builder at any point, and it is replaced (a new one written) if it ever is.

## 11. Results (dev set)

Runs with `scripts/canon-eval.js --fixture scripts/fixtures/canon-editor/dev --model <tier> --keep <dir>` and `scripts/canon-score.js`, 4-core CPU, no GPU, after the tuning below. Precision "after review" counts the kept facts that are not on the sheet as the builder judged them (`scripts/fixtures/canon-editor/dev/reviewed-<tier>.json`: true when the label and value hold of that entity in the text; wrong when they don't, or call one moment a habit); the evaluation lead may judge them otherwise. Held-out: not run (not seen by the builder).

| Engine / reader | Entities | Must facts | Weighted facts | Precision on sheet | Precision after review | Key points | Slips | False slips | Profiles (cited) | Model time |
|---|---|---|---|---|---|---|---|---|---|---|
| before: Careful (4B), per paragraph | 2/13 | 0/41 | 0% | — (0 kept) | — | 4/10 | 0/3 | 0 | 0/7 | 1,203 s |
| **after: Careful (4B), editor's reading** | 11/13 (90% weighted) | **29/41 (71%)** | 55% | 53/53 | **64/65 (98%)** | 5/10 (must 2/5) | **3/3** | **0** | 4/7 (4) | 1,899 s |
| after: Thorough (8B), CPU | 11/13 (90%) | **30/41 (73%)** | 56% | 52/52 | 60/70 (86%) | 4/10 (must 1/5) | **3/3** | **0** | 5/7 (5) | 3,601 s |
| after: fake reader (the e2e's answers) | 8/13 | 21/41 | 34% | 25/25 | — | 0/10 | 2/3 | 0 | 3/7 | — |

Acceptance (§10) on dev with Careful: M2 entity recall must 7/7 (the Weighhouse, named once, comes in as the setting; the valley and the scale, should and nice, are missed), weighted 90%; no pronoun or misspelt entry. M3 must recall 71% ≥ 65%, precision 98% ≥ 95%, 0 traps, 0 misquotes, hard traits 100% (Sex, Hair kept only by the rules). M4 profiles for 4 of the 7 `profile: true` entities, every sentence cited and verbatim; the warden's and the Weighhouse's were left out (the warden's sentences held words in no fact; the Weighhouse keeps one fact). M5 slips 3/3, 0 false, no decoy flagged. M6 UI and e2e: done; the owner's chapter and the held-out set are for the owner and the evaluation lead.

**Thorough on dev**: recall is the Careful reader's or a little more, but its verifier says yes to more of the dossiers' stray readings (the yard given the mountain's tip, the ledger "red" for its red ribbon, Coll's one glance kept as a habit): 86% after review, below the 95% bar. Its 0 false slips held. Before the Thorough tier is the 3080's default the owner should run it there (with `sequences: 4` it is also the first GPU measurement) and the review should be repeated; the gates added for its first run (a place's sentence about a person is the person's; an appearance never names another of the cast) took it from 41 facts to review to 18.

What the runs changed (each a commit): naming ties joined through the words the text used ("the weigher" ↔ "Brother Ink" ↔ "Anselm"); the setting only an institution or building, never a room, and only its routines and rules; polarity read beside the value's own words; a habit must be said to recur; a fact tied by a pronoun or a paragraph asked whether it is really someone else's, and a habit or state whether it lasts; a person called by a role has that role; the slip questions asked of each passage alone ("does the Long Room have windows?", "who gave the crust?"), because a small reader shown both took A's word for it, and a deed of no one kind (two people sitting) asked whether it is the same event; "wrote every number" and "could say it" are no reports; an owning "her" after "took" is not the subject's.

Still missed with Careful (dev): the Weighhouse's six routines (its sentences name no one and nothing of it; asked as the setting, the verifier says no), Hesper's membership of the Spared and the inked 41 (two sentences apart), her "getting less", the Long Room's smell, the Spared's custom, the two "friend" facts (kept as "nearest thing she had to a friend", which the sheet's matcher doesn't take for "friend"). Story so far is unchanged (5/10).

## 12. Round 2: the held-out evaluation, and what changed

The evaluation lead ran Careful on six stories the builder had never seen (`/tmp` only, never opened by the builder; their brief gives failure *types*, no text). On unseen prose the dev numbers did not hold: must recall 37%, reviewed precision ~55–72%, slips 1/17 with 9 false, an unsupported sentence in every profile, and a crash (`swapPronoun`: "He's" was in no table). The fixes are rules in code, each written against a failure type rather than a story (ACCURACY.md rules 12–20), and measured on **dev2**: five new stories the builder wrote for the types (`scripts/fixtures/canon-editor/dev2/`: a first-person narrator named once in speech with kin on both sides; an institution with a numbered nickname, surnames and an epithet; a dialogue-heavy crime with lies, reported speech and mixed quotes; a writer's notebook the prose contradicts and an ideas page left out of Canon; a town and its river, a house and its surgery, a hall and its gallery, a car by make and model). Each sheet adds `notEntities` (what must not become an entry) and `needs` (the Which is right? questions a run must raise); `canon-score.js` counts both, and every profile sentence's words against the entry's kept facts.

| Failure type (held-out brief) | What decides now |
|---|---|
| Crash in the pronoun swap | every form swaps or nothing does; `scripts/canon-fuzz.test.js` runs every text-level function, Read the Shelf and the pass over generated sentences with a reader that answers anything |
| Identity drift (aliases on the wrong one, nickname vs name, plural places, epithets) | only the text's own ties join two names (rule 12); the reader's alias alone makes its own entry |
| Junk entities; no entry for the narrator | `nonEntity`; the narrator entry (rule 13) |
| Attribution by co-occurrence | `claimOwner` (rule 14); the verifier's choice among the ones named (rule 15) |
| Contradictions never meet; both values kept | kin by rule (16), open facts by slot (17), first said first kept, notes against prose to Needs You |
| One-off events as habits, past roles as present, said as true | rule 18; a moment ("By noon…", "already in the line") is the scene's |
| False slips (sex, deeds, quotes) | rule 19; an exception told as one is no slip |
| Unsupported profile sentences | rule 20 |
| Too few trait proposals | introductions read by code (`introFacts`: "a short, bald man with half-moon spectacles", "Brennock was a grey slate town"), each still through the gates and the reader; the dossier names each kind's checklist |

### Results, round 2 (Careful 4B, 4-core CPU)

`node scripts/canon-eval.js --fixture <dir>,<dir>… --model careful --keep <run>`, then `canon-score.js` per fixture with `--reviewed reviewed-careful.json` (dev: `reviewed-careful-r2.json`). Precision counts every kept fact: matched to the sheet, a trap, or judged by the builder (a fact not on the sheet is true only when it holds of that entity, lastingly, in the narration; one moment, another's, or only said is wrong). Before: the round-1 engine (`0b91b73`) on the same answers; dev's "before" is §11's.

| Set | Engine | Must facts | Precision (all kept, reviewed) | Slips | False slips | Which is right? | Junk entries | Profile sentences unsupported |
|---|---|---|---|---|---|---|---|---|
| dev2 (5 stories, 2,480 words) | round 1 | 81/129 (63%) | 145/149 judged, 54 unreviewed | 4/11 | 0 | 0/2 | 3 | — |
| dev2 | **round 2, Careful** | **91/129 (71%)** | **137/137 (100%)** | **11/11** | **0** | **2/2** | **0** | **0/23** |
| dev2 | round 2, Thorough 8B (CPU) | 66/129 (51%) | 108/109 (99%) | 10/11 | **0** | **2/2** | 0 | 1/54 |
| dev (1,670 words) | round 1 (§11) | 29/41 (71%) | 64/65 (98%) | 3/3 | 0 | — | — | — |
| dev | **round 2, Careful** | 25/41 (61%) | **42/42 (100%)** | 2/3 (+1 worth a look: the crust, which the reader won't call one event) | **0** | — | 0 | 0/7 |

Model time (Careful): dev 1,870 s, dev2 5,182 s (2,480 words); Thorough on dev2 10,777 s. Thorough's precision now meets the bar (99%, was 86% on dev in round 1): the whose and wrong-about questions take away the yes it gave too readily; its recall is lower than Careful's on this run (51% must), not yet looked into. about the round-1 engine's per word: the second questions (whose, wrong-about) cost ~3 s each, and code reads the introductions.

What the numbers are not: dev2 was written for the failure types and the rules were tuned on it, so it is a second dev set, not a held-out estimate. The held-out brief's 37% must and ~55–72% precision were on prose the builder had never read; the final gate is a new unseen batch. Recall on dev fell a little (Hesper's Spared, her friend Coll and the Weighhouse's routines still need the reader; a habit "she kept her hands still" is no longer a habit), and that was the trade the owner asked for: precision first.

## 13. Round 3: the code around the reader, measured with readers made from the answers

The in-app QA (fake reader, its own chapter, real input events) found that the losses were the code's, not the model's: a fully described place got no facts (its paragraph was given to the town it names in passing), a lead lost her scar and a boy his whole introduction (a possessive with no subject pronoun; an introduction after a line of his speech), and of ~54 facts a perfect reader proposed about 35% survived, while "Height: long" ("quiet for a long while") and a mare's age on her rider were kept as checked. Round 3 measures that code directly, with two readers built from the answer sheets (`scripts/canon-perfect.js`):

- **perfect**: proposes every sheet fact whose quote reached the entity's pack, citing the sentences that hold it, in the sheet's words (or an alternative, when the quote doesn't hold them), and answers every question as the sheet would. A correct fact it proposes and the code drops is a fault in a gate.
- **adversarial**: also files, under each entity, the facts of the others whose quotes sit in its pack, and believes them (yes, its own name to *whose*, no to *is it wrong*). Whatever of these survives is a fault in the code.

QA's chapter is a fixture now (`scripts/fixtures/canon-editor/qa`, with QA's own reader answers for it and for the Tutorial's story). Fixed, each with its test (`scripts/canon-round3.test.js`, and the e2e):

| What QA found | What decides now |
|---|---|
| A sentence belonged to one entity, the first named | It belongs to everyone it is about: by name, alias or the noun its own description gives ("a round tower of black stone" → *the tower*), by a pronoun the chapter's reading resolves (`resolveRefs`), by the paragraph a place opens as its subject; a little context (the definition just before) |
| Pronouns followed only a sentence-opening he or she | A subject pronoun goes on with the last sentence's subject (not the name in its *than*: Juniper, not Wren); an owning *her* with its clause's subject; an object never its own clause's subject ("said Tobias, coming down to meet her"); "Her name was Ines Garrow" is Ines; *it* and *its* mean a place that was a subject; a body part the subject's own verb handles is the subject's ("He rubbed her eyes": the boy's, so *her* is a slip) |
| Whose a claim is, by the nearest name | A name before a noun of its own is a modifier (the Dunmere breakwater; the Salt Cod inn is the Salt Cod's); a noun phrase's owner is the name it leads to (his old Rover; His wife, Constance); a relation's other end is not its owner (her apprentice); a fronted clause's subject comes after the claim; a definite apposition is the name just before it unless its noun is this one's own; a part of a place is the place's; a pronoun that cannot be this one (it, they, the other sex, one the reading gives others) never is |
| Moments kept as traits, lasting things dropped as moments | A while is no height and no personality; a place stands, runs and smells; what one keeps, wears or carries, what has gone on since, what is done every morning, a mark a deed left, a way they are told as a thing they have: lasting |
| Said kept as true | A tag after a quotation reports nothing past it; "would never have said out loud" and "Nobody said" report nothing; what is said is quoted inside its marks |
| Traits from the reading | The trait word owned by its name, or by a pronoun the reading is sure of, ties it (`canon.json` `ties`); the narration's he and she as resolved give a sex (`pron`); an Eyes or Hair fact never cites a passage whose words give another colour |
| Which is right? | Resolves open facts too (the values asked against step aside, recoverable); one birthplace (Saltmarsh in the notes against Coldharbour in the prose waits; a later one in the prose is the pass's); a notebook colour against "a tall woman with … grey eyes": the notes stand, the prose is a slip; one question per label, counted as the pane lists them |
| Identity | "the Guild" joins "the Guild of Wick-Trimmers"; a surname the shelf gives two people is no one's alias (Ivo had become female through "Tamsin Marchetti, Ivo's elder sister"); Dr and Mrs Haddon are never one by a shared alias |
| The pass | The chapter's reading tells it whose "her brown eyes" are among two named; an open-fact slip in narration isn't passed over for talk later in its sentence; an antonym says otherwise only of the same thing; the one at someone's heels is not the heels' owner |
| The Canon page | Read the Shelf in the reader's line on every Canon page; Keep a Canon from the offer pins both panes; Try Again starts the reader before saying anything; the failure said once; a press during a read waits for it |

### Results, round 3 (no model: the sheet readers; `node scripts/canon-perfect.js`)

On dev, dev2's five stories and QA's chapter (379 sheet facts, 205 must); before: the round-2 engine (`cda47d9`) with the same readers.

| | Round 2 | Round 3 |
|---|---|---|
| Pack coverage, must quotes in the right entity's pack | 176/205 (86%) | **203/205 (99%)** |
| Pack coverage, every quote | 321/379 (85%) | 358/379 (94%) |
| Perfect reader: of what it proposes (in the quote's words, not on a slip's sentence), kept | 218/299 (73%) | **317/333 (95%)** |
| Perfect reader: every sheet fact, kept | 224/361 (62%) | 326/361 (90%) |
| Wrong facts kept with a perfect reader | 2 | **0** |
| Adversary's misattributions kept | 48/242 (20%) | **7/252 (3%)** |
| Slips found (must) / false | 11/17 / 1 | **16/17 / 0** |
| QA's chapter: Lantern House facts; Tobias's | 0; 0 | 10; 6 |

What is still lost with a perfect reader is mostly round 2's deliberate precision: a habit with no word that it recurs ("She kept her hands still"), a moment ("That night… she lay…"), a setting's routine told as a person's deed, a fact read between the lines (the town afraid of her). What these numbers are not: the readers are the sheets, so they measure the code, not a model; a real reader proposes less and worse, and the held-out estimate is still the evaluation lead's.

## 14. Round 4: the real reader's failures, reproduced and met

The evaluation lead ran Careful (4B) on four more unseen stories (brief only: types, no text): strict precision 73%, must recall 58%, slips 1/11 (0 false), Which is right? 0/2, about one profile sentence in seven wrong in meaning. The sheet readers of round 3 had scored 95% and 3% on dev: they failed only in ways the code already met. Round 4 builds readers that fail the way the real one did, writes stories for the types, and holds the engine to them.

**dev3** (`scripts/fixtures/canon-editor/dev3/`, three stories written for the brief): *Kerr's Mill* (three generations of Absalom Kerr told apart by the Elder, the Younger and the Third; a terrier whose sex is her own she and a cat beside a man's he; a deed given to the next generation in a relative clause; one generation's eyes and the mill's bank said otherwise); *Night Ward* (Nurse Maud Rafferty, "Raff" a line later with no "called"; a group chat of `Name: message` lines with a lie in it; a ward's floor and wing, a shift's start and a room's number turned round, said otherwise); *The Form Room* (a notebook against the prose on the subject taught and the school year; a letter read out with no quotation marks; an assembly's hour said otherwise; a cedar's planting given to someone else; a neighbour that may hold beside the first).

**The drift reader** (`scripts/canon-perfect.js`, mode `drift`): the perfect reader, plus every failure type of the brief — labels drift ("situated", "address", "shift start", "teaches"); each slip's later value proposed as a fact of its own under another label; feelings, postures and one scene's states proposed as lasting; an animal given the nearest he or she; what is said never marked said; a nickname proposed as its own one, generations as one person, an animal as a person, a turned room number as a place; profile sentences that cite real facts and say more; and *no* to every slip question. It believes everything it made up. `credulous` is the same with *yes* to every slip question, to price a reader that says yes.

| Failure type (brief) | What decides now (ACCURACY.md) |
|---|---|
| Later value kept as a second fact under another label; slips almost silent | slots by a value's own shape (rule 21); deeds done once by rule (22); an age, colour, material or count said otherwise flagged with no question asked (27) |
| One-off moments kept as traits | standing evidence in the clause, and the reader both ways (23) |
| A pet's sex from another's he; facts on the wrong one | an animal is it or its name (24); a place's claim in a person's clause is theirs; a value's colour, number, kin word must be its sentences' (27) |
| A lie in a group chat kept as checked | chat lines, letters, radio calls are speech (25) |
| Nickname split; generations merged; turned room number made an entry; animal as person | rule 26 |
| Profile sentences drifting from their facts | `profileEntailed` and the reader both ways (28) |
| Notes against prose never asked | one slot across the notes and the prose; never merged by shared words (21) |
| A fact only the model's word supports shown as checked | Canon's reading, no dot, never a slip's ground (29) |

### Results, round 4 (no model: the sheet readers; `node scripts/canon-perfect.js`)

Before: the round-3 engine (`471dcaa`) with the same readers and fixtures. Must: shown (checked, the writer's, or Canon's reading); precision counts what is shown, on the sheet, against the sheet's traps, said-as-true and everything the reader made up that the entries keep.

| Set · reader | Must (r3 → r4) | Precision (r3 → r4) | Made-up kept | Slips found / false (r3 → r4) | Which is right? | Profile sentences wrong in meaning |
|---|---|---|---|---|---|---|
| dev3 · drift | 50 → 48/52 | 77% → **100%** | 17/38 → **0/38** | 1/8 → **8/8**, 0 → 0 | 0/2 → **2/2** | 18/54 → **0/24** |
| dev2 · drift | 121 → 123/129 | 98% → 100% | 4/65 → 0/64 | 7/11 → 10/11, 0 → 0 | 2/2 → 2/2 | 29/88 → 0/29 |
| dev · drift | 36/41 | 96% → 97% | 2/25 → 1/25 | 1/3 → 1/3, 0 → 0 | — | 7/28 → 0/9 |
| QA · drift | 35/35 | 86% → 100% | 5/17 → 0/17 | 2/3 → 3/3, 0 → 0 | — | 5/17 → 0/6 |
| all · perfect | 244 → 242/257 | 100% → 100% | — | 19/25 → **24/25**, 0 → 0 | 2/4 → **4/4** | — |
| all · adversarial | 244 → 242/257 | 97% → 97% | 10/285 → 10/284 | 19/25 → 24/25, 0 → 0 | 2/4 → 4/4 | — |
| all · credulous | 242/257 | — | — | 19/25 → 24/25, **9 → 5** | — | — |

The two must facts dev3 "loses" are Hester's subject and year, which now wait as *Which is right?*, as the sheet asks. Of the 242 must facts shown, 238 carry the dot; the four of dev that don't are Canon's reading: the Weighhouse's routines (the bell six times at dawn, lining up by height, lessons after the weighing), which name nothing of it and are its only because the reader named it the setting, and Hesper's "one of the Spared", read from the sentence defining the Spared. The slips still missed with the drift reader are the three only a reader's yes can make (a never, a polarity, a crust given by a verb of giving, which is no deed done once). With a credulous reader five false slips remain, all on candidates that wait for the reader's yes by design (a deed shared by words, a polarity, an antonym): a reader that says yes to anything is not one the real Careful reader was (0 false in every held-out run).

What these numbers are not: dev3 was written by the builder for the brief's types and the rules were tuned on it, so it is a third dev set; the drift reader is the brief's failures as the builder understood them, not the model. The real reader's word on unseen prose is the evaluation lead's to measure (the prompts gained the "only this moment?" and the profile questions, `EDITOR_PROMPT` is unchanged, so the verdict cache holds round 3's answers and only the new questions are asked).

## 15. Round 5: the slips, from the kept facts

The evaluation lead ran Careful (4B) on four more unseen stories (brief only: types, no text): verified precision 89% (round 3: 73%), must recall 50%, slips **2/11** (0 false), Worth a look 3 true and 2 false. Slips are the product's promise, and the misses were of one kind: the later sentence said otherwise of a fact Canon already kept, but tied it to its one by something other than the plain name. A pet called by another name and the "little <other breed>"; a shift's start hour against a range kept as "2200 to 0600"; a rank one step down (and no rank fact at all); a father's deed given to his son by the son's epithet; eyes by an epithet or a pronoun; hair under a nickname; a room number turned round, which the reader made a place with the slip as its fact while the true room had no entry; and the writer's notes against the prose, marked on the notes instead of asked.

**dev4** (`scripts/fixtures/canon-editor/dev4/`, three stories written for exactly these slip types, with sheets): *Carrick Head* (a first-person signals officer named only by a radio call and a vocative; a watch "from 2200 to 0600"; Hut 12; a commander's Labrador bitch; Ch 2: the watch at 2300, "The commander's brown eyes", "Lieutenant Commander Okafor", "The commander's Labrador, Bess", "Hut 21 … the stove in there"; decoys: a promotion told as one, two people's ages, years served and years left, a route, a breakfast); *The Lugger* (a landlady's wire-haired fox terrier; a lodger whose notebook eyes the prose says otherwise; a possessive list, an object's colour, a number with no noun; Ch 2: "Tom … his dark hair", "Mrs Hollis's little Jack Russell"); *Tolland's* (Josiah Tolland Senior and Junior, "the old man", "the boy", "called the boy Young Joss"; a police sergeant; Bay 9; a foundry cat; Ch 2: "the bell that Young Joss had cast", "The old man's blue eyes", "Constable Pryce"; decoys: the son's own blue eyes, a round moved and told as moved).

**The drift5 reader** (`scripts/canon-perfect.js`, mode `drift5`): the drift reader, plus the brief's types — it casts each one only by the name written (never an epithet, a short name or a generation, a nickname cast as someone of its own), the narrator as no one and the name a radio call gives as its own empty one, a renamed pet as another pet, a numbered room as no one and its number turned round as a place with the slip's sentence for a fact; it never proposes a rank, a species or a breed, and gives a watch as the bare range.

| Failure type (brief) | What decides now (ACCURACY.md) |
|---|---|
| a. pet renamed; breed changed ("the little <breed>") | an animal's name and breed are slots, by its owner and kind, two cues (32); no entry for the new name |
| b. a routine's start hour against a kept range | the 24-hour clock and ranges (33); the narrator's own I and me hold them to their hours (35) |
| c. rank one step down; no rank fact | ranks on ladders, a fact from the narration (31) |
| d. a deed given to the son | generation forms and the name the text gives the boy (30); "cast", "launched", "raised" are deeds done once |
| e, f. eyes by epithet or pronoun, hair by nickname | the forms that refer, strong and weak (30); "ginger", "dark", "iron-grey" are colours, "dark" against what it can't be |
| g. room number turned round; the true room no entry | numbered places from their first mention (34) |
| h. notes against prose marked on the notes | the notes are never marked (36) |
| false Worth a look across people | the words said otherwise must be this one's; years counted are how long (36) |
| wrong dotted facts | a creature's apposition is its own; an object's colour, a number with no noun, a deed's own verb (37) |
| recall: animals, ranks, the narrator, numbered places | species from a breed, ranks by code, the narrator from vocatives, numbered places (31–35, 37) |

### Results, round 5 (no model: the sheet readers; `node scripts/canon-perfect.js`)

Before: the round-4 engine (`5f3208c`) with the same readers and fixtures (dev4 included). Slips found / of (must) · false · Worth a look true/false.

| Set | perfect r4 → r5 | drift r4 → r5 | credulous r4 → r5 | drift5 r4 → r5 |
|---|---|---|---|---|
| dev | 2/3 → 2/3 · 0 | 1/3 → 1/3 · 0 | 2/3 → 2/3 · 1 → 1 | 1/3 → 1/3 · 0 |
| dev2 | 11/11 → 11/11 · 0 | 10/11 → 10/11 · 0 | 11/11 · 3 → **2** | 10/11 → 10/11 · 0 |
| dev3 | 8/8 → 8/8 · 0 | 8/8 → 8/8 · 0 | 8/8 · 0 | 7/8 → **8/8** · 0 |
| qa | 3/3 → 3/3 · 0 | 3/3 → 3/3 · 0 | 3/3 · 1 → 1 | 3/3 → 3/3 · 0 |
| **dev4** | **0/10 → 10/10** · 0 · look 1/0 → 0/0 | **0/10 → 10/10** · 1 → **0** | 0/10 → 10/10 · 1 → **0** | **0/10 → 10/10** · 1 → **0** |

| Set · reader | Must (r4 → r5) | Precision (r4 → r5) | Which is right? |
|---|---|---|---|
| dev4 · drift5 | 41 → 57/60 | 70/75 → **92/92** | 1/1 |
| dev4 · drift | 44 → 57/60 | 74/81 → **92/92** | 1/1 |
| dev3 · drift5 | 46 → 48/52 | 76/76 → 80/80 | 2/2 |
| dev2 · drift | 123 → 123/129 | 203/203 → 204/204 | 2/2 |
| dev · drift | 36 → 36/41 | 69/71 → 69/71 | — |
| qa · drift | 35 → 35/35 | 51/51 → 51/51 | — |

Every set holds at round 4's numbers or above. The slips the drift readers still miss on dev are the three only a reader's yes can make (§14); with a credulous reader the five false slips left are all candidates that wait for the reader's yes by design. `npm test` holds the rules (`scripts/canon-round5.test.js`), the end-to-end run is unchanged.

What these numbers are not: dev4 was written by the builder for the brief's types, and drift5 is the brief as the builder read it; the real reader's word on unseen prose is the evaluation lead's to measure. No prompt changed (`EDITOR_PROMPT` is the same), so the verdict cache holds round 4's answers; everything new here is code's, and needs no model call (the kind-noun ties ask the reader's `refers` once each, as before).
