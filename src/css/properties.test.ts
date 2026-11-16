import { describe, expect, it } from 'vitest';
import { propertyRules } from './properties';
import { findUnknownPropertyValues } from './diagnostics';

describe('propertyRules', () => {
  it('builds a syntax rule for a property whose value is a value definition syntax', () => {
    const rules = propertyRules();

    for (const name of ['color', 'width', 'display', 'text-transform']) {
      expect(rules.get(name)).toMatchObject({ mode: 'syntax' });
    }
  });

  it('builds a keyword rule for a closed enum without a value definition syntax', () => {
    expect(propertyRules().get('mix-blend-mode')).toMatchObject({ mode: 'keywords' });
  });

  it('leaves vendor-prefixed properties out', () => {
    const rules = propertyRules();

    expect(rules.has('-webkit-appearance')).toBe(false);
    expect(rules.has('-moz-column-count')).toBe(false);
  });

  it('returns the same map on every call', () => {
    expect(propertyRules()).toBe(propertyRules());
  });
});

describe('value checking through the rules', () => {
  it('flags a keyword the property does not accept', () => {
    expect(findUnknownPropertyValues(`.a { mix-blend-mode: bogusmode; }`)).toHaveLength(1);
  });

  it('accepts a documented keyword', () => {
    expect(findUnknownPropertyValues(`.a { mix-blend-mode: multiply; }`)).toHaveLength(0);
  });

  it('accepts a value the CSS data documents even when the syntax no longer lists it', () => {
    expect(findUnknownPropertyValues(`.a { user-select: contain; }`)).toHaveLength(0);
  });

  it('does not check a vendor-prefixed property', () => {
    expect(findUnknownPropertyValues(`.a { -webkit-appearance: bogus; }`)).toHaveLength(0);
  });

  it('flags a misspelled colour but accepts a valid one', () => {
    expect(findUnknownPropertyValues(`.a { color: notacolor; }`)).toHaveLength(1);
    expect(findUnknownPropertyValues(`.a { color: red; }`)).toHaveLength(0);
    expect(findUnknownPropertyValues(`.a { color: rgb(0 0 0 / 50%); }`)).toHaveLength(0);
  });

  it('flags a non-length width', () => {
    expect(findUnknownPropertyValues(`.a { width: abc; }`)).toHaveLength(1);
    expect(findUnknownPropertyValues(`.a { width: 10px; }`)).toHaveLength(0);
  });
});
