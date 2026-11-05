import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// Render previously captured REAL model code with the current local renderer.
// Both API routes are intercepted: this script makes no model calls and is not a model verification run.
const input = path.resolve(process.env.MODEL_EVIDENCE || 'screenshots/courtyard-verification.json');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const versionCount = evidence.versions?.length || 1;
const code = [evidence.calls[0]?.code, ...evidence.calls.filter((call) => call.path === '/api/review').map((call) => call.code).filter(Boolean)].slice(0, versionCount).at(-1);
if (!code) throw new Error(`No source to replay in ${input}`);
const sample = evidence.sampleImage || path.resolve('public/samples/two-bedroom.png');
const prefix = process.env.REPLAY_SHOT_PREFIX || 'courtyard-final';
const OUT = path.resolve('screenshots');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
try {
  await page.route('**/api/generate', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code, model: 'offline-replay', elapsed: 0, tokensPerSecond: 0, usage: { completion: 0, total: 0 } }) }));
  await page.route('**/api/review', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ verdict: 'REVISE', issues: ['Offline render replay; no vision review was run.'], improvements: [], code: '', model: 'offline-replay', elapsed: 0, tokensPerSecond: 0, usage: { completion: 0, total: 0 } }) }));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('input[type="file"]').setInputFiles(sample);
  await page.waitForSelector('.canvas-wrap .viewer-host[data-ready="true"]', { timeout: 120000 });
  await page.waitForSelector('.generation-overlay', { state: 'hidden', timeout: 120000 });
  await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${prefix}-plan.png`) });
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${prefix}-dollhouse.png`) });
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click(); await page.waitForTimeout(500);
  const enter = page.getByRole('button', { name: 'Enter your walkthrough' }); if (await enter.isVisible()) await enter.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${prefix}-walkthrough.png`) });
  const state = await page.locator('.canvas-wrap .viewer-host').evaluate((host) => ({ checks: host.dataset.checks, furniture: Number(host.dataset.furniture), openRooms: host.dataset.openRooms }));
  fs.writeFileSync(path.join(OUT, `${prefix}-render-replay.json`), JSON.stringify({ input, source: 'Offline render of previously captured real model code; no model calls', state, errors }, null, 2));
  console.log(`${prefix}:`, JSON.stringify(state), `${errors.length} browser errors`);
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
