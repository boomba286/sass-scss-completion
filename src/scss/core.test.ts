import { describe, expect, it } from 'vitest';
import {
  extractSignatures,
  extractVariables,
  findModuleMemberContext,
  findModuleMemberToken,
  findNamespaceContext,
  suggestParams,
} from './core';

describe('extractSignatures', () => {
  it('extracts parameter names from Sass function and mixin signatures', () => {
    const source = `
      @function rem($value, $base: 16) {
        @return $value;
      }

      @mixin box($width, $height: 10) {
        width: $width;
      }
    `;

    expect(
      extractSignatures(source).map(({ kind, name, params }) => ({ kind, name, params })),
    ).toEqual([
      { kind: 'function', name: 'rem', params: ['value', 'base'] },
      { kind: 'mixin', name: 'box', params: ['width', 'height'] },
    ]);
  });

  it('treats parameters without a default value as required', () => {
    const source = `@function rem($value, $base: 16) { @return $value; }`;

    expect(extractSignatures(source).map(({ required }) => required)).toEqual([['value']]);
  });

  it('treats variadic and defaulted parameters as optional', () => {
    const source = `
      @mixin box($width, $height: 10, $shadows...) {}
      @mixin pad($gap: 0) {}
    `;

    expect(extractSignatures(source).map(({ params, required }) => ({ params, required }))).toEqual([
      { params: ['width', 'height', 'shadows'], required: ['width'] },
      { params: ['gap'], required: [] },
    ]);
  });

  it('keeps a default value containing commas or parentheses out of the required list', () => {
    const source = `@function size($list: (1, 2), $factor: math.div(16, 2)) {}`;

    expect(extractSignatures(source).map(({ params, required }) => ({ params, required }))).toEqual([
      { params: ['list', 'factor'], required: [] },
    ]);
  });
});

describe('suggestParams', () => {
  it('suggests only unfilled parameters after a positional argument', () => {
    const source = 'rem(12, $';

    expect(suggestParams(source, source.length, ['value', 'base'])).toEqual(['base']);
  });

  it('does not suggest a named parameter more than once', () => {
    const source = 'rem(12, $base: 10, $';

    expect(suggestParams(source, source.length, ['value', 'base'])).toEqual([]);
  });

  it('suggests the parameter while its name is being typed', () => {
    const source = 'rem(12, $bas';

    expect(suggestParams(source, source.length, ['value', 'base'])).toEqual(['base']);
  });

  it('does not treat a positional value variable as a used named parameter', () => {
    const source = 'f($c, $';

    expect(suggestParams(source, source.length, ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});

describe('findModuleMemberContext', () => {
  it('detects a member access and captures the typed prefix', () => {
    const source = '.a { width: color.ad';

    expect(findModuleMemberContext(source, source.length)).toEqual({
      namespace: 'color',
      prefix: 'ad',
      variable: false,
    });
  });

  it('detects a variable member access', () => {
    const source = '.a { width: math.$p';

    expect(findModuleMemberContext(source, source.length)).toEqual({
      namespace: 'math',
      prefix: '$p',
      variable: true,
    });
  });

  it('returns an empty prefix right after the dot', () => {
    const source = 'math.';

    expect(findModuleMemberContext(source, source.length)).toEqual({
      namespace: 'math',
      prefix: '',
      variable: false,
    });
  });

  it('returns null when there is no member access at the cursor', () => {
    const source = '.a { width: 10px';

    expect(findModuleMemberContext(source, source.length)).toBeNull();
  });

  it('does not treat a decimal number as a member access', () => {
    const source = 'width: 1.5';

    expect(findModuleMemberContext(source, source.length)).toBeNull();
  });
});

describe('findModuleMemberToken', () => {
  it('finds a function call token under the offset', () => {
    const source = '.a { width: math.div(12, $ss); }';
    const offset = source.indexOf('div');

    expect(findModuleMemberToken(source, offset)).toMatchObject({
      namespace: 'math',
      name: 'div',
      variable: false,
      start: source.indexOf('math'),
      end: source.indexOf('math') + 'math.div'.length,
    });
  });

  it('finds a variable member token under the offset', () => {
    const source = '.a { width: math.$pi; }';

    expect(findModuleMemberToken(source, source.indexOf('$pi') + 1)).toMatchObject({
      namespace: 'math',
      name: 'pi',
      variable: true,
    });
  });

  it('returns null when the offset is not on a member token', () => {
    const source = '.a { width: 10px; }';

    expect(findModuleMemberToken(source, source.indexOf('10px'))).toBeNull();
  });
});

describe('findNamespaceContext', () => {
  it('captures the namespace prefix being typed', () => {
    const source = '.a { background: col';

    expect(findNamespaceContext(source, source.length)).toEqual({ prefix: 'col', start: 17 });
  });

  it('returns null right after a member dot', () => {
    const source = '.a { background: color.';

    expect(findNamespaceContext(source, source.length)).toBeNull();
  });

  it('returns null right after a variable sigil', () => {
    const source = '$';

    expect(findNamespaceContext(source, source.length)).toBeNull();
  });

  it('returns null when the cursor is not on an identifier', () => {
    const source = '.a { background: ';

    expect(findNamespaceContext(source, source.length)).toBeNull();
  });
});

describe('extractVariables', () => {
  it('collects top-level and block variable declarations', () => {
    const source = `$base: 16;\n.a {\n  $local: 1;\n  width: $base;\n}`;

    expect(extractVariables(source)).toEqual(['base', 'local']);
  });
});
