import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { assumptionsSchema, paramsSchema, planSchema, type Assumption, type ParamDef, type ParamValues, type PlanSpec } from './plan';

export class SourceError extends Error {}

/** The generator is data-in/data-out. Imports and access to ambient globals are not allowed. */
export function validateGeneratorSource(source: string) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  } catch (error) {
    throw new SourceError(`JavaScript syntax: ${(error as Error).message}`);
  }
  const declarations: string[] = [];
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) {
      throw new SourceError(`Only EXPORT const PARAMS, EXPORT const ASSUMPTIONS, and EXPORT function buildPlan are allowed (line ${node.loc?.start.line}).`);
    }
    if (node.declaration.type === 'VariableDeclaration') {
      if (node.declaration.kind !== 'const' || node.declaration.declarations.length !== 1 || node.declaration.declarations[0].id.type !== 'Identifier') {
        throw new SourceError('PARAMS and ASSUMPTIONS must be single const declarations.');
      }
      declarations.push(node.declaration.declarations[0].id.name);
    } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
      declarations.push(node.declaration.id.name);
    }
  }
  if (!['PARAMS', 'ASSUMPTIONS', 'buildPlan'].every((name) => declarations.includes(name)) || declarations.length !== 3) {
    throw new SourceError('Module must export exactly PARAMS, ASSUMPTIONS, and buildPlan.');
  }
  const locals = new Set(['PARAMS', 'ASSUMPTIONS', 'buildPlan', 'Math', 'Number', 'undefined']);
  walk.full(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') locals.add(node.id.name);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      for (const param of node.params) {
        if (param.type !== 'Identifier') throw new SourceError('Use a simple identifier for each function parameter.');
        locals.add(param.name);
      }
    }
    if (node.type === 'MemberExpression' && ((node.property.type === 'Identifier' && !node.computed && ['constructor', 'prototype', '__proto__'].includes(node.property.name)) || (node.property.type === 'Literal' && typeof node.property.value === 'string' && ['constructor', 'prototype', '__proto__'].includes(node.property.value)))) {
      throw new SourceError('Prototype and dynamic-constructor access are not allowed in a generator.');
    }
    if (['ImportExpression', 'AwaitExpression', 'ThisExpression', 'NewExpression', 'AssignmentExpression', 'UpdateExpression', 'DebuggerStatement', 'TryStatement', 'ClassDeclaration'].includes(node.type)) {
      throw new SourceError(`${node.type} is not allowed in a generator.`);
    }
  });
  walk.ancestor(ast, {
    Identifier(node, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return;
      if (parent?.type === 'FunctionDeclaration' && parent.id === node) return;
      if (!locals.has(node.name)) throw new SourceError(`Unknown or unsafe global “${node.name}” at line ${node.loc?.start.line}.`);
    },
  });
  return true;
}

/** This executes only after source validation. The browser version is called inside a disposable Worker. */
export function evaluateGenerator(source: string) {
  validateGeneratorSource(source);
  const executable = source.replace(/\bexport\s+const\s+/g, 'const ').replace(/\bexport\s+function\s+/, 'function ');
  const make = new Function(`"use strict";\n${executable}\nreturn { PARAMS, ASSUMPTIONS, buildPlan };`);
  let generated: { PARAMS: unknown; ASSUMPTIONS: unknown; buildPlan: unknown };
  try { generated = make() as typeof generated; }
  catch (error) { throw new SourceError(`Module initialization failed: ${(error as Error).message}`); }
  if (typeof generated.buildPlan !== 'function') throw new SourceError('buildPlan must be a function.');
  return {
    params: paramsSchema.parse(generated.PARAMS) as Record<string, ParamDef>,
    assumptions: assumptionsSchema.parse(generated.ASSUMPTIONS) as Assumption[],
    buildPlan: generated.buildPlan as (values: ParamValues) => unknown,
  };
}

export function buildFromModule(source: string, values?: ParamValues): { plan: PlanSpec; params: Record<string, ParamDef>; assumptions: Assumption[] } {
  const { params, assumptions, buildPlan } = evaluateGenerator(extractModule(source));
  const input = { ...Object.fromEntries(Object.entries(params).map(([key, p]) => [key, p.value])), ...values };
  const plan = planSchema.parse(buildPlan(input));
  return { plan, params, assumptions };
}

export function extractModule(text: string): string {
  const clean = text.trim();
  const fenced = clean.match(/```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : clean).trim();
  validateGeneratorSource(source);
  return source;
}
