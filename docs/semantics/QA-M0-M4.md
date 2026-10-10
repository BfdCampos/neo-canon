# QA report: Canon M0-M4 (branch semantics @ b66e64d)

Baseline: `npm test` 119/119 pass. `npm run lint` 29 errors, identical count to 94db95a (none new). `canon.e2e.js` 9/9 pass.
`node scripts/i18n.js template` gives no diff (880 strings). Probe scripts: qa/probe*.js; UI script: scripts/qa.e2e.js; shots: qa-shots/.

Test quality: unit tests are real (round-trip, quote gate, per-checker positive/negative cases), but (a) weak checkers are tested only with a
stub `refers: () => 'yes'`, so the reader's discrimination is untested; (b) none of the false positives below are covered;
(c) canon.e2e.js calls internals directly (`canonEdit`, `toggleContinuity()`, `.click()`) and runs the pass only WITH the fake reader,
so the no-reader path (spec 4.9) and the real UI flows (New Entry modal, Add a fact, hover) are not exercised.

## Findings

### Major

1. **Rule "verification" verifies wrong facts** (P0 pillar 3, Accuracy). canon.js:672-681 `ruleSupported` only needs the entity name plus any closed-lexicon
   word in the quote. Repro (probe4 #1): reader proposes Bramble/sex/male from the quote "Bramble stood beside the stallion" -> stored
   `Sex: male (stallion) · verified`, no judge call. A verified fact raises slips. Same for species/eyes/sibling ("Oren sold Rook to Tamsin" etc.).
   Expected: unverified or judged. Also canon.js:610-614 `valueInQuote` accepts any pronoun in the quote as support for sex (`Tamsin led her own horse, Bramble` -> Bramble female, probe4 #2).
2. **Name edit with a newline corrupts the entry file.** Paste "Bram\nble" into the h1 (app.js:16436-16441 `contentEditable='plaintext-only'`, only Enter is
   blocked). `serialiseEntry` writes `name: Bram\nble`, file becomes `unreadable` (canon.js:324-335). No newline sanitising in serialise/askInput/aliases.
3. **One bad line makes the whole entry unreadable, and Read the Shelf then creates a duplicate entry.** canon.js:279-322. Unparseable: trailing space after
   `· yours`, BOM (`﻿`), `*` bullets, tab-indented source, uppercase state, hand-added prose under Facts. Repro (probe4 #4/#5): file `entries/bramble.md` with BOM -> readShelf
   writes new `bramble-1.md` for the same character; original left untouched (good) but now two Brambles. UI only says "Canon couldn't read this entry. It's left as it was."
   (app.js:16268) with no line number/reason and the broken entry sorts under "Other" by file id (screenshot 06). PRODUCT 4.4 promises hand-editing in any editor; Windows editors add BOMs.
4. **Hand-fact vocabulary silently rejects ordinary values, with a misleading message.** `Eyes: violet`, `Eyes: silver`, `Sex: nonbinary`, `Gender: they/them`, `Born in` (no value) all
   give toast "Write it as a label and a value, like Eyes: grey" (app.js:16501, 16520; canon.js:237-255 COLOURS/SEX_WORDS closed lists). The format was right; the value isn't in
   the lexicon. A fantasy/nonbinary-friendly world bible cannot record these. Expected: accept as free `Other`/typed value (not slip-checked) or say why.
5. **Strong pronoun checker: false positives that name the wrong owner.** Entity not the subject:
   - `Bramble’s rider lost his hat.` -> flags "his" (probe2). Possessive `'s` after the name is not skipped (canon.js:437-446).
   - `Tamsin took his hand.` flagged (documented as known, ARCH §8 #11, but it is the commonest case).
   - Colour rule: `Ilsa saw the child’s brown eyes.` and `Ilsa saw brown eyes in the dark.` both flagged as Ilsa's eyes (canon.js:490-499, "the one entity the sentence names").
   - `Bramble, a stallion’s rival, bolted.` flags "stallion’s" (span includes ’s) and Keep would replace it with "mare", deleting the possessive (canon.js:450-456; app.js canonApply).
   - `Bramble, the man who sold bread` -> noun slip man->woman; `Bramble, the dog` -> species slip. Appositive after a creature's name is not always about it.
   PRODUCT: "A wrong flag is worse than a missed one".
6. **Undo of Keep leaves the slip unmarked and unlisted.** Keep->Apply, then real Ctrl+Z: text returns to "his" but mark count stays 3 and side list lacks it (canonDrop removed it, app.js:16661-16665, canonApply). The pass shows "No slip" for a sentence that is wrong again until re-run. Same for a manual fix: after typing over "brown" with "grey" the side list still lists the slip (stale; app.js canonPaint only runs on pass messages).

### Minor

7. **Two facts for a single-valued attribute are both saved as "yours" with no warning.** `Sex: mare` then `Sex: stallion` -> both in file; `worldOf` (canon.js:375) lets the last one win silently, so a pass then flags "her" and accepts "his". Expected: replace/ask, or mark disagree.
8. **New Entry allows a duplicate name** (app.js:16285-16295 dedupes only the id): "Bramble"(creature) + "Bramble"(person) -> bramble.md + bramble-2.md. `mentions` (canon.js:152) gives the text to the first; a pass then judges the second's pronouns by the first's sex (probe4 #6). Expected: warn.
9. **Set Aside Entry fails silently** when `set-aside/<id>.md` already exists (main.js:2271-2278 returns false; app.js:16312 just returns). Reachable through an external restore/sync.
10. **Case-sensitive names**: `bramble`/`BRAMBLE` (all caps for emphasis) never count as mentions (canon.js:157 `exact`), so no slip. NFD text vs NFC entry name (`Zoë` vs `Zoë`) never matches (no normalisation in `mentions`).
11. **Non-Latin names all slug to `entry`** (`李雷`, `王芳` -> `entry`, `entry-2`, ...; `Æthelflæd` -> `thelfl-d`). Ugly file names and cross-run id churn (canon.js:229). main.js:2230 handles folder only.
12. **Pronoun checker misses capitals and `Her/His` after the name** (`Bramble raised His head` is never flagged since a capitalised word ends the scan, canon.js:439); `brown-eyed`, `Her brown eyes` after the name; `Varr`->`Vurr` (4 letters, by design).
13. **Single straight quotes aren't speech** (`Oren said, 'Bramble tossed his head' and left.` flagged). Curly single quotes are handled.
14. **Quote gate matches inside words** (`gateQuote('mare','the grey mares')` returns "mare"; `the` inside `other`): canon.js:177. Min length 3 characters is the only guard; whole-word boundary missing.
15. **Keep a Canon does not open the current book on the Canon tab** (PRODUCT 4.1 step 2). keepCanon (app.js:16137-16146) only toasts; from the shelf nothing opens. Continuity-Pass opt-in path likewise leaves the Manuscript tab.
16. **Spec gap, no Stop/Needs-reader copy for Continuity Pass with no reader**: spec 4.5 #7 says the item "opens the Canon tab's setup page"; M3 deviates by design (ARCH §8 #4), so only note: the side text "Without Canon’s reader, only the plainest slips are checked." appears while all slips shown are "strong".
17. **Source of a Notes fact opens the Notes tab but does not light the quote** (app.js:16590, `switchTab('notes')` returns before highlight). Spec 4.4/M2: "click a source -> opens that chapter with the quote highlighted".
18. **Editing a sourced fact keeps its old quote** (app.js:16487): changing `Eyes: grey` to `Eyes: brown` keeps source "grey of wet slate" under a "yours" fact, so the entry cites a passage that contradicts it.
19. **`cn-ctl` hover controls are unreachable by touch/keyboard until focus** - they do appear on focus-within (OK) but `.cn-add` is `opacity:0` until `.cn-entry:hover`; screen readers still read them. Nit-level.
20. **Slip snippet formatting bug**: side list reads `Bramble tossed  his head and` (double space before the span; app.js `canonSnippet` splits trailing '' and shows only 2 words after vs 3 before). Also uses `indexOf(span)` so `Then this horse tossed his head` highlights "his" inside "this".
21. **No plural forms**: "Canon found 1 entries and 1 facts", "No slips found against 1 facts." (app.js:16348, 16746; en.json has no plural entries for them). Spec 5 copy has "against 214 facts".
22. **canon.e2e.js overwrites tracked files** (docs/semantics/screens/*.png) every run: `git status` becomes dirty after running tests (scripts/canon.e2e.js:46-49).
23. **Weak-slip candidates dropped with no reader means "Without reader only plainest..." but cross-sentence `He` etc. are invisible**; documented, noted only.

### Nit

24. Hard-coded greys (`#666`, `#6f6a60`, `#d6d0c2`) in styles.css:2112, 2139, 2150 instead of tokens; `.cn-add-input` border is light on the dark theme.
25. "Sex:" label and its value render with almost no gap ("Sex:female (mare)") in the entry page (screenshot 04/20), `.cn-fl`/`.cn-fv` spacing.
26. A toast ("Continuity Pass off") lingers over the next screen when toggling quickly; toasts also persisted across tab changes ("This shelf keeps a Canon..." still showing 4 s later over Add-a-fact).
27. `Eyes: grey (storm grey)` silently drops the free description "storm grey" (`as` is only kept when different from the colour word; canon.js:247).
28. Alias containing a comma (`Hale, Jr.`) round-trips as two aliases (canon.js:290; app.js:16461 splits on commas).
29. Unreadable-entry nav row shows the file id, not the name; and `canon:saveEntry` / `canonMove` rely on filename id while parseEntry trusts frontmatter `id` (rename on disk makes them diverge; `id: ../../x` in frontmatter is only stopped later by libName).

## Verified OK (checked, no defect)
- No Canon tab on shelves without a Canon; tab order skips it. Edit menu gains only "Continuity Pass" (+ M8 item not yet there).
- Keep a Canon creates `canon-<slug>-<shelfId>/{canon.json,entries,set-aside,not-slips.json}`; no file > 1 MB.
- New Entry / Add a fact / Edit / Set Aside (fact + entry) / Restore persist to `.md`; external edit picked up by `canonRefreshNow`; write conflict is re-applied on top (alias kept + outside words kept).
- Pass with no reader finds the 3 strong slips (plus the Ch 3 "almost brown" one when no not-slips.json exists, which is the pre-dismissed decoy); with fake reader 5.
- Chapter files byte-identical after a pass+flush; after Apply+flush only the one word differs. Typing in a marked paragraph produced no popover/toast.
- Keep->Apply is a single execCommand edit; Ctrl+Z restores the text. Not a slip written to not-slips.json and still dismissed after restart (phase 2).
- Edited sentence brings a dismissed slip back; cosmetic whitespace/quote changes do not (probe4 #10). One dismissal hides the same sentence in every chapter (by design, hash only).
- 400 paragraphs x 300 entities pass: ~0.2 s.
- Hover popover could not be triggered with synthetic `sendInputEvent` in my script (it is in canon.e2e.js, so likely my coordinates); popover via `canonPopOpen` renders correctly in light and dark.

## Status (after M8, fixed before M9)

| # | Status | What was done |
|---|---|---|
| 1 | Fixed | Checking by rule (and a pronoun letting a reading in) now runs the slip checker itself on the quote against the opposite of the fact (`tiedTo` in canon.js): the word must be tied to that entry the way a strong slip would be. "Bramble stood beside the stallion" stays unverified; "Tamsin led her own horse, Bramble" gives Bramble nothing; a pronoun alone never checks a fact; kin is never checked by rule (the judge, or the writer). Tests: canon.test.js "checking by rule…". |
| 2 | Fixed | `serialiseEntry` writes every field on one line (`one()`); the name field folds whitespace; `handFact` too. |
| 3 | Fixed | Parser reads BOM, CRLF, trailing spaces, `*` bullets, tab-indented sources, any-case states and headings; an unknown line under Facts/Set aside is kept in place (`f.notes` / `e.lead`) instead of failing. Only broken front matter is unreadable, and it says which line ("Canon couldn't read line 5 of this entry's file (odd.md)…"), lists the entry by its name and kind. Read the Shelf keeps an unreadable file's name taken (a locked stand-in), so no duplicate is made. |
| 4 | Fixed | A hand fact with a value outside the lexicon is stored as written (Eyes: violet, Sex: nonbinary, Gender/Pronouns: they/them); `Pronouns: she/her` reads as female. Only lexicon values raise slips (`lexical`), so a they/them entry gets no he/she slips. |
| 5 | Fixed (one case kept) | Possessive after the name skips the pronoun rule; colour owner needs the name's possessive or a matching her/his (not "the child's", not "brown eyes in the dark", not "the"); appositive noun must head and close its phrase, not be a possessive, not start a list, and fit the entry's kind (no man/woman for a creature, no mare for a person); "the stallion's" marks only "stallion". Won't fix: "Tamsin took his hand" (no syntax tells it from "Bramble tossed his head"; ARCH §8 #11, dismiss once with Not a slip). Regression tests: canon.test.js "decoys…". |
| 6 | Fixed | A slip stays in the list but shows only while its paragraph reads as when found: Apply or a manual fix hides it, ⌘Z brings it back (repainted on `input`). e2e covers undo. |
| 7 | Fixed | Adding a second value for a single attribute asks: Replace It (old to Set aside) or Keep Both (both marked "Your sources disagree"; neither raises slips, `worldOf` clash rule). Hand-edited files with two yours values behave the same. |
| 8 | Fixed | New Entry / rename to a name (or alias) already used, compared normalised (NFC, case), is refused with a toast and the existing entry shown. |
| 9 | Fixed | Set Aside beside a same-named set-aside file takes `<id>-2`; any failure now says so. |
| 10 | Fixed | Names match as written or in capitals (BRAMBLE), never lower case (a bramble in a hedge); NFC and NFD forms both match. |
| 11 | Fixed | `slug` keeps letters of any script (李雷, æthelflæd). |
| 12 | Partly fixed | Capitalised pronouns after the name ("His") are checked. Won't fix now: "brown-eyed", "Her brown eyes" before the name, 4-letter name misspellings (by design, §8 #15). |
| 13 | Fixed | Straight single quotes count as speech when they open before a letter and close after one. |
| 14 | Fixed | The quote gate matches whole words only. |
| 15 | Fixed | Keep a Canon opens the book (from the shelf: the shelf's first) on the Canon tab; the Continuity Pass opt-in goes the same way. |
| 16 | Won't fix | Deliberate (ARCH §8 #4); the side text stays. |
| 17 | Fixed | A Notes source opens Notes and lights the quote once the page has loaded. |
| 18 | Fixed | Editing a fact to a new value moves the old one, with its sources, to Set aside; the new one is yours, written in Canon. |
| 19 | Fixed | `+ Add a fact` also shows on focus within the entry. |
| 20 | Fixed | Snippet: no double space, three words each side, span found as a whole word. |
| 21 | Fixed | Plural forms through t() (`{n} entries`, `{n} facts`, `{n} need you` in locales/en.json). |
| 22 | Fixed | canon.e2e.js writes screenshots only with `CANON_SHOTS=1`. |
| 23 | Won't fix | Documented behaviour without a reader. |
| 24 | Fixed | Greys moved to `var(--muted)` / a translucent border that works on both themes. |
| 25 | Fixed | Label/value gap. |
| 26 | Won't fix | NEO-wide toast timing, not Canon's. |
| 27 | Fixed | `Eyes: grey (storm grey)` keeps "storm grey". |
| 28 | Fixed in the file | An alias with a comma is written quoted (`"Hale, Jr."`) and reads back whole. The tab's "separated by commas" box still splits on commas (won't fix: rare, and the file can be edited). |
| 29 | Fixed | The file name is the entry's id wherever it's read; the nav shows the name of an unreadable entry. |
