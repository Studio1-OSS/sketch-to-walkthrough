import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import type { CheckResults } from '../src/lib/checks';
import type { PlanSpec } from '../src/lib/plan';

// Load the exact app modules through Vite's TypeScript transformer.
const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
const { buildFromModule } = await vite.ssrLoadModule('/src/lib/module.ts') as typeof import('../src/lib/module');
const checksModule = await vite.ssrLoadModule('/src/lib/checks.ts');
const svgModule = await vite.ssrLoadModule('/src/lib/plan-svg.ts');
const runChecks = checksModule.runChecks as (plan: PlanSpec) => CheckResults;
const planToSVG = svgModule.planToSVG as (plan: PlanSpec) => string;
const furnitureModule = await vite.ssrLoadModule('/src/lib/furniture.ts');
const applyFurnishing = furnitureModule.applyFurnishing as (plan: PlanSpec, enabled: boolean) => PlanSpec;
const outputPrefix = process.env.REPLAY_PREFIX ?? 'screenshots/replayed-v';
const outputEvidence = process.env.REPLAY_EVIDENCE ?? 'screenshots/replay-verification.json';

// Offline replay of the previously captured REAL API answers; no network requests.
const input = path.resolve(process.env.MODEL_EVIDENCE ?? 'screenshots/model-verification.json');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const calls = evidence.calls;
const results: object[] = [];
let sourceVersion = 0;
for (let i = 0; i < calls.length; i++) {
  const source = calls[i].code;
  if (!source || i === 0 && !source.includes('buildPlan')) {
    if (calls[i].path === '/api/generate') throw new Error('Generate response did not include code.');
    continue;
  }
  // A REVISE on v3 includes a suggested fourth module that the app deliberately does not apply.
  if (sourceVersion >= 3) continue;
  const version = ++sourceVersion;
  let check: CheckResults | { ok: false; failures: string[] };
  try {
    const result = buildFromModule(source), plan = applyFurnishing(result.plan, true);
    check = runChecks(plan);
    const basename = `${outputPrefix}${version}`;
    fs.writeFileSync(`${basename}-plan.json`, JSON.stringify(plan, null, 2));
    fs.writeFileSync(`${basename}-plan.svg`, planToSVG(plan));
    fs.writeFileSync(`${basename}-generator.js`, source);
    results.push({ version, built: true, checks: check, entry: plan.entry, rooms: plan.rooms.length, furniture: plan.furniture.length, params: Object.keys(result.params).length, assumptions: result.assumptions.length, repairs: result.repairs });
  } catch (error) {
    check = { ok: false, failures: [(error as Error).message] };
    results.push({ version, built: false, checks: check });
  }
  console.log(`v${version}`, JSON.stringify(results.at(-1)));
}
await vite.close();
fs.writeFileSync(outputEvidence, JSON.stringify({ input, realModelCalls: calls.length, source: 'Offline replay of real API answers, no additional requests', results }, null, 2));
