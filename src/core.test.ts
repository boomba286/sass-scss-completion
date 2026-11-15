import { describe, expect, it } from 'vitest';
import { extractSignatures, suggestParams } from './core';

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
});
