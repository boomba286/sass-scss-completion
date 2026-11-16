import { describe, expect, it } from 'vitest';
import { parseSyntax } from './parser';

describe('parseSyntax', () => {
  it('parses a keyword', () => {
    expect(parseSyntax('auto')).toEqual({ kind: 'keyword', value: 'auto', function: false });
  });

  it('parses an alternation of keywords', () => {
    expect(parseSyntax('none | auto')).toEqual({
      kind: 'alternation',
      options: [
        { kind: 'keyword', value: 'none', function: false },
        { kind: 'keyword', value: 'auto', function: false },
      ],
    });
  });

  it('parses juxtaposition as a sequence', () => {
    expect(parseSyntax('a b')).toMatchObject({
      kind: 'sequence',
      operands: [{ value: 'a' }, { value: 'b' }],
    });
  });

  it('binds || and && tighter than |', () => {
    expect(parseSyntax('a | b || c')).toMatchObject({
      kind: 'alternation',
      options: [{ value: 'a' }, { kind: 'any-order' }],
    });
    expect(parseSyntax('a && b').kind).toBe('all');
  });

  it('parses a type reference with a range', () => {
    expect(parseSyntax('<length [0,\u221e]>')).toMatchObject({
      kind: 'type',
      name: 'length',
      range: { min: 0, max: Infinity },
    });
  });

  it('parses a function-only type reference', () => {
    expect(parseSyntax('<calc-size()>')).toMatchObject({
      kind: 'type',
      name: 'calc-size',
      function: true,
    });
  });

  it('parses a function keyword with its argument', () => {
    expect(parseSyntax('format( <string> )')).toMatchObject({
      kind: 'keyword',
      value: 'format',
      function: true,
      argument: { kind: 'type', name: 'string' },
    });
  });

  it('parses a property reference', () => {
    expect(parseSyntax("<'color'>")).toEqual({ kind: 'property-ref', name: 'color' });
  });

  it('parses multipliers', () => {
    expect(parseSyntax('auto?')).toMatchObject({ kind: 'repeat', min: 0, max: 1 });
    expect(parseSyntax('auto+')).toMatchObject({ kind: 'repeat', min: 1, max: null });
    expect(parseSyntax('<length>#')).toMatchObject({ kind: 'repeat', min: 1, separator: ',' });
    expect(parseSyntax('<length>{2,4}')).toMatchObject({ kind: 'repeat', min: 2, max: 4 });
  });

  it('parses a group as one component', () => {
    expect(parseSyntax('[ a | b ]')).toMatchObject({
      kind: 'group',
      child: { kind: 'alternation' },
    });
  });

  it('degrades unknown characters into a looser tree instead of throwing', () => {
    expect(() => parseSyntax('<length> @@ <color>')).not.toThrow();
  });
});
