Build me an open-source web app called "Sketch to Walkthrough". It turns a photo of a
hand-drawn floor plan into a 3D model you can walk through in the browser.

## The flow
1. User uploads a photo of a hand-drawn floor plan (rooms, walls, doors, windows,
   written dimensions in m, cm, mm or ft).
2. The server sends the image to Kimi K3.1 Pro (vision). Kimi writes a JavaScript module:
     export const PARAMS = { ... }          // every dimension, in mm, flat and named
     export const ASSUMPTIONS = [ ... ]     // what it inferred where the sketch was silent
     export function buildPlan(P) { ... }   // returns a PlanSpec (schema below)
3. The app runs buildPlan(PARAMS) in a sandboxed Web Worker (no DOM, no network,
   500 ms timeout) and validates the result with zod.
4. Deterministic checks run (list below). Any failures go back to Kimi as text.
5. The app renders a top-down orthographic view with room labels and dimension lines,
   captured from the canvas as PNG.
6. Kimi gets the original sketch + the render + check results, and answers with JSON:
     { "verdict": "PASS" | "REVISE", "issues": [...], "code": "<revised module if REVISE>" }
   Loop at most 3 times. Even after a PASS, let it do one optional refinement pass
   if it lists concrete improvements. Keep every version (v1, v2, v3) and let the user
   switch between them.
7. The user gets:
   - a 3D viewer with three modes: top-down plan, dollhouse (orbit, roof off),
     and first-person walkthrough
   - one slider per PARAMS entry (grouped: global, per room). Moving a slider reruns
     buildPlan locally in the worker, so the update is instant with no model call
   - an "Assumptions" panel showing what Kimi filled in, each one editable via its slider
   - downloads: .glb (GLTFExporter), plan.json, plan.js (the generator), plan.svg (2D plan)

## PlanSpec schema (units: mm, origin bottom-left, y up in plan view)
{
  wallHeight: number,
  walls:   [{ id, a: [x,y], b: [x,y], thickness, exterior: boolean }],
  rooms:   [{ id, name, polygon: [[x,y],...], floor: "wood"|"tile"|"carpet"|"concrete" }],
  openings:[{ id, wallId, type: "door"|"window"|"opening", offset, width, height,
              sill?: number, swing?: "left"|"right" }],
  entry:   { position: [x,y], facing: degrees }   // where the walkthrough starts
}

## Deterministic checks (run before every vision review, send failures back to Kimi)
- exterior walls form a closed loop; no zero-length or overlapping walls
- room polygons are valid, don't overlap, and each sits inside the exterior
- every opening fits within its wall with at least 100 mm to each end
- every room is reachable from the entry through doors/openings (graph check)
- doors are at least 800 mm wide, hallways at least 900 mm, window sills 600-1100 mm
- sliders are clamped so these rules still hold (store min/max with each param)

## 3D build (Three.js, r160+)
- walls: extruded boxes with real holes cut for doors and windows (use
  three-bvh-csg, or build the wall from segments around each opening)
- floors per room with a simple material per floor type; ceiling hidden in dollhouse mode
- doors as thin panels set ajar; windows as transparent glass panes
- soft lighting: hemisphere light + one directional light with shadows
- first-person: PointerLockControls, WASD + mouse, eye height 1600 mm, collision
  against walls (simple segment-vs-circle test), spawn at plan.entry.
  On mobile: a virtual joystick + drag to look.
- room name labels floating at the center of each room (toggleable)

## Model API (Kimi K3.1 Pro on Nebius Token Factory)
- Nebius Token Factory is OpenAI-compatible (`POST {base}/chat/completions`). Config comes from
  env, already filled in in `.env` (gitignored; never commit it):
    NEBIUS_API_KEY   - the key
    NEBIUS_BASE_URL  - default https://api.tokenfactory.nebius.com/v1
    MODEL            - default moonshotai/Kimi-K3.1-Pro
  Also commit a `.env.example` with the same names and no key.
- Facts measured on this endpoint for moonshotai/Kimi-K3.1-Pro: it accepts images as
  `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}` content parts; 1M-token
  context; `reasoning_effort` accepts none/low/medium/high/max (xhigh is rejected with a 400);
  reasoning arrives in `reasoning_content` and the answer in `content`; streaming with
  `stream_options: {"include_usage": true}` returns usage in the final chunk.
- Call it only from the server. Never expose the key to the browser.
- Stream responses. Long generations can drop mid-stream: if a stream dies,
  resend with the partial output and ask the model to continue from where it stopped.
- Log completion tokens and tokens/sec per call and show them in a small debug panel.
- Swapping models must be one env var (MODEL), e.g. any other vision model on Nebius.

## Prompts to Kimi (write these as separate files in /prompts)
- generate.md: read every written dimension exactly. Convert to mm. Put every
  dimension in PARAMS with a clear name (living_w, kitchen_d, hall_width...).
  Where the sketch is silent (wall height, door widths, wall thickness, window
  positions), choose sensible residential defaults and list each in ASSUMPTIONS
  with a reason. Geometry must be derived from PARAMS, never hardcoded, so resizing
  a room moves the walls that touch it.
- review.md: compare the render against the sketch room by room: count, names,
  relative positions, proportions, door and window placement. Be strict. Answer only
  the JSON shape above.

## Stack
- Vite + React + TypeScript front end, a tiny Node (Hono or Express) server for the
  model calls and image upload. No database. Everything runs with `npm install && npm run dev`.
- Put 3 sample sketches in /samples (draw them as simple PNGs you generate yourself)
  so the app can be tried without uploading anything.

## Done means
- I can upload a sketch and walk through it in under 2 minutes.
- Every slider move rebuilds in under 200 ms.
- The README explains the generate, check, render, review loop with a diagram,
  and how to swap models with a single env var.
- Tests for the deterministic checks and the PlanSpec validator.

Work in small steps. Get the PlanSpec to 3D renderer working first with a hardcoded
sample plan, then the walkthrough, then the model loop, then sliders and exports.

Notes:
- Why JSON plus a generator instead of raw Three.js code: the 3D renderer stays fixed and tested, and
  Kimi only controls the layout. That makes the checks (closed walls, doors that fit, every room
  reachable) possible, and those checks are what give you a "did engineering I never asked for" moment.
- Good test sketch: a 2-bedroom plan with a few dimensions written in and a few left out. That shows
  off both "read every dimension right" and "filled the gaps and told me."

---
Working notes for this run:
- The real model endpoint works with the key in `.env`. Once the loop is built, run it end to end on
  at least one sample sketch for real (it costs a few cents) and record what happened: versions
  produced, check results, verdicts, tokens/sec, total time. Do not fake or mock this in the
  verification results. Unit tests may mock the model.
- Browser verification: Playwright with the full Chromium from ~/Library/Caches/ms-playwright
  (chromium-1234, "Google Chrome for Testing") renders WebGL headless; the headless-shell build does
  not. ../explode-anything/scripts/browser-check.mjs is a working example of the launch setup.
  Save screenshots to ./screenshots/ and open each one with your Read tool. Judge them visually: a
  state check passing is not evidence the page looks right (a previous project shipped a blank page
  that passed every state check).
- Finish with a README section "Verification" listing only what you actually checked, and a short
  factual account of what works and what is limited.
