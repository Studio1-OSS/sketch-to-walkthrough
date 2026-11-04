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

// Offline replay of the previously captured REAL API answers; no network requests.
const input = path.resolve(process.env.MODEL_EVIDENCE ?? 'screenshots/model-verification.json');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const calls = evidence.calls;
const results: object[] = [];
for (let i = 0; i < calls.length; i++) {
  const source = calls[i].code;
  if (!source || i === 0 && !source.includes('buildPlan')) {
    if (calls[i].path === '/api/generate') throw new Error('Generate response did not include code.');
    continue;
  }
  let check: CheckResults | { ok: false; failures: string[] };
  try {
    const result = buildFromModule(source);
    check = runChecks(result.plan);
    const basename = `screenshots/replayed-v${i + 1}`;
    fs.writeFileSync(`${basename}-plan.json`, JSON.stringify(result.plan, null, 2));
    fs.writeFileSync(`${basename}-plan.svg`, planToSVG(result.plan));
    fs.writeFileSync(`${basename}-generator.js`, source);
    results.push({ version: i + 1, built: true, checks: check, entry: result.plan.entry, rooms: result.plan.rooms.length, params: Object.keys(result.params).length, assumptions: result.assumptions.length, repairs: result.repairs });
  } catch (error) {
    check = { ok: false, failures: [(error as Error).message] };
    results.push({ version: i + 1, built: false, checks: check });
  }
  console.log(`v${i + 1}`, JSON.stringify(results.at(-1)));
}
await vite.close();
fs.writeFileSync('screenshots/replay-verification.json', JSON.stringify({ realModelCalls: calls.length, source: 'Offline replay of real API answers, no additional requests', results }, null, 2));
