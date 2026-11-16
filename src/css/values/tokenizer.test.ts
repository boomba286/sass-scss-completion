import { describe, expect, it } from 'vitest';
import { tokenizeValue, type ValueToken } from './tokenizer';

/** Tokenizes and returns only the tokens, asserting the value is not dynamic. */
function staticTokens(text: string): ValueToken[] {
  const { tokens, dynamic } = tokenizeValue(text);

  expect(dynamic).toBe(false);
  return tokens;
}

describe('tokenizeValue', () => {
  it('reads a bare identifier as an ident token', () => {
    expect(staticTokens('auto')).toMatchObject([
      { kind: 'ident', name: 'auto', start: 0, end: 4 },
    ]);
  });

  it('lower-cases identifier and unit names', () => {
    expect(staticTokens('AUTO')[0]).toMatchObject({ kind: 'ident', name: 'auto' });
    expect(staticTokens('10PX')[0]).toMatchObject({ kind: 'dimension', unit: 'px', value: 10 });
  });

  it('tells numbers, dimensions, and percentages apart', () => {
    expect(staticTokens('0')[0]).toMatchObject({ kind: 'number', value: 0 });
    expect(staticTokens('1.5rem')[0]).toMatchObject({ kind: 'dimension', value: 1.5, unit: 'rem' });
    expect(staticTokens('50%')[0]).toMatchObject({ kind: 'percentage', value: 50, unit: '%' });
    expect(staticTokens('-5px')[0]).toMatchObject({ kind: 'dimension', value: -5, unit: 'px' });
  });

  it('reads a hex colour as a hash token', () => {
    expect(staticTokens('#fff')).toMatchObject([{ kind: 'hash', text: '#fff' }]);
  });

  it('reads a quoted string as one token', () => {
    expect(staticTokens('"a b"')).toMatchObject([{ kind: 'string', text: '"a b"' }]);
  });

  it('reads a function call as one token without judging its arguments', () => {
    expect(staticTokens('rgb(0 0 0 / 50%)')).toMatchObject([
      { kind: 'function', name: 'rgb' },
    ]);
  });

  it('keeps commas and slashes as structural operators', () => {
    expect(staticTokens('a, b')).toMatchObject([
      { kind: 'ident', name: 'a' },
      { kind: 'operator', text: ',' },
      { kind: 'ident', name: 'b' },
    ]);
    expect(staticTokens('a / b')).toMatchObject([
      { kind: 'ident' },
      { kind: 'operator', text: '/' },
      { kind: 'ident' },
    ]);
  });

  it('marks a Sass variable and interpolation as dynamic', () => {
    expect(tokenizeValue('$brand')).toMatchObject({
      tokens: [{ kind: 'variable', text: '$brand' }],
      dynamic: true,
    });
    expect(tokenizeValue('#{$width}')).toMatchObject({
      tokens: [{ kind: 'variable' }],
      dynamic: true,
    });
  });

  it('marks a function Sass resolves as dynamic', () => {
    expect(tokenizeValue('var(--x)').dynamic).toBe(true);
    expect(tokenizeValue('calc(100% - 2px)').dynamic).toBe(true);
  });

  it('marks a namespaced member access as dynamic', () => {
    expect(tokenizeValue('math.div(6, 2)')).toMatchObject({
      tokens: [{ kind: 'function', name: 'math.div' }],
      dynamic: true,
    });
    expect(tokenizeValue('math.$pi')).toMatchObject({ dynamic: true });
  });

  it('marks Sass maths as dynamic but leaves structural operators alone', () => {
    expect(tokenizeValue('1 + 2').dynamic).toBe(true);
    expect(tokenizeValue('1px, 2px').dynamic).toBe(false);
  });
});
