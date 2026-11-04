import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import type { CheckResults } from '../src/lib/checks';
import type { PlanSpec } from '../src/lib/plan';

// Replays captured real generation answers through the current app code, without network calls.
const input = path.resolve(process.env.MODEL_EVIDENCE ?? 'screenshots/generation-verification.json');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
const { buildFromModule } = await vite.ssrLoadModule('/src/lib/module.ts') as typeof import('../src/lib/module');
const { runChecks } = await vite.ssrLoadModule('/src/lib/checks.ts') as { runChecks: (plan: PlanSpec) => CheckResults };
const results = [];
for (const sample of evidence.results ?? []) {
  try {
    const result = buildFromModule(sample.response.code);
    const checks = runChecks(result.plan);
    results.push({ sample: sample.sample, built: true, checks, repairs: result.repairs });
    console.log(`${checks.ok ? 'PASS' : 'FAIL'}: ${sample.sample}`, checks.failures, result.repairs);
  } catch (error) {
    results.push({ sample: sample.sample, built: false, error: String(error) });
    console.log(`FAIL: ${sample.sample}`, String(error));
  }
}
await vite.close();
const output = { source: input, replayedAt: new Date().toISOString(), realModelCalls: evidence.realModelCalls, networkCallsDuringReplay: 0, health: evidence.health, results };
fs.writeFileSync(path.resolve(process.env.REPLAY_OUTPUT ?? 'screenshots/generation-replay.json'), JSON.stringify(output, null, 2));
if (results.some((result) => !result.built || !result.checks?.ok)) process.exitCode = 1;
