import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180';
const SAMPLE_IMAGE = process.env.SAMPLE_IMAGE ? path.resolve(process.env.SAMPLE_IMAGE) : null;
const PREFIX = process.env.EVIDENCE_PREFIX || (SAMPLE_IMAGE ? 'courtyard' : 'live');
const EVIDENCE = process.env.MODEL_EVIDENCE || (SAMPLE_IMAGE ? 'courtyard-verification.json' : 'model-verification.json');
const REUSE_GENERATION_FROM = process.env.REUSE_GENERATION_FROM ? path.resolve(process.env.REUSE_GENERATION_FROM) : null;
const priorEvidence = REUSE_GENERATION_FROM ? JSON.parse(fs.readFileSync(REUSE_GENERATION_FROM, 'utf8')) : null;
const reusedGeneration = priorEvidence?.calls.find((call) => call.path === '/api/generate' && call.code);
const reusedGenerationSeconds = reusedGeneration?.elapsed || 0;
const priorReviews = priorEvidence?.calls.filter((call) => call.path === '/api/review' && call.verdict && call.code) || [];
const replayedReviewCount = Math.min(Number(process.env.REPLAY_REVIEW_COUNT || 0), priorReviews.length);
const replayedReviews = priorReviews.slice(0, replayedReviewCount);
const reusedModelSeconds = reusedGenerationSeconds + replayedReviews.reduce((sum, call) => sum + (call.elapsed || 0), 0);
if (REUSE_GENERATION_FROM && !reusedGeneration) throw new Error(`No captured generation source in ${REUSE_GENERATION_FROM}`);
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const calls = [], errors = [];
let reviewNumber = 0, interceptedReviews = 0;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', async (response) => {
  if (!/\/api\/(generate|review)$/.test(new URL(response.url()).pathname)) return;
  try {
    const body = await response.json(); const request = response.request().postDataJSON();
    body.completion = body.usage?.completion ?? body.completion;
    calls.push({ path: new URL(response.url()).pathname, status: response.status(), ...body });
    if (request.sketch) {
      const base = (image) => Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
      fs.writeFileSync(path.join(OUT, `${PREFIX}-original-sketch.png`), base(request.sketch));
      reviewNumber += 1;
      if (request.render) fs.writeFileSync(path.join(OUT, `${PREFIX}-v${reviewNumber}-review-render.png`), base(request.render));
    }
    console.log(`${body.reused ? 'REUSED CAPTURED MODEL RESPONSE (no new model call)' : `REAL API ${response.status()}`}: ${body.kind || response.url()} · ${body.completion} completion tokens · ${body.tokensPerSecond} tok/s · ${body.elapsed}s`);
    if (body.verdict) console.log(`  ${body.verdict}`, JSON.stringify(body.issues), 'improvements:', JSON.stringify(body.improvements));
    if (body.error) console.error('  API error:', body.error);
  } catch (error) { errors.push(String(error)); }
});
let started = 0, firstWalkableWallSeconds = null, firstWalkableAppSeconds = null, health = null;
try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  health = await page.evaluate(async () => (await fetch('/api/health')).json());
  await page.waitForSelector('.hero-model .viewer-host[data-ready="true"]', { timeout: 45000 });
  if (reusedGeneration) await page.route('**/api/generate', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: reusedGeneration.code, model: reusedGeneration.model, elapsed: reusedGeneration.elapsed, tokensPerSecond: reusedGeneration.tokensPerSecond, reused: true, usage: reusedGeneration.usage }) }));
  if (replayedReviews.length) await page.route('**/api/review', (route) => {
    if (interceptedReviews >= replayedReviews.length) return route.continue();
    const historical = replayedReviews[interceptedReviews++];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...historical, reused: true }) });
  });
  started = Date.now();
  if (SAMPLE_IMAGE) await page.locator('input[type="file"]').setInputFiles(SAMPLE_IMAGE);
  else await page.getByRole('button', { name: 'Generate walkthrough from The two-bedroom', exact: true }).click();
  await page.waitForSelector('.generation-overlay', { state: 'visible', timeout: 20000 });
  console.log('Real generation request started; waiting for the first valid version.');
  await page.waitForFunction(() => { const studio = document.querySelector('.studio'); return Number(studio?.dataset.firstWalkable) > 0 || Number(studio?.dataset.finalElapsed) > 0; }, undefined, { timeout: 1200000 });
  const firstWalkable = await page.locator('.studio').getAttribute('data-first-walkable');
  if (firstWalkable) {
    firstWalkableWallSeconds = (Date.now() - started) / 1000;
    firstWalkableAppSeconds = Number(firstWalkable);
    console.log(`FIRST WALKABLE VERSION in ${firstWalkableWallSeconds.toFixed(1)}s wall / ${firstWalkableAppSeconds.toFixed(1)}s app.`);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-first-walkable.png`) });
  }
  await page.waitForFunction(() => Number(document.querySelector('.studio')?.dataset.finalElapsed) > 0, undefined, { timeout: 1200000 });
  await page.waitForSelector('.generation-overlay', { state: 'hidden', timeout: 1000 });
  await page.waitForTimeout(1800);
  const wallSeconds = (Date.now() - started) / 1000;
  console.log(`LIVE LOOP FINISHED in ${wallSeconds.toFixed(1)}s. ${calls.length} real model requests.`);
  const versions = [];
  const buttons = await page.locator('.version-button').count();
  for (let i = 0; i < buttons; i++) {
    const v = i + 1;
    await page.locator('.version-button').nth(i).click();
    await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-v${v}-plan.png`) });
    await page.getByRole('tab', { name: /Checks/ }).click();
    const checks = await page.locator('.checks-panel').innerText();
    const verdict = await page.locator('.version-button').nth(i).innerText();
    versions.push({ version: v, button: verdict, engineeringState: await page.locator('.canvas-wrap .viewer-host').count() ? await page.locator('.canvas-wrap .viewer-host').getAttribute('data-checks') : 'no-valid-plan', checks });
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-v${v}-checks.png`) });
  }
  if (await page.locator('.version-button:not(.invalid)').count() === 0) throw new Error('No schema-valid plan was returned. See version errors and real API calls.');
  await page.locator('.version-button:not(.invalid)').last().click();
  await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, SAMPLE_IMAGE ? 'courtyard-after-plan.png' : `${PREFIX}-after-plan.png`) });
  await page.locator('.export-button').click();
  const planDownloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu>button').filter({ hasText: 'Plan data' }).click();
  const planDownload = await planDownloadPromise, finalPlanPath = path.join(OUT, `${PREFIX}-final-plan.json`);
  await planDownload.saveAs(finalPlanPath);
  const finalPlan = JSON.parse(fs.readFileSync(finalPlanPath, 'utf8'));
  const roomSizes = (finalPlan.schedule || []).map((entry) => {
    const room = finalPlan.rooms.find((r) => r.id === entry.roomId);
    if (!room) return { roomId: entry.roomId, name: entry.roomId, written: [entry.writtenWidth, entry.writtenDepth], generated: null, source: entry.source, pass: false };
    const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
    const generatedWidth = Math.max(...xs) - Math.min(...xs), generatedDepth = Math.max(...ys) - Math.min(...ys);
    const pass = [[generatedWidth, generatedDepth], [generatedDepth, generatedWidth]].some((actual) => actual.every((value, axis) => Math.abs(value - [entry.writtenWidth, entry.writtenDepth][axis]) <= Math.max(150, [entry.writtenWidth, entry.writtenDepth][axis] * 0.1) + 0.001));
    return { roomId: entry.roomId, name: room.name, written: [entry.writtenWidth, entry.writtenDepth], generated: [generatedWidth, generatedDepth], source: entry.source, pass };
  });
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, SAMPLE_IMAGE ? 'courtyard-dollhouse.png' : `${PREFIX}-final-dollhouse.png`) });
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click(); await page.waitForTimeout(400);
  const entry = page.getByRole('button', { name: 'Enter your walkthrough' });
  if (await entry.isVisible()) await entry.click();
  await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, SAMPLE_IMAGE ? 'courtyard-walkthrough.png' : `${PREFIX}-final-walkthrough.png`) });
  await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, SAMPLE_IMAGE ? 'courtyard-walkthrough.png' : `${PREFIX}-final-walkthrough.png`) });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.locator('.debug-button').click(); await page.waitForTimeout(200); await page.screenshot({ path: path.join(OUT, `${PREFIX}-debug.png`) });
  const combinedFirstWalkableWallSeconds = firstWalkableWallSeconds === null ? null : firstWalkableWallSeconds + reusedModelSeconds;
  const combinedFirstWalkableAppSeconds = firstWalkableAppSeconds === null ? null : firstWalkableAppSeconds + reusedModelSeconds;
  const combinedWallSeconds = wallSeconds + reusedModelSeconds;
  const results = { date: new Date().toISOString(), sampleImage: SAMPLE_IMAGE, model: calls[0]?.model, health, realModelCalls: calls.filter((call) => !call.reused).length + (reusedGeneration ? 1 : 0) + replayedReviewCount, firstWalkableWallSeconds, firstWalkableAppSeconds, wallSeconds, reusedGenerationFrom: REUSE_GENERATION_FROM, reusedGenerationSeconds, combinedFirstWalkableWallSeconds, combinedFirstWalkableAppSeconds, combinedWallSeconds, versions, roomSizes, furnitureCount: finalPlan.furniture.length, sketchFurnitureCount: finalPlan.furniture.filter((f) => f.source === 'sketch').length, autoFurnitureCount: finalPlan.furniture.filter((f) => f.source === 'auto').length, finalChecks: versions.at(-1), errors, calls };
  fs.writeFileSync(path.join(OUT, EVIDENCE), JSON.stringify(results, null, 2));
  console.log(`Saved real run: screenshots/${EVIDENCE}; ${versions.length} versions; ${errors.length} captured errors.`);
  if (!calls.length || calls.some((call) => call.error) || errors.length || !versions.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  fs.writeFileSync(path.join(OUT, EVIDENCE), JSON.stringify({ date: new Date().toISOString(), wallSeconds: started ? (Date.now() - started) / 1000 : 0, firstWalkableWallSeconds, firstWalkableAppSeconds, health, errors: [...errors, String(error)], incomplete: true, calls }, null, 2));
  await page.screenshot({ path: path.join(OUT, 'model-flow-error.png') });
  process.exitCode = 1;
} finally { await browser.close(); }
