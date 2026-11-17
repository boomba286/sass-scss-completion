import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_RULES, parseRuleSettings, resolveRuleState } from './rules';

describe('parseRuleSettings', () => {
  it('reads a known rule with one of the three values', () => {
    const settings = parseRuleSettings({ 'no-undefined-variable': 'off' });

    expect(settings.get('no-undefined-variable')).toBe('off');
  });

  it('keeps every value the setting accepts', () => {
    const settings = parseRuleSettings({
      'missing-required-arguments': 'error',
      'no-undefined-function': 'warn',
    });

    expect(settings.get('missing-required-arguments')).toBe('error');
    expect(settings.get('no-undefined-function')).toBe('warn');
  });

  it('ignores a name no rule has, so a typo leaves the rule at its default', () => {
    const settings = parseRuleSettings({ 'no-undefined-variable ': 'off', nope: 'off' });

    expect(settings.size).toBe(0);
  });

  it('ignores a value outside off, warn, and error', () => {
    expect(parseRuleSettings({ 'no-undefined-variable': 'silent' }).size).toBe(0);
    expect(parseRuleSettings({ 'no-undefined-variable': true }).size).toBe(0);
  });

  it('returns an empty map for a value that is not an object', () => {
    expect(parseRuleSettings(undefined).size).toBe(0);
    expect(parseRuleSettings(null).size).toBe(0);
    expect(parseRuleSettings('warn').size).toBe(0);
  });
});

describe('resolveRuleState', () => {
  const settings = parseRuleSettings({
    'no-undefined-variable': 'off',
    'no-undefined-function': 'warn',
    'no-undefined-custom-property': 'error',
  });

  it('turns the rule off when the setting says off', () => {
    expect(resolveRuleState('no-undefined-variable', settings, 'error')).toBe('off');
  });

  it('reports a warning when the setting says warn, even over an error', () => {
    expect(resolveRuleState('no-undefined-function', settings, 'error')).toBe('warning');
  });

  it('reports an error when the setting says error, even over a warning', () => {
    expect(resolveRuleState('no-undefined-custom-property', settings, 'warning')).toBe('error');
  });

  it('keeps the inherent severity when the setting names the rule nothing', () => {
    expect(resolveRuleState('missing-required-arguments', settings, 'error')).toBe('error');
    expect(resolveRuleState('property-value-no-unknown', settings, 'warning')).toBe('warning');
  });
});

describe('DIAGNOSTIC_RULES', () => {
  it('names exactly the rules the editor reports', () => {
    expect([...DIAGNOSTIC_RULES]).toEqual([
      'missing-required-arguments',
      'no-undefined-function',
      'no-undefined-variable',
      'no-undefined-custom-property',
      'property-value-no-unknown',
    ]);
  });
});
