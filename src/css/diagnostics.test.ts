import { describe, expect, it } from 'vitest';
import { declarationValueRanges, findUnknownPropertyValues } from './diagnostics';

describe('findUnknownPropertyValues', () => {
  it('reports a value that is not a keyword the property accepts', () => {
    const source = `.a { text-transform: uppercases; }`;
    const start = source.indexOf('uppercases');
    const issues = findUnknownPropertyValues(source);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      start,
      end: start + 'uppercases'.length,
      message: `Unknown value 'uppercases' for property 'text-transform'.`,
    });
  });

  it('reports a typo in a keyword of any property', () => {
    const source = `.a { display: flexx; }`;
    const start = source.indexOf('flexx');

    expect(findUnknownPropertyValues(source)).toMatchObject([
      { start, end: start + 'flexx'.length },
    ]);
  });

  it('accepts a known keyword and a CSS-wide keyword', () => {
    expect(findUnknownPropertyValues(`.a { text-transform: uppercase; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { text-transform: inherit; }`)).toHaveLength(0);
  });

  it('accepts a call to a function the project defines', () => {
    expect(
      findUnknownPropertyValues(`.a { text-transform: casing(); }`, new Set(['casing'])),
    ).toHaveLength(0);
  });

  it('accepts a call to a Sass global function the caller knows', () => {
    expect(
      findUnknownPropertyValues(`.a { color: darken(#fff, 10%); }`, new Set(['darken'])),
    ).toHaveLength(0);
  });

  it('reports a call to a function nothing defines', () => {
    const source = `.a { text-transform: casinsss(); }`;
    const start = source.indexOf('casinsss');

    expect(findUnknownPropertyValues(source)).toMatchObject([
      { start, end: start + 'casinsss()'.length },
    ]);
  });

  it('skips interpolation, variables, quoted strings, and numbers', () => {
    expect(findUnknownPropertyValues(`.a { text-transform: #{$value}; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { display: $mode; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { text-transform: "uppercase"; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { z-index: 3abc; }`)).toHaveLength(0);
  });

  it('skips lists and properties that accept arbitrary identifiers', () => {
    expect(findUnknownPropertyValues(`.a { overflow: hidden scroll; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { font-family: NotAFont; }`)).toHaveLength(0);
  });

  it('skips a vendor-prefixed identifier', () => {
    expect(findUnknownPropertyValues(`.a { text-transform: -foo; }`)).toHaveLength(0);
  });

  it('ignores a trailing !important when checking the value', () => {
    const source = `.a { text-transform: uppercases !important; }`;
    const start = source.indexOf('uppercases');

    expect(findUnknownPropertyValues(source)).toMatchObject([
      { start, end: start + 'uppercases'.length },
    ]);
  });

  it('reports an empty document without issues', () => {
    expect(findUnknownPropertyValues('')).toHaveLength(0);
  });
});

describe('declarationValueRanges', () => {
  it('returns the range of a declaration value', () => {
    const source = `.a { color: red; }`;
    const start = source.indexOf('red');

    expect(declarationValueRanges(source)).toEqual([{ start, end: start + 'red'.length }]);
  });

  it('drops a trailing !important and the surrounding whitespace', () => {
    const source = `.a {\n  color: red !important;\n}`;
    const start = source.indexOf('red');

    expect(declarationValueRanges(source)).toEqual([{ start, end: start + 'red'.length }]);
  });

  it('returns nothing for a document without declarations', () => {
    expect(declarationValueRanges('')).toEqual([]);
  });
});
