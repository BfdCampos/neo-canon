# Canon accuracy

The owner's rule: *accuracy comes before speed.* A wrong fact marked checked is worse than a right fact left for the writer, and a wrong slip is worse than a missed one. This page records how Canon keeps to that rule and what it measures. It follows on from QA-FINAL F1, where the quick reader produced 9 wrong "checked" facts out of 15.

## The rules (canon.js, "the gates on checking")

1. **A fact is checked only by the text or by a double answer.** There are two ways for a fact to be checked:
   - deterministic evidence in the text, read by the same rules the slip checker uses;
   - the reader answers *yes* to a plain statement and *no* to its negation (`localReader.judge`).

   Any other answer, *unsure* included, leaves the fact unchecked. Unchecked facts never raise slips.
2. **Traits (sex, species, eyes, hair) are checked only by the text.** `shelfEvidence` scans the whole shelf for passages that tie a word to an entry: "Bramble, the grey mare", "Captain Varr's eyes were the grey of wet slate", or a note such as "Ilsa: grey eyes". It skips pronouns, speech, questions, maybes and lines the writer has dismissed. `established` then decides:
   - If there is one value, that value stands.
   - If one value appears in two or more chapters, first, and every other value appears once, the first value stands.
   - Otherwise the shelf disagrees with itself. Every value then waits in Needs You as "Your sources disagree": nothing is checked and no slip is raised. A slip sentence that comes *before* the canonical one therefore can never win.
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
