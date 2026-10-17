# Canon accuracy

The owner's rule: *accuracy comes before speed.* A wrong fact marked checked is worse than a right fact left for the writer, and a wrong slip is worse than a missed one. This page records how Canon keeps to that rule and what it measures. It follows on from QA-FINAL F1, where the quick reader produced 9 wrong "checked" facts out of 15.

## The rules (canon.js, "the gates on checking")

1. **A fact is checked only by the text or by a double answer.** There are two ways for a fact to be checked:
   - deterministic evidence in the text, read by the same rules the slip checker uses;
   - the reader answers *yes* to a plain statement and *no* to its negation (`localReader.judge`).

   Any other answer, *unsure* included, leaves the fact unchecked. Unchecked facts never raise slips.
2. **Traits (sex, species, eyes, hair) are checked only by the text.** `shelfEvidence` scans the whole shelf for passages that tie a word to an entry: "Bramble, the grey mare", "Captain Varr's eyes were the grey of wet slate", "John has green eyes", or a note such as "Ilsa: grey eyes". It skips pronouns, speech, questions, maybes and lines the writer has dismissed. A reading whose own quote ties the word to the entry the same way counts too. `established` and `firstCome` then decide, by rule 10.
   - One narrow exception for sex (`pronounEvidence`, `pronounSex`): where nothing else on the shelf gives a person or creature a sex, the narration's own she/her (or he/him) does, when the slip checker's rules tie it to them (the entry, then "her bed" in its clause; or a sentence naming no one, by rule 9) in two sentences or more and the other pronoun in none. Never from speech or reported speech. The fact cites those sentences and is placed by rule 10 like any other. A noun anywhere on the shelf for the other sex ("Clover, the red cow" against "Clover lowered his head"), a value the writer kept or set aside, or a checked reading of the other value: the pronouns establish nothing.
   - Speech is what is inside quotation marks, read by which side each mark faces (`speechSpans`): straight quotes, curly mixed with straight, and a curly mark typed the wrong way round all pair up. A mark left open runs to the paragraph's end only when the paragraph opens with it; anywhere else it makes nothing speech. A quoted term of three words or fewer inside a sentence, with no saying verb by it (born into "Fleets."), is a word, not speech. A source an older reading marked `said` whose passage now reads as narration loses the mark on the next read.
3. **Relations (owner, kin, spouse, home, birthplace) need both names and a relation word in the quote's sentence** (`relation`).
   - `'rule'`: the words also say which way round, and the fact is checked. Examples: "Tamsin Hale, Oren's younger sister"; "Teodor Brisk, Ansel's father"; "Hector, Teodor's black bull"; "belonged to Mara"; "lived in"; "born in".
   - `'linked'`: only the careful reader may be asked about the fact.
   - Otherwise the fact stays unchecked.

   No entry is its own owner or kin.
4. **A misspelt name is never a value or an entry** (`misspelt`). Examples: Corwyck for Corwick, Kelsharrow for Kellsharrow.
5. **Names.** One person has one entry. The reader's "Varr" or "Ilsa" becomes the shelf's "Ilsa Varr" when only one full name contains it. A surname that two people share ("Hale") makes no entry. Pronouns ("She"), words the shelf also writes in lower case ("Ponies"), descriptions ("Keeper of Kellsharrow light") and misspellings never become entries. A place named twice or more as someone's home or birthplace gets an entry, so that its misspelling can be caught. A one-off spelling never gets one.
6. **Speech and plans stay their own facts.** Examples are the trader's "that's a gelding" and "in foal?". They never join a fact from the story or become its source. This applies to a read, to *That's right*, to a change across the series and to Merge Into.
7. **States are recomputed on every read.** Each fact that isn't the writer's is worked out afresh from its sources, the evidence and the cached answers. A Canon that was read under the old, looser gates is corrected by its next read.
8. **The quick reader is asked less.** It is never asked about relations, and never asked who "he" or "she" means. In both cases it answered with whichever name it was offered.

9. **Whose "his blue eyes"? By the paragraph, and asked when in doubt** (`referent`). In a sentence that names no one, "his/her/their <colour> eyes|hair" belongs to the one person (or creature) the paragraph named before it. Nothing else may come between: no other entry, no capitalised name (a sentence's first word must be one the dictionary knows), no "the stranger", "a soldier", "his brother" or "the mare", and no pronoun of the other sex.
   - Strong only when the entry's sex agrees with the pronoun, within three sentences, with no speech between.
   - Otherwise weak. A weak candidate goes to the reader, asked about the pronoun ("his"), not the colour. *Yes* makes it a slip; another name or *someone else* drops it.
   - *Cannot tell*, the quick reader (never asked about pronouns), or no reader at all: it is **Worth a look**. It is listed apart, under a fainter mark, and the popover asks "Is “his” John? Canon has John’s eyes as green." The writer's *Yes, but leave it* or *No, someone else* is kept in `not-slips.json` (with `coref`) against the sentence. A Worth a look is never a slip and never counted as one.
   - A lone "She" after "John came in." is asked of the reader only, never of the writer: it is nearly always someone else.

   This came from the owner's own paragraph, where "his blue eyes" was three sentences after "John" and no rule offered it at all. Asked, Careful answered *John*.

   Re-scored from the memo files with rule 9, both readers on both fixtures read exactly as in the table below: 100% precision, the same slips found, 0 false slips and 0 Worth a look. With no reader, each fixture's two weak slips are its Worth a look items, and no decoy is.

10. **First said, first kept** (`firstCome`; the owner: "It was THE FIRST thing I wrote about him… assume that's true… only catch my attention on conflicts"). Rules 1–9 are the gates. What gets through them is checked **without asking**:
   - Of the values for one attribute, the first said in reading order stands. The writer's Notes and notebook pages come first, as the writer's own word; then the books in shelf order, chapter by chapter, paragraph by paragraph.
   - A later value that differs is not a fact and not a question: it is the slip the pass finds on that passage.
   - The writer's notes against the prose's first value (or two notes against each other) is the one thing asked: every value waits as *Which is right?* in Needs You, and no slip is raised until the writer picks.
   - A proposal that fails a gate is left out quietly; the device's cache keeps it with the reason (`dropped`). It never becomes a Needs You question.
   - Attributes that change (owner, home, title, state) and kin keep every value that got through.

   A slip *before* the canonical sentence could now win, so pronouns still never establish a trait against a word for it (rule 2): the Lantern Coast's "Clover lowered his head", which comes before "Clover, the red cow", establishes nothing, and Clover stays a cow. Only where no word gives a sex at all do two or more agreeing pronouns, and none against, give one.

11. **Story so far** (STORY.md). The reader's key points pass their own gates (`gateEvent`): the quote verbatim, ≤ 30 words, outside speech, reported speech and plans; each who named in the quote or meant by its first pronoun by rule 9 (strong only); no capitalised word the paragraph doesn't hold, and every other content word of the line sharing a stem with the quote's sentence. A later sentence that gives an earlier key point's deed to someone else is a slip only on the careful reader's *yes* to "Does B say that someone other than John did what A says John did?"; *unclear*, or the Quick reader (never asked), is Worth a look; no reader, nothing. A sentence that names the doer too ("Dave remembered John…") is a slip only on *yes*, never Worth a look.

Two deterministic readings are added as well:
- Kin that the shelf states outright between two entries ("Oren's younger sister") is added by `kinEvidence`. It then goes through rule 3 like any other reading.
- Places that the shelf names three or more times after a place preposition are added by `shelfPlaces`. They become entries, so that their misspellings are caught even when the reader never named the place.

## How it is measured

`node scripts/canon-eval.js [--fixture canon|canon-heldout|all] [--model quick|careful]` runs the real reader through `canon-worker.js` with a dead proxy. It runs Read the Shelf and then the Continuity Pass over the whole shelf, and scores the result against each fixture's `expected.json`. It reports:
- checked-fact precision (must be 100%);
- checked-fact recall;
- slips found and missed;
- false slips;
- the model's time.

Answers are memoised by prompt in a file, so a change to a gate re-scores in seconds. Pass `--fresh` to ask everything again. The eval is not part of `npm test`.

There are two fixtures:
- `scripts/fixtures/canon`: the Ashfall Road, about 2,000 words.
- `scripts/fixtures/canon-heldout`: the Lantern Coast, about 1,450 words. It has different names and animals (cows and a bull), and it holds the traps listed below.

The Lantern Coast was written to catch overfitting. Its traps:
- a slip before the canonical sentence;
- a dialogue lie about an owner and one about sex;
- a speech line about eye colour;
- a misspelt town;
- "Mara's elder brother", where the kin word belongs to the brother;
- "the younger of the two Brisk men";
- "Clever" one letter from "Clover";
- a "He" that means an unnamed man.

`scripts/canon-gates.test.js` (in `npm test`) runs every gate with a fake reader that proposes the six wrong facts from QA F1 and answers yes to everything.

## Results (4-core CPU VM, no GPU, 4 threads)

Times are the model's own time, summed over every call. They were measured with 4 threads; the app uses cores − 2, so 2 threads on this VM. Careful's first load from a cold disk took 192 s. Fact recall counts the facts that `expected.json` marks as checked. Before the change, the Ashfall Road expected 15 checked facts. Two of those now rightly wait for the writer: Oren's sex, which rests only on "He", and Bramble's owner, which rests on "Tamsin rode her" with no owner word. Both readers' answers are kept in memo files, so these runs can be re-scored.

| Engine | Reader | Shelf | Checked | Wrong | Precision | Fact recall | Slips found | False slips | Model time |
|---|---|---|---|---|---|---|---|---|---|
| before (f59ccbd) | Quick | Ashfall Road | 15 | 9 | 40% | 6/15 | 3/5 | 2 | 332 s |
| before (f59ccbd) | Quick | Lantern Coast | 17 | 6 | 65% | 11/17 | 3/5 | 1 | 244 s |
| after | Quick | Ashfall Road | 8 | 0 | **100%** | 8/13 | 5/5 | **0** | 285 s |
| after | Quick | Lantern Coast | 12 | 0 | **100%** | 12/17 | 4/5 | **0** | 204 s |
| after | Careful | Ashfall Road | 8 | 0 | **100%** | 8/13 | 5/5 | **0** | 493 s |
| after | Careful | Lantern Coast | 14 | 0 | **100%** | 14/17 | 4/5 | **0** | 370 s |

Notes on the runs:
- **Missed by both readers:** "She slid the halter off the **bull**". Both answered "someone or something else" when asked whom "bull" meant. That is a safe miss.
- **Quick and pronouns:** before rule 8, Quick confirmed "He spat into the shallows" as Bramble and "He was young…" as Mara, even though Mara is a woman. Careful answered "someone or something else" both times.
- **Run-to-run variation:** across our cold Quick runs, slip recall on the Ashfall Road varied (4/5 to 5/5), depending on which entries the reader named. Precision and false slips did not vary.

## First said, first kept, and Story so far (Careful, re-scored from the memo; new answers asked)

Re-scored with rules 10 and 11, the Careful reader on both fixtures. The Ashfall Road now holds the actor swap ("He still wore the belt that Ilsa had bound round the stump at the ford", after Tamsin bound it) and three decoys: the same belt cut into a strap, a memory naming Tamsin, a lie in dialogue.

| Reader | Shelf | Checked | Wrong | Fact recall | Slips found | False slips | Needs You | Key points kept | Model time |
|---|---|---|---|---|---|---|---|---|---|
| Careful | Ashfall Road | 8 | 0 | 8/13 | **6/6** (the swap too) | **0** | 3 (2 said, 1 plan) | 14 | 1180 s |
| Careful | Lantern Coast | 14 | 0 | 14/17 | 4/5 | **0** | 2 (both said) | 10 | 926 s |

Re-scored from the same memo with the narration's pronouns (rule 2's exception) and the new reading of quotation marks: Ashfall Road 8 checked, 0 wrong, 8/14 (Oren Hale's sex, male by his own he, is now expected; Careful's readings didn't reach it), 6/6 slips, 0 false; Lantern Coast 15 checked, 0 wrong, 15/17 (Ansel Brisk is male: "He stayed for supper."), 4/5 slips, 0 false.

Before rules 10 and 11 the same answers left 7 and 8 questions in Needs You, most of them a later value against the first ("Ilsa Varr · Eyes: brown"). Every key-point quote was verbatim. Read time roughly doubled: each story paragraph is asked once more, for its key points.

The first run of the deed question, asked once and with B's whole paragraph, gave 3 and 4 false slips ("Teodor Brisk … kept the farm" against "Mara kept the light"): Careful said yes when two passages shared a word. With two distinctive words (or one found nowhere else), B's sentence alone, and the question asked both ways round, there are none.

**The owner's text, with the real Careful reader** (Notes: "John has green eyes and likes to read old books."; Ch 1 the owner's paragraph; Ch 2 four sentences):
- Needs You: empty. Eyes: green, checked from the Notes without asking; the reader's "blue" (from "his blue eyes") got through no gate and was left out.
- Story so far: *John reached his hand through the swirling red vortex* (Ch 1); for Dave, *Dave found the room in ruins*, *Dave touched the red vortex*, *Dave kicked the vortex shut*. Its *John reached into the vortex*, read from "Dave remembered John reaching into the vortex", was left out as a memory.
- Slips: "his **blue** eyes" (Careful: "his" is John) and "It was **Dave** who touched the red vortex that night" (Dave → John). Not flagged: "Dave kicked the vortex shut" (never asked), "Dave remembered John reaching into the vortex" (asked: no), "It was Dave who had reached into the vortex, he told himself, not John" (what he tells himself), "Dave came in … and found the room in ruins".

## The recommendation

The recommendation stays as it was:
- **Careful** for 15 GB of memory or more.
- **Quick** for about 8 GB.

Both are now safe: in every run there were no wrong checked facts and no wrong slips.

Careful finds more:
- 14 checked facts against 12 on the held-out shelf;
- the kin and home facts the reader proposes;
- the right answer on "who is *he*".

It takes about 1.7 times as long here. With the quick reader, Canon finds fewer facts but not worse ones. The fact precision we measured does not depend on which reader is installed. A bigger model buys recall, never trust.

## The editor's reading (READING.md), dev set

The rebuilt reading keeps every rule above for traits, relations, speech and first said, first kept, and adds gates of its own for open facts (canon-editor.js): the quote is the cited sentence's clause, copied by code (no misquote is possible); half the value's words (every name and number) in it; polarity read beside the value's words; speech and reported speech make it *said* (never kept as true, never asked in Needs You); a habit must be said to recur; a place's, group's or thing's fact may not name another of the cast, and a sentence found by its paragraph that is about a person is that person's; then the reader's *yes*, asked again whether it is stated (for what is read between the lines), whether it is really someone else's (for a pronoun's or a paragraph's sentence) and whether it lasts. A trait read from a pronoun's sentence ("Her hair was … fair as wet straw") counts only where nothing else gives the attribute a value, and only when the pronoun is the entry's by the paragraph's rules or by the reader's answer (kept in `canon.json` `refs`).

Slips on open facts and on deeds ask each passage alone: a 4B reader shown A and B together answered from A ("Coll" to "the crust the warden had given her"; "no" to "high windows" against "not one window"); asked of each sentence by itself it answers each correctly, and the slip is two definite answers that differ. A deed of no one kind is also asked whether B tells the very same event (two people sitting on beds are two events: the Thorough run's one false slip, now gone).

| Reader | Set | Must facts | Precision (sheet / after review) | Slips | False slips |
|---|---|---|---|---|---|
| Careful | dev | 29/41 (71%) | 100% / 98% (64/65) | 3/3 | 0 |
| Thorough (CPU) | dev | 30/41 (73%) | 100% / 86% (60/70) | 3/3 | 0 |

The fixture shelves (Ashfall Road, Lantern Coast) keep the paragraph reading's answers through the fake reader in `npm test`; their numbers above were not re-measured with a real reader in this change. Careful's precision rests on the builder's review of 12 facts not on the sheet; Thorough's does not yet meet the bar (READING.md §11).
