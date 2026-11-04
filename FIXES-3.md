# Third pass: layout fidelity, then furniture

PROMPT.md is the original brief and still applies. The app works (README, screenshots/). Do not regress: 45 unit tests, 43 browser checks, the build, and first-walkable-version latency (~2 min with `low` generation effort). Keep the existing architecture: Kimi only writes the PlanSpec generator; the renderer, checks and furniture library are fixed, tested code.

A user uploaded a real, detailed sketch and got a poor result. Both files are in `samples/user/`:
- `courtyard-house.png`: the sketch. A 32 m x 21 m single-storey house with ~21 rooms, a central open-to-sky courtyard, a covered terrace and a pool, every room dimensioned (e.g. "BED 02 4.00 x 3.60 m") plus a room schedule table in the corner, and drawn furniture (beds, sofas, dining table, kitchen island, bath tub, WCs, gym equipment, two cars, trees/planting).
- `courtyard-house-v-before.png`: what the app produced. Kimi ignored the written sizes and forced a uniform grid: Bed 02 came out 40.4 m² (sketch: 4.00 x 3.60 = 14.4 m²), Shared Bath 19.1 m² (sketch 3.00 x 2.40 = 7.2 m²), Dressing 17.1 m² (sketch 8.6 m²). The courtyard became an ordinary enclosed room with doors swinging into it. The pool and landscaping vanished. Room labels overflow their rooms in the 2D plan ("Shared Bat", "Guest Bedr", "Courtyard — Open to Sl").

## Part 1. Layout fidelity (do this first)

1. **Read written room sizes.** Update `prompts/generate.md`: before laying anything out, list every written room dimension and any room schedule / legend table; each room's width and depth must come from those numbers (as PARAMS), and the room arrangement must follow the sketch's relative positions. A uniform grid is wrong unless the sketch is a uniform grid. Also: convert every written unit exactly (e.g. 12' 6" = 3810 mm); never drop a written dimension as "approximate".
2. **Return the written sizes as data.** Add an optional `schedule` to the module output (or to PlanSpec): `[{ roomId, writtenWidth, writtenDepth, source: "label"|"schedule" }]`, so checks can compare.
3. **New deterministic check: room sizes match the sketch.** For each room with a written size, its polygon's bounding width/depth must be within ±10% (or ±150 mm, whichever is larger) of the written numbers, in either orientation. Failures go back to Kimi as text like the other checks. Add unit tests.
4. **Review is stricter about sizes.** `prompts/review.md` must check room proportions against written dimensions and return REVISE when a room is clearly the wrong size.
5. **Outdoor / open-air spaces.** Add a room kind (e.g. `kind: "indoor" | "open" | "outdoor"`, default indoor) plus floor types `"paving"`, `"grass"`, `"water"`. Open rooms (courtyards) render with no ceiling and no roof in any mode. Outdoor areas (terrace, pool, garden) may sit outside the exterior loop; the "rooms inside the exterior" check exempts them, and the reachability check treats a courtyard's glazed doors normally. A pool renders as a recessed water surface with a coping edge.
6. **Labels fit their rooms.** In the 2D plan render (the review PNG and plan.svg) and the 3D labels, scale or wrap the label (name + area) to fit inside the room polygon; abbreviate only as a last resort. No text may overflow into a neighbouring room.

## Part 2. Furniture and fixtures

7. **PlanSpec gets `furniture`:** `[{ id, roomId, type, position: [x,y], rotation: degrees, size?: [w,d] }]` in mm, validated with zod. `type` comes from a fixed catalogue (start with ~20): `bed_double, bed_single, nightstand, wardrobe, sofa, armchair, coffee_table, tv_unit, dining_table (with chairs), kitchen_run, kitchen_island, fridge, toilet, basin_vanity, bathtub, shower, desk, bookshelf, washer, car, plant, tree, gym_bike, yoga_mat, lounger`. Each type has default dimensions.
8. **Kimi places what it sees.** generate.md: list the furniture drawn in each room and place it (position/rotation from the sketch). The sketch is the source of truth.
9. **Deterministic auto-furnish** fills rooms where the sketch shows nothing, by room name/type (bedroom: bed + nightstands + wardrobe; living: sofa + coffee table + TV unit; kitchen: kitchen run (+ island if large); bath: WC + basin + shower or tub; garage: one car per ~2.8 m of width; etc.). Mark auto-placed items so the UI can show "added by default" vs "from your sketch"; make auto-furnish toggleable.
10. **Furniture checks** (deterministic, unit tested): every item fully inside its room polygon; no item overlaps another; no item intersects a door's swing arc or an opening's clear width; a walkable path (≥ 600 mm) exists from each door into the room. Auto-furnish must satisfy these by construction (try alternative wall placements, drop items rather than violate).
11. **Rendering:** a fixed low-poly procedural Three.js furniture library, one builder per type, sharing materials, instanced where repeated (chairs, plants). Tasteful and simple, matching the app's calm palette; recognisable silhouettes beat detail. Plan view and plan.svg draw clean furniture symbols (like the sketch). The GLB export includes furniture.
12. **Walkthrough collision** includes furniture footprints (tall items block; rugs/mats don't).

## Verification

- Unit tests for the size check, the open/outdoor rules, furniture validation and every furniture check.
- Run the real end-to-end loop on `samples/user/courtyard-house.png` and on `samples/two-bedroom.png`. For the courtyard house, record a room-by-room table in the README: written size vs generated size, and whether the size check passed. Record time to first walkable version and total time. Save the new 2D plan render as `screenshots/courtyard-after-plan.png` and dollhouse / walkthrough screenshots with furniture.
- Open every screenshot with the Read tool and judge it visually against the sketch: right room sizes and positions, open courtyard, pool/terrace present, furniture recognisable and sensibly placed, labels inside their rooms.
- Keep the existing tests and browser checks green; add browser checks for furniture rendering, the open courtyard (no ceiling), and walkthrough collision with furniture. Run `npm run build`.
- Update the README (architecture, PlanSpec schema, checks list, verification, limitations) with real numbers only.

Finish with a short, factual account of what changed, the before/after for the courtyard house, and what is still limited.
