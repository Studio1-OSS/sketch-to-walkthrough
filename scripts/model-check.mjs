import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180';
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const calls = [], errors = [];
let reviewNumber = 0;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', async (response) => {
  if (!/\/api\/(generate|review)$/.test(new URL(response.url()).pathname)) return;
  try {
    const body = await response.json(); const request = response.request().postDataJSON();
    body.completion = body.usage?.completion ?? body.completion;
    calls.push({ path: new URL(response.url()).pathname, status: response.status(), ...body });
    if (request.sketch) {
      const base = (image) => Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
      fs.writeFileSync(path.join(OUT, 'live-original-sketch.png'), base(request.sketch));
      if (request.render) fs.writeFileSync(path.join(OUT, `live-v${++reviewNumber}-review-render.png`), base(request.render));
    }
    console.log(`REAL API ${response.status()}: ${body.kind || response.url()} · ${body.completion} completion tokens · ${body.tokensPerSecond} tok/s · ${body.elapsed}s`);
    if (body.verdict) console.log(`  ${body.verdict}`, JSON.stringify(body.issues), 'improvements:', JSON.stringify(body.improvements));
    if (body.error) console.error('  API error:', body.error);
  } catch (error) { errors.push(String(error)); }
});
const started = Date.now();
try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.hero-model .viewer-host[data-ready="true"]', { timeout: 45000 });
  await page.getByRole('button', { name: 'Generate walkthrough from The two-bedroom', exact: true }).click();
  await page.waitForSelector('.generation-overlay', { state: 'visible', timeout: 20000 });
  console.log('Real generation request started; waiting for complete client loop.');
  await page.waitForSelector('.generation-overlay', { state: 'hidden', timeout: 1200000 });
  await page.waitForTimeout(1800);
  const wallSeconds = (Date.now() - started) / 1000;
  console.log(`LIVE LOOP FINISHED in ${wallSeconds.toFixed(1)}s. ${calls.length} real model requests.`);
  const versions = [];
  const buttons = await page.locator('.version-button').count();
  for (let i = 0; i < buttons; i++) {
    const v = i + 1;
    await page.locator('.version-button').nth(i).click();
    await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `live-v${v}-plan.png`) });
    await page.getByRole('tab', { name: /Checks/ }).click();
    const checks = await page.locator('.checks-panel').innerText();
    const verdict = await page.locator('.version-button').nth(i).innerText();
    versions.push({ version: v, button: verdict, engineeringState: await page.locator('.canvas-wrap .viewer-host').getAttribute('data-checks'), checks });
    await page.screenshot({ path: path.join(OUT, `live-v${v}-checks.png`) });
  }
  await page.locator('.version-button').last().click();
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'live-final-dollhouse.png') });
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click(); await page.waitForTimeout(400);
  const entry = page.getByRole('button', { name: 'Enter your walkthrough' });
  if (await entry.isVisible()) await entry.click();
  await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, 'live-final-walkthrough.png') });
  await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, 'live-final-walkthrough.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.locator('.debug-button').click(); await page.waitForTimeout(200); await page.screenshot({ path: path.join(OUT, 'live-debug.png') });
  const results = { date: new Date().toISOString(), model: calls[0]?.model, realModelCalls: calls.length, wallSeconds, versions, errors, calls };
  fs.writeFileSync(path.join(OUT, 'model-verification.json'), JSON.stringify(results, null, 2));
  console.log(`Saved real run: screenshots/model-verification.json; ${versions.length} versions; ${errors.length} captured errors.`);
  if (!calls.length || errors.length || !versions.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  fs.writeFileSync(path.join(OUT, 'model-verification.json'), JSON.stringify({ date: new Date().toISOString(), wallSeconds: (Date.now() - started) / 1000, errors: [...errors, String(error)], incomplete: true, calls }, null, 2));
  await page.screenshot({ path: path.join(OUT, 'model-flow-error.png') });
  process.exitCode = 1;
} finally { await browser.close(); }
