# Fourth pass: rooms that fit together like the sketch

PROMPT.md is the original brief; FIXES-2.md and FIXES-3.md still apply. Do not regress: 82 unit tests (including `server/stitch.test.js`, the dropped-stream fix), the browser checks, the build, and the third-pass size check. Keep the architecture: Kimi writes only the PlanSpec generator; checks, renderer and furniture library are fixed, tested code.

## The problem

`samples/user/courtyard-house.png` is the sketch. `samples/user/courtyard-house-v-pass3.png` is what the app produced after pass 3, from a real run by the user. Every room now has its written size, but the result still does not look like the house:

1. **Rooms are scattered boxes with empty space between them.** In the sketch every wall is shared and the house is fully packed. In the result, large unlabelled white areas sit left of the Great Room, around the courtyard, above Dining and between wings.
2. **Relative positions are wrong.** Sketch → result: Dining is directly left of Kitchen in the sketch (result: stacked above it); Entry Foyer is directly below the Courtyard (result: to the right of it); Gym/Yoga is directly below the Great Room (result: below the courtyard); Pantry and Laundry/Mudroom are misplaced. The Great Room and Courtyard do not align with the wings around them.
3. **Labels are too big**: they sit on top of furniture symbols, and "GUEST BEDROOM" and "MEDIA ROOM" spill past their walls.
4. **Furniture is thinner than drawn**: a tiny dining table instead of the 10-seat one, no kitchen island, the courtyard tree and planting mostly missing.

Cause: the size check judges each room alone. Nothing checks that rooms touch the neighbours they touch in the sketch, or that the house has no leftover space. Kimi can pass every check with correctly sized rooms placed anywhere.

## Fixes, in order

1. **Dimension chains become a grid.** Update `prompts/generate.md`: first read the overall dimension chains on the sketch's edges (this sketch: top 6.40 / 5.60 / 7.00 / 5.60 / 7.40 m = 32.00 m; bottom 5.60 / 5.40 / 8.00 / 5.40 / 7.60 m; sides 21.00 m) and define column and row lines as PARAMS (cumulative positions derived from widths, so resizing one moves the others). Place each room by snapping its edges to grid lines or to a neighbour's edge; derive positions, never hardcode free coordinates. Rooms must tile the house: every interior point belongs to a room or a named circulation space (hall/corridor). Add a compact worked example to the prompt showing a room placed relative to a neighbour.
2. **Return adjacency as data.** Extend the module output / PlanSpec (optional, zod-validated) with `adjacency: [{ a: roomId, b: roomId, side: "N"|"S"|"E"|"W" }]`: what Kimi reads from the sketch ("Dining is W of Kitchen and shares a wall").
3. **New check: neighbours share a wall.** For each adjacency entry, rooms a and b must share a boundary segment of at least 600 mm (within wall thickness tolerance), with b on the stated side of a. Failures go back to Kimi as text naming both rooms and the side. Unit tests.
4. **New check: no leftover space.** Inside the exterior loop, the area not covered by any room polygon (allowing wall thickness) must be under 3% of the enclosed area. Report the largest uncovered regions with approximate coordinates and nearest rooms, so Kimi knows where to look. Outdoor/open rooms outside the loop are exempt. Unit tests.
5. **Review prompt.** `prompts/review.md` compares the position of every room against the sketch (which room is N/S/E/W of which) and checks for empty unlabelled space; REVISE when either is wrong.
6. **Labels.** Label fitting must also avoid furniture symbols (or draw labels on top of a soft background so both stay legible), and never exceed the room polygon. Use a smaller maximum font; shrink before wrapping, wrap before abbreviating. Same rule in plan.svg and the review PNG.
7. **Furniture fidelity.** generate.md: count the seats on a drawn dining table and size it to match (add a `seats` option to `dining_table`, chairs placed around it); place a drawn kitchen island; place drawn trees and planting in courtyards and gardens (instanced). Furniture checks still apply.

## Verification

- Unit tests for the adjacency check, the leftover-space check, the dining_table seats option and label fitting with furniture.
- Run the real loop on `samples/user/courtyard-house.png` (and confirm `samples/two-bedroom.png` still works). Run the loop through the actual server endpoints (`/api/generate`, `/api/review`) so the dropped-stream handling is exercised. Record in the README: the room-size table, an adjacency table (sketch says / result has / pass), leftover-space percentage, time to first walkable and total time, real costs only.
- Save `screenshots/courtyard-pass4-plan.png`, a dollhouse and a walkthrough capture. Open each with the Read tool and compare against the sketch room by room: every room in the right place relative to its neighbours, no empty white areas inside the house, labels legible and inside rooms, dining table / island / courtyard tree present.
- Keep existing tests and browser checks green; `npm run build`.

Finish with a short, factual account: what changed, before/after for the courtyard house, and what is still limited.
