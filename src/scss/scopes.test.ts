import { describe, expect, it } from 'vitest';
import { findUndefinedVariables, visibleVariablesAt } from './scopes';

describe('findUndefinedVariables', () => {
  it('reports a variable that is never declared', () => {
    const source = `.a { width: math.div(12, $ss); }`;
    const start = source.indexOf('$ss');
    const issues = findUndefinedVariables(source);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ start, end: start + '$ss'.length });
    expect(issues[0].message).toContain('$ss');
  });

  it('reports a declaration placed after its use at the root scope', () => {
    const source = `.a { width: $gap; }\n$gap: 8px;`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('reports a local declaration placed after its use inside the same block', () => {
    const source = `.a { width: $gap; $gap: 8px; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('accepts a local declaration that comes before its use', () => {
    const source = `.a { $gap: 8px; width: $gap; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('accepts function and mixin parameters inside their body', () => {
    const source = `@mixin box($width, $height: 10) {\n  width: $width;\n  height: $height;\n}`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('reports a parameter used outside the mixin that declares it', () => {
    const source = `@mixin box($width) {\n  width: $width;\n}\n.a { width: $width; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('accepts a root declaration inside a callable whatever its position', () => {
    const source = `@function gap() {\n  @return $base;\n}\n$base: 8px;`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('accepts @each and @for loop variables inside the loop block', () => {
    const source = `$map: (a: 1);\n@each $name, $value in $map {\n  #{$name}: $value;\n}\n@for $i from 1 through 3 {\n  width: $i;\n}`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('reports a loop variable used outside the loop block', () => {
    const source = `@each $x in 1 2 {\n  .a { width: $x; }\n}\n.b { width: $x; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('reports a loop variable used before the loop', () => {
    const source = `.b { width: $x; }\n@each $x in 1 2 {\n  .a { width: $x; }\n}`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('lets a loop variable shadow an outer name without hiding it after the loop', () => {
    const source = `$x: 1;\n@each $x in 2 3 {\n  .a { width: $x; }\n}\n.b { width: $x; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('assigns to an existing variable of the enclosing block inside a flow rule', () => {
    const source = `$x: 1;\n@each $i in 2 3 {\n  $x: $i;\n}\n.b { width: $x; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('keeps a variable first declared inside a flow rule local to it', () => {
    const source = `@each $i in 1 2 {\n  $x: $i;\n}\n.b { width: $x; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('keeps a variable declared inside an @if local to it', () => {
    const source = `@if true {\n  $y: 1;\n}\n.b { width: $y; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('treats a plain style rule block as a scope without the flow-control rule', () => {
    const source = `$x: 1;\n.a {\n  $x: 2;\n}\n.b { width: $x; }`;

    expect(findUndefinedVariables(source)).toEqual([]);
  });

  it('keeps a variable declared inside @media local to it', () => {
    const source = `@media screen {\n  $y: 1;\n}\n.b { width: $y; }`;

    expect(findUndefinedVariables(source)).toHaveLength(1);
  });

  it('binds a `!global` assignment in the root scope', () => {
    const source = `@each $i in 1 2 {\n  $x: $i !global;\n}\n.b { width: $x; }`;

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

describe('visibleVariablesAt', () => {
  it('offers a root variable declared before the cursor', () => {
    const source = `$gap: 8px;\n.a { width: $ }`;
    const offset = source.indexOf('$ ');

    expect(visibleVariablesAt(source, offset)).toContain('gap');
  });

  it('hides a root variable declared after the cursor', () => {
    const source = `.a { width: $ }\n$gap: 8px;`;
    const offset = source.indexOf('$ ');

    expect(visibleVariablesAt(source, offset)).not.toContain('gap');
  });

  it('offers a loop variable inside the loop block', () => {
    const source = `@each $item in 1 2 {\n  .a { width: $ }\n}`;
    const offset = source.indexOf('$ ');

    expect(visibleVariablesAt(source, offset)).toContain('item');
  });

  it('offers the parameters and a preceding local inside a mixin body', () => {
    const source = `@mixin box($width) {\n  $pad: 4px;\n  width: $ }\n`;
    const offset = source.indexOf('$ ');

    expect(visibleVariablesAt(source, offset)).toEqual(expect.arrayContaining(['width', 'pad']));
  });

  it('merges the extra names supplied by the caller', () => {
    const source = `.a { width: $ }`;
    const offset = source.indexOf('$ ');

    expect(visibleVariablesAt(source, offset, new Set(['gap']))).toContain('gap');
  });
});
