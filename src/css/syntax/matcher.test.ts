import { describe, expect, it } from 'vitest';
import { parseSyntax } from './parser';
import { matchesValue } from './matcher';
import { tokenizeValue } from '../values/tokenizer';

/** True when `value` is accepted by the value definition syntax `syntax`. */
function accepts(syntax: string, value: string): boolean {
  return matchesValue(parseSyntax(syntax), tokenizeValue(value).tokens);
}

describe('matchesValue', () => {
  it('matches a keyword against an alternation', () => {
    expect(accepts('none | auto', 'auto')).toBe(true);
    expect(accepts('none | auto', 'flexx')).toBe(false);
  });

  it('matches primitive types', () => {
    expect(accepts('<length>', '10px')).toBe(true);
    expect(accepts('<length>', 'abc')).toBe(false);
    expect(accepts('<length-percentage>', '50%')).toBe(true);
    expect(accepts('<length-percentage>', '10px')).toBe(true);
    expect(accepts('<number>', '0')).toBe(true);
    expect(accepts('<integer>', '1.5')).toBe(false);
  });

  it('matches colours by name, hex, and function', () => {
    expect(accepts('<color>', 'red')).toBe(true);
    expect(accepts('<color>', '#fff')).toBe(true);
    expect(accepts('<color>', 'rgb(0 0 0 / 50%)')).toBe(true);
    expect(accepts('<color>', 'notacolor')).toBe(false);
  });

  it('accepts a CSS-wide keyword whatever the syntax says', () => {
    expect(accepts('none | auto', 'inherit')).toBe(true);
    expect(accepts('<length>', 'unset')).toBe(true);
  });

  it('matches a sequence in order', () => {
    expect(accepts('a b', 'a b')).toBe(true);
    expect(accepts('a b', 'b a')).toBe(false);
  });

  it('requires every operand of && and allows any order', () => {
    expect(accepts('a && b', 'a b')).toBe(true);
    expect(accepts('a && b', 'b a')).toBe(true);
    expect(accepts('a && b', 'a')).toBe(false);
  });

  it('requires at least one operand of || and allows any order', () => {
    expect(accepts('a || b', 'a')).toBe(true);
    expect(accepts('a || b', 'b a')).toBe(true);
    expect(accepts('a || b', 'c')).toBe(false);
  });

  it('honours the ? multiplier', () => {
    expect(accepts('a b?', 'a')).toBe(true);
    expect(accepts('a b?', 'a b')).toBe(true);
  });

  it('honours the {n,m} multiplier', () => {
    expect(accepts('<length>{1,2}', '1px')).toBe(true);
    expect(accepts('<length>{1,2}', '1px 2px')).toBe(true);
    expect(accepts('<length>{1,2}', '1px 2px 3px')).toBe(false);
  });

  it('requires commas for the # multiplier', () => {
    expect(accepts('<length>#', '1px, 2px')).toBe(true);
    expect(accepts('<length>#', '1px 2px')).toBe(false);
  });

  it('accepts a function keyword call by name', () => {
    expect(accepts('format( <string> )', 'format("woff")')).toBe(true);
    expect(accepts('format( <string> )', 'local("x")')).toBe(false);
  });

  it('accepts a url function for the url type', () => {
    expect(accepts('<url>', 'url(x.png)')).toBe(true);
    expect(accepts('<url>', 'format("woff")')).toBe(false);
  });
});
