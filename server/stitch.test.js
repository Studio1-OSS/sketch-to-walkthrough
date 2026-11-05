import { describe, expect, it } from 'vitest';
import { completeLines, joinContinuation, lastNonEmptyLine, moduleParses } from './stitch.js';

const full = '```javascript\nexport const PARAMS = { a: { value: 1, min: 0, max: 2 } };\nexport const ASSUMPTIONS = [];\nexport function buildPlan(P) {\n  const w = P.a * 1000;\n  return { w };\n}\n```';
const cutAt = full.indexOf('P.a * 1000') + 3; // mid-line, like a dropped stream
const prefix = full.slice(0, cutAt);
const head = completeLines(prefix);

describe('stream continuation stitching', () => {
  it('drops the partial line and remembers the last complete one', () => {
    expect(head.endsWith('buildPlan(P) {\n')).toBe(true);
    expect(lastNonEmptyLine(head)).toBe('export function buildPlan(P) {');
  });

  it('reproduces the original bug: naive join with a reopened fence does not parse', () => {
    expect(moduleParses(prefix + '```javascript\n  const w = P.a * 1000;\n  return { w };\n}\n```')).toBe(false);
  });

  it('joins a clean continuation', () => {
    const out = joinContinuation(head, '  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
    expect(moduleParses(out)).toBe(true);
  });

  it('strips a reopened tagged fence and leading prose', () => {
    const out = joinContinuation(head, 'Here is the rest:\n```js\n  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
  });

  it('strips a reopened bare fence when another fence follows', () => {
    expect(joinContinuation(head, '```\n  const w = P.a * 1000;\n  return { w };\n}\n```')).toBe(full);
  });

  it('removes lines the model repeated from before the cut', () => {
    const out = joinContinuation(head, 'export const ASSUMPTIONS = [];\nexport function buildPlan(P) {\n  const w = P.a * 1000;\n  return { w };\n}\n```');
    expect(out).toBe(full);
  });

  it('keeps a legitimate closing fence at the start of the continuation', () => {
    const h = completeLines(full.replace(/```$/, '').trimEnd() + '\n');
    expect(joinContinuation(h, '```')).toBe(full.replace(/```$/, '').trimEnd() + '\n```');
  });

  it('parses unfenced modules too', () => {
    expect(moduleParses('export const PARAMS = {};')).toBe(true);
    expect(moduleParses('export const PARAMS = {')).toBe(false);
  });
});
