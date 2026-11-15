import { describe, expect, it } from 'vitest';
import {
  analyzeArgs,
  findMissingRequiredArgs,
  findUndefinedVariables,
  maskNonCode,
} from './diagnostics';

describe('maskNonCode', () => {
  it('preserves length so offsets stay valid', () => {
    const source = `.a { content: "x"; } // math.div(1)\n`;

    expect(maskNonCode(source)).toHaveLength(source.length);
  });

  it('blanks out the contents of strings, line comments, and block comments', () => {
    const source = `"math.div(1)" /* color.mix(1) */ // map.get(1)`;

    expect(maskNonCode(source)).not.toContain('math.div');
    expect(maskNonCode(source)).not.toContain('color.mix');
    expect(maskNonCode(source)).not.toContain('map.get');
  });

  it('keeps real code intact', () => {
    const source = `math.div(1, 2)`;

    expect(maskNonCode(source)).toBe(source);
  });
});

describe('analyzeArgs', () => {
  it('counts positional arguments and collects keyword names', () => {
    expect(analyzeArgs('1, 2, $base: 2')).toEqual({
      positional: 2,
      keywords: new Set(['base']),
    });
  });

  it('ignores empty segments', () => {
    expect(analyzeArgs('  ')).toEqual({ positional: 0, keywords: new Set() });
  });

  it('does not treat a nested map as a keyword argument', () => {
    expect(analyzeArgs('(a: 1, b: 2)')).toEqual({ positional: 1, keywords: new Set() });
  });
});

describe('findMissingRequiredArgs', () => {
  it('reports a missing required argument and its range', () => {
    const source = `@use 'sass:math';\n.a { width: math.div(1); }`;
    const start = source.indexOf('math.div');
    const issues = findMissingRequiredArgs(source);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      start,
      end: start + 'math.div(1)'.length,
    });
    expect(issues[0].message).toContain('$number2');
  });

  it('reports nothing when every required argument is supplied', () => {
    const source = `@use 'sass:math';\n.a { width: math.div(1, 2); }`;

    expect(findMissingRequiredArgs(source)).toEqual([]);
  });

  it('accepts required arguments passed by keyword', () => {
    const source = `@use 'sass:math';\n.a { width: math.div($number1: 1, $number2: 2); }`;

    expect(findMissingRequiredArgs(source)).toEqual([]);
  });

  it('honors an explicit `as` alias', () => {
    const source = `@use 'sass:math' as m;\n.a { width: m.div(1); }`;

    expect(findMissingRequiredArgs(source)).toHaveLength(1);
    expect(findMissingRequiredArgs(source)[0].message).toContain('m.div');
  });

  it('ignores namespaces that were not loaded from a sass built-in module', () => {
    const source = `.a { width: math.div(1); }`;

    expect(findMissingRequiredArgs(source)).toEqual([]);
  });

  it('ignores calls inside strings and comments', () => {
    const source = `@use 'sass:math';\n// math.div(1)\n.a { content: "math.div(1)"; }`;

    expect(findMissingRequiredArgs(source)).toEqual([]);
  });

  it('skips a call whose parentheses are not closed yet', () => {
    const source = `@use 'sass:math';\n.a { width: math.div(`;

    expect(findMissingRequiredArgs(source)).toEqual([]);
  });

  it('does not flag optional or rest parameters', () => {
    const optional = `@use 'sass:color';\n.a { color: color.adjust(#fff); }`;
    const rest = `@use 'sass:math';\n.a { width: math.min(1px, 2px); }`;

    expect(findMissingRequiredArgs(optional)).toEqual([]);
    expect(findMissingRequiredArgs(rest)).toEqual([]);
  });
});

describe('findUndefinedVariables', () => {
  it('reports a variable that is never declared', () => {
    const source = `.a { width: math.div(12, $ss); }`;
    const start = source.indexOf('$ss');
    const issues = findUndefinedVariables(source);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ start, end: start + '$ss'.length });
    expect(issues[0].message).toContain('$ss');
  });

  it('accepts a local declaration that appears later in the file', () => {
    const source = `.a { width: $gap; }\n$gap: 8px;`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('accepts function and mixin parameters as definitions', () => {
    const source = `@mixin box($width, $height: 10) {\n  width: $width;\n  height: $height;\n}`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('accepts @each and @for loop variables', () => {
    const source = `$map: (a: 1);\n@each $name, $value in $map {\n  #{$name}: $value;\n}\n@for $i from 1 through 3 {\n  width: $i;\n}`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('does not treat a namespace member variable as undefined', () => {
    const source = `@use 'sass:math';\n.a { width: math.$pi; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('does not treat a keyword argument as an undefined variable', () => {
    const source = `.a { width: rem(12, $base: 10); }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('ignores variables inside strings and comments', () => {
    const source = `// $ghost\n.a { content: "$ghost"; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('does not flag a bare `$` being typed', () => {
    const source = `.a { width: rem(12, $); }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('accepts names supplied through a global `@use ... as *`', () => {
    const source = `@use 'tokens' as *;\n.a { width: $gap; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
    expect(findUndefinedVariables(source, new Set(['gap']))).toEqual([]);
  });
});
