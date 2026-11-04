import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';

const app = new Hono();
const API_KEY = process.env.NEBIUS_API_KEY;
const BASE_URL = (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, '');
const MODEL = process.env.MODEL || 'moonshotai/Kimi-K3.1-Pro';
const generatePrompt = await readFile(new URL('../prompts/generate.md', import.meta.url), 'utf8');
const reviewPrompt = await readFile(new URL('../prompts/review.md', import.meta.url), 'utf8');
const imagePart = (data) => ({ type: 'image_url', image_url: { url: data } });

function checkRequest(image) {
  if (!API_KEY) throw new Error('Set NEBIUS_API_KEY in .env to use Kimi.');
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(image) || image.length > 18_000_000) {
    throw new Error('Upload a PNG, JPEG, or WebP image smaller than 12 MB.');
  }
}

async function completion(messages, kind, maxTokens = 18000) {
  const started = performance.now();
  let prefix = '';
  // A network drop must not discard a long generation. Continue from the exact partial content.
  for (let attempt = 0; attempt < 3; attempt++) {
    const requestMessages = prefix ? [
      ...messages,
      { role: 'assistant', content: prefix },
      { role: 'user', content: 'Continue exactly from the character where your previous response stopped. Do not repeat any earlier text, add prose, or restart the answer.' },
    ] : messages;
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: requestMessages, stream: true, stream_options: { include_usage: true }, reasoning_effort: kind === 'generate' ? 'low' : 'medium', max_tokens: maxTokens, temperature: 0.2 }),
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) throw new Error(`Model API ${response.status}: ${(await response.text()).slice(0, 600)}`);
    if (!response.body) throw new Error('Model returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', finishReason = null, usage = null, completed = false, failure = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { completed = true; continue; }
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            if (choice?.delta?.content) content += choice.delta.content;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (json.usage) usage = json.usage;
          } catch { /* SSE keepalive or non-JSON event. */ }
        }
      }
    } catch (error) { failure = error; }
    prefix += content;
    if (!failure && (completed || response.body.locked === false) && finishReason !== 'length') {
      const elapsed = (performance.now() - started) / 1000;
      const tokens = usage?.completion_tokens ?? 0;
      const tokensPerSecond = elapsed ? Math.round(tokens / elapsed * 10) / 10 : 0;
      console.log(`[${MODEL}] ${kind}: ${tokens} completion tokens, ${tokensPerSecond} tokens/sec, ${elapsed.toFixed(1)}s`);
      return { text: prefix, usage: { prompt: usage?.prompt_tokens ?? 0, completion: tokens, total: usage?.total_tokens ?? 0 }, elapsed: Math.round(elapsed * 100) / 100, tokensPerSecond, model: MODEL };
    }
    if (!prefix) throw new Error(`Model stream failed before returning content: ${failure?.message || 'incomplete response'}`);
    console.warn(`[${MODEL}] ${kind}: interrupted response, continuing ${prefix.length} characters (${attempt + 1}/3).`);
  }
  throw new Error('Model stream was interrupted three times. Please try again.');
}

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});
app.options('*', (c) => c.body(null, 204));
app.get('/api/health', (c) => c.json({ ok: true, configured: Boolean(API_KEY), model: MODEL, baseUrl: BASE_URL }));

app.post('/api/generate', async (c) => {
  try {
    const { image } = await c.req.json(); checkRequest(image);
    const result = await completion([{ role: 'system', content: generatePrompt }, { role: 'user', content: [imagePart(image), { type: 'text', text: 'Read this floor plan and return the complete generator module.' }] }], 'generate');
    return c.json({ ...result, code: result.text });
  } catch (error) { console.error(error); return c.json({ error: error.message }, 500); }
});

app.post('/api/review', async (c) => {
  try {
    const body = await c.req.json(); checkRequest(body.sketch);
    if (typeof body.code !== 'string' || body.code.length > 200000) throw new Error('Missing or oversized generator code.');
    const checks = Array.isArray(body.failures) ? body.failures.slice(0, 40).map((x) => String(x).slice(0, 500)).join('\n') : 'No deterministic failures. The plan passed every check.';
    const content = [
      imagePart(body.sketch),
      { type: 'text', text: `DETERMINISTIC RESULTS:\n${checks}\n\nCURRENT GENERATOR:\n${body.code}\n\n${body.buildError ? `BUILD OR VALIDATION ERROR: ${String(body.buildError).slice(0, 1000)}` : 'The generator executed and validated. The following image is the top-down orthographic capture from the app canvas.'}` },
    ];
    if (typeof body.render === 'string' && body.render.startsWith('data:image/png')) content.push(imagePart(body.render));
    const result = await completion([{ role: 'system', content: reviewPrompt }, { role: 'user', content }], 'review', 24000);
    let review;
    try {
      const clean = result.text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/```$/, '');
      review = JSON.parse(clean);
    } catch { return c.json({ error: 'The model returned malformed review JSON. Please try again.' }, 502); }
    if (!['PASS', 'REVISE'].includes(review.verdict)) return c.json({ error: 'Review verdict must be PASS or REVISE.' }, 502);
    return c.json({ ...result, verdict: review.verdict, issues: Array.isArray(review.issues) ? review.issues.map(String) : [], improvements: Array.isArray(review.improvements) ? review.improvements.map(String) : [], code: review.code || '' });
  } catch (error) { console.error(error); return c.json({ error: error.message }, 500); }
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => console.log(`Sketch API listening on http://localhost:${info.port} using ${MODEL}`));
