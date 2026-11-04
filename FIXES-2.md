# Second pass: fix list

The app works end to end (README, screenshots/, model-verification.json). PROMPT.md is the original brief and still applies. Do not regress what works: 36 unit tests, 32 browser checks, the build. Fix these, in this order, and keep changes focused.

## 1. Time to first walkable model (most important)

Measured on the real run: v1 at ~134 s and v2 both failed validation, so nothing was walkable until v3 at ~15.6 min. The brief's bar is "upload a sketch and walk through it in under 2 minutes". Causes and fixes:

a. **Over-strict parameter rule.** `src/lib/plan.ts:43` rejects a param whose value equals its min or max ("Each parameter needs min < value < max"). That alone threw away v1. Change the rule to `min <= value <= max` (and `min < max`) everywhere: the zod schema, the prompts (generate.md / review.md), the README and the tests.

b. **Repair trivial slips locally instead of spending a model round on them.** Before declaring a version invalid, apply deterministic repairs and record each one as a visible note on that version: clamp a value into [min, max]; fill a missing optional/derivable field on an ASSUMPTIONS entry (v2 failed only because ASSUMPTIONS[7] lacked its `param` field: if it can be matched to a PARAMS key by name, link it; if not, keep it as a text-only assumption without a slider). Only structural failures (schema shape, buildPlan throwing, failed engineering checks) should need the model.

c. **Show the first valid version immediately.** As soon as v1 passes validation + deterministic checks, open it in the 3D viewer (walkable) while the vision review continues in the background. When a review returns REVISE with new code, add v2 to the version switcher with a small "newer version available" notice; do not yank the user out of the walkthrough.

d. **Make generation faster.** Generation streamed 5,825 completion tokens at ~44 tok/s. Tighten generate.md so the module is compact (no comments, no redundant params, helper functions instead of repeated wall code). Check whether `reasoning_effort: "none"` for generation still produces valid modules on the samples (it answers with zero reasoning tokens on this endpoint); keep whichever passes. Keep the review at a moderate effort.

Then re-run the real end-to-end check on samples/two-bedroom.png and record honestly in the README and screenshots/model-verification.json: time to first walkable version, time to the final version, verdicts, tokens/sec. If 2 minutes is still not met, say so and say what dominates.

## 2. Walkthrough spawn view

In screenshots/05-walkthrough.png the user spawns staring at a door from a few centimetres away. Spawn should be inside the entry room, about 1 m clear of any wall, facing into the room (toward the room's centroid or the longest clear sight line), so the first frame shows the room. Validate the spawn point against walls with the existing collision test; nudge it if it is too close.

## 3. Room labels

- Labels use `depthTest: false` (src/lib/world.ts:36), so in the walkthrough they show through walls. In walkthrough mode, labels must be occluded by walls (depthTest true) or hidden unless the room is visible; only the current room's and directly visible rooms' labels should show.
- In dollhouse mode the labels render at ~6 px text and are unreadable (screenshots/02-dollhouse.png). Make them readable at the default dollhouse zoom (screen-space sizing, e.g. sizeAttenuation false, or CSS2D labels).

## 4. Assumptions panel mismatch

In screenshots/05-walkthrough.png the Wall height assumption says "a conventional 2700 mm wall height is used" while its slider shows 3.40 m. Either the text must update to the live value or describe only the original assumption ("Kimi assumed 2700 mm") with the current value shown separately. Check this for every assumption card.

## 5. Landing page hero card

The "YOUR WALKTHROUGH" card title overlaps "look closer", and the "2700 / ceiling height" label is half hidden behind the card. Fix the overlap at 1440, 1280 and 390 widths.

## Verification

After each item, run the tests and the browser checks, open the relevant screenshots with the Read tool and judge them visually. Add a browser check for: a param exactly at min/max is valid; v1 opens as soon as it validates; the walkthrough spawn is at least 900 mm from every wall; labels are occluded in walkthrough. Run `npm run build` at the end. Update the README's verification and limitations sections to match what is now true, with real numbers only.

Finish with a short, factual account of what changed and what is still limited.
