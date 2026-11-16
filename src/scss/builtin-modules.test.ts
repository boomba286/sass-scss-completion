import { describe, expect, it } from 'vitest';
import { findEnclosingCall, suggestParams } from './core';
import {
  BUILTIN_FUNCTIONS,
  BUILTIN_MODULE_DESCRIPTIONS,
  BUILTIN_MODULE_IDS,
  BUILTIN_VARIABLES,
  findBuiltinFunction,
  formatSignature,
  listBuiltinMembers,
  missingRequiredParams,
  optionalParams,
  parseSassModuleNamespaces,
  requiredParams,
} from './builtin-modules';

describe('parseSassModuleNamespaces', () => {
  it('maps the default namespace for @use "sass:math"', () => {
    const source = `@use 'sass:math';\n.a { width: math.div(1, 2); }`;

    expect(parseSassModuleNamespaces(source).get('math')).toBe('math');
  });

  it('honors an explicit `as` alias', () => {
    const source = `@use "sass:color" as c;`;

    expect(parseSassModuleNamespaces(source).get('c')).toBe('color');
  });

  it('ignores the `as *` global load', () => {
    const source = `@use "sass:math" as *;`;

    expect(parseSassModuleNamespaces(source).has('math')).toBe(false);
  });
});

describe('findBuiltinFunction', () => {
  it('exposes math.div parameters with per-parameter docs', () => {
    const fn = findBuiltinFunction('math', 'div');

    expect(fn?.params).toEqual(['number1', 'number2']);
    expect(fn?.paramDocs?.number1).toBeTruthy();
    expect(fn?.paramDocs?.number2).toBeTruthy();
  });

  it('returns null for an unknown function', () => {
    expect(findBuiltinFunction('math', 'nope')).toBeNull();
  });

  it('ships a one-line description for every built-in module', () => {
    for (const id of BUILTIN_MODULE_IDS) {
      expect(BUILTIN_MODULE_DESCRIPTIONS[id], `sass:${id} description`).toBeTruthy();
    }
  });

  it('flags rest (variadic) parameters', () => {
    expect(findBuiltinFunction('math', 'min')?.rest).toEqual(['number']);
    expect(findBuiltinFunction('map', 'get')?.rest).toEqual(['keys']);
    expect(findBuiltinFunction('math', 'div')?.rest).toBeUndefined();
  });

  it('ships a description, doc URL, example, and param doc for every non-rest parameter', () => {
    for (const fn of BUILTIN_FUNCTIONS) {
      expect(fn.description, `${fn.module}.${fn.name} description`).toBeTruthy();
      expect(fn.url, `${fn.module}.${fn.name} url`).toMatch(/^https:\/\/sass-lang\.com\//);
      expect(fn.example, `${fn.module}.${fn.name} example`).toBeTruthy();

      const rest = new Set(fn.rest ?? []);

      for (const param of fn.params) {
        if (rest.has(param)) continue;
        expect(fn.paramDocs[param], `${fn.module}.${fn.name} → $${param}`).toBeTruthy();
      }
    }
  });
});

describe('requiredParams / optionalParams', () => {
  it('treats parameters without a default as required', () => {
    const fn = findBuiltinFunction('math', 'div');

    expect(requiredParams(fn!)).toEqual(['number1', 'number2']);
    expect(optionalParams(fn!)).toEqual([]);
  });

  it('treats parameters with a default as optional and excludes them from required', () => {
    const fn = findBuiltinFunction('math', 'log');

    expect(requiredParams(fn!)).toEqual(['number']);
    expect(optionalParams(fn!)).toEqual(['base']);
  });

  it('excludes rest parameters from both lists', () => {
    const fn = findBuiltinFunction('map', 'get');

    expect(requiredParams(fn!)).toEqual(['map', 'key']);
    expect(optionalParams(fn!)).toEqual([]);
  });
});

describe('formatSignature', () => {
  it('renders required bare, optional with a default, and rest with ellipsis', () => {
    expect(formatSignature(findBuiltinFunction('math', 'log')!)).toBe('$number, $base: null');
    expect(formatSignature(findBuiltinFunction('math', 'min')!)).toBe('$number...');
    expect(formatSignature(findBuiltinFunction('list', 'append')!)).toBe(
      '$list, $val, $separator: auto',
    );
  });
});

describe('missingRequiredParams', () => {
  const div = findBuiltinFunction('math', 'div')!;

  it('reports leading required parameters when nothing is provided', () => {
    expect(missingRequiredParams(div, 0, new Set())).toEqual(['number1', 'number2']);
  });

  it('fills positional arguments from the front', () => {
    expect(missingRequiredParams(div, 1, new Set())).toEqual(['number2']);
    expect(missingRequiredParams(div, 2, new Set())).toEqual([]);
  });

  it('accepts keyword arguments by name', () => {
    expect(missingRequiredParams(div, 1, new Set(['number2']))).toEqual([]);
  });

  it('never requires optional or rest parameters', () => {
    const log = findBuiltinFunction('math', 'log')!;
    const get = findBuiltinFunction('map', 'get')!;

    expect(missingRequiredParams(log, 1, new Set())).toEqual([]);
    expect(missingRequiredParams(get, 2, new Set())).toEqual([]);
  });
});

describe('listBuiltinMembers', () => {
  it('returns every member of the given module only', () => {
    const members = listBuiltinMembers('math');

    expect(members.length).toBeGreaterThan(0);
    expect(members.every((entry) => entry.module === 'math')).toBe(true);
    expect(members.map((entry) => entry.name)).toContain('div');
  });

  it('returns an empty list for a module without data', () => {
    expect(listBuiltinMembers('nope')).toEqual([]);
  });
});

describe('BUILTIN_VARIABLES', () => {
  it('exposes the math module variables such as pi', () => {
    expect(BUILTIN_VARIABLES.math.map((variable) => variable.name)).toContain('pi');
  });
});

describe('built-in call resolution (integration)', () => {
  it('resolves math.div through @use and suggests the remaining parameter', () => {
    const source = `@use 'sass:math';\n.a { width: math.div(1, $); }`;
    const offset = source.indexOf('$') + 1;

    const call = findEnclosingCall(source, offset);
    expect(call).toMatchObject({ namespace: 'math', name: 'div' });

    const moduleId = parseSassModuleNamespaces(source).get(call?.namespace ?? '');
    const fn = findBuiltinFunction(moduleId ?? '', call?.name ?? '');

    expect(fn).not.toBeNull();
    expect(suggestParams(source, offset, fn?.params ?? [])).toEqual(['number2']);
  });
});
