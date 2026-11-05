import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180';
const API_BASE = process.env.API_BASE_URL || BASE;
const OUT = path.resolve('screenshots');
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'] });
const page = await browser.newPage();
const results = [];
try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  const health = await page.evaluate(async (base) => (await fetch(`${base}/api/health`)).json(), API_BASE);
  for (const sample of ['two-bedroom', 'studio', 'garden-flat']) {
    const image = `data:image/png;base64,${fs.readFileSync(path.resolve(`public/samples/${sample}.png`)).toString('base64')}`;
    console.log(`REAL GENERATION: ${sample} (${health.generateReasoningEffort} reasoning)`);
    const result = await page.evaluate(async ({ image, sample, apiBase }) => {
      const started = performance.now();
      try {
        const response = await fetch(`${apiBase}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
        const body = await response.json();
        if (!response.ok || body.error) return { sample, response, error: body.error || `HTTP ${response.status}`, wallSeconds: (performance.now() - started) / 1000 };
        let built = false, checks = null, repairs = [], error = null;
        try {
          const { buildFromModule } = await import('/src/lib/module.ts');
          const { runChecks } = await import('/src/lib/checks.ts');
          const generated = buildFromModule(body.code);
          checks = runChecks(generated.plan);
          repairs = generated.repairs;
          built = true;
        } catch (cause) { error = String(cause); }
        return { sample, response: body, built, checks, repairs, error, wallSeconds: (performance.now() - started) / 1000 };
      } catch (error) { return { sample, error: String(error), wallSeconds: (performance.now() - started) / 1000 }; }
    }, { image, sample, apiBase: API_BASE });
    results.push(result);
    console.log(`${result.built && result.checks?.ok ? 'PASS' : 'FAIL'}: ${sample} · ${result.response?.elapsed ?? '?'}s API · ${result.response?.usage?.completion ?? '?'} tokens · ${result.response?.tokensPerSecond ?? '?'} tok/s · ${result.response?.usage?.reasoning ?? '?'} reasoning tokens`);
    if (result.error) console.log(result.error);
    if (result.repairs?.length) console.log('Local repairs:', result.repairs);
    if (result.checks && !result.checks.ok) console.log(result.checks.failures);
  }
  fs.writeFileSync(path.join(OUT, 'generation-verification.json'), JSON.stringify({ date: new Date().toISOString(), realModelCalls: results.filter((r) => r.response).length, health, results }, null, 2));
  if (results.length !== 3 || results.some((r) => !r.built || !r.checks?.ok)) process.exitCode = 1;
} catch (error) {
  fs.writeFileSync(path.join(OUT, 'generation-verification.json'), JSON.stringify({ date: new Date().toISOString(), error: String(error), results }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
