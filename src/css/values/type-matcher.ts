// Matches a single value token against one of the CSS types that the value definition syntax refers
// to but never defines itself. Types that are defined in terms of other types (for example
// `<line-style>` or `<ratio>`) are written as value definition syntax strings in `../properties.ts`
// instead, so only the leaf types live here.

import { COLOR_FUNCTIONS, COLOR_KEYWORDS, HEX_COLOR_LENGTHS, NAMED_COLORS } from './colors';
import type { ValueToken } from './tokenizer';
import {
  ANGLE_UNITS,
  FLEX_UNITS,
  FREQUENCY_UNITS,
  LENGTH_UNITS,
  RESOLUTION_UNITS,
  TIME_UNITS,
} from './units';

/** Keywords every property accepts as its whole value. */
export const CSS_WIDE_KEYWORDS = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
]);

/** Leaf types this module knows how to match. */
export const PRIMITIVE_TYPES = new Set([
  'length',
  'length-percentage',
  'percentage',
  'number',
  'integer',
  'angle',
  'time',
  'frequency',
  'resolution',
  'flex',
  'string',
  'url',
  'image',
  'color',
  'custom-ident',
  'ident',
]);

/** True for a dimension token whose unit belongs to `units`. */
function isDimension(token: ValueToken, units: Set<string>): boolean {
  return token.kind === 'dimension' && token.unit !== undefined && units.has(token.unit);
}

/**
 * Functions that produce a `<url>` or an `<image>`. Both also accept a quoted string. Vendor
 * prefixes are stripped before the lookup, because a prefixed function such as
 * `-webkit-linear-gradient()` names the same thing.
 */
export const URL_FUNCTIONS = new Set(['url', 'src']);
export const IMAGE_FUNCTIONS = new Set([
  ...URL_FUNCTIONS,
  'image',
  'image-set',
  'cross-fade',
  'element',
  'paint',
  'linear-gradient',
  'repeating-linear-gradient',
  'radial-gradient',
  'repeating-radial-gradient',
  'conic-gradient',
  'repeating-conic-gradient',
]);

/** Removes a leading `-vendor-` prefix so prefixed names resolve to the unprefixed ones. */
export function unprefixed(name: string): string {
  return name.replace(/^-[a-z]+-/, '');
}

/** True for a function token whose unprefixed name belongs to `functions`. */
function isFunction(token: ValueToken, functions: Set<string>): boolean {
  return token.kind === 'function' && functions.has(unprefixed(token.name));
}

/** True for a unit-less zero, which every numeric type accepts. */
function isZero(token: ValueToken): boolean {
  return token.kind === 'number' && token.value === 0;
}

/** True for a `<length>` token. */
function isLength(token: ValueToken): boolean {
  return isDimension(token, LENGTH_UNITS) || isZero(token);
}

/** True for a `<color>` token: a hexadecimal literal, a named colour, a colour keyword, or a call. */
function isColor(token: ValueToken): boolean {
  if (token.kind === 'hash') return HEX_COLOR_LENGTHS.has(token.text.length - 1);
  if (token.kind === 'function') return COLOR_FUNCTIONS.has(unprefixed(token.name));

  return token.kind === 'ident' && (NAMED_COLORS.has(token.name) || COLOR_KEYWORDS.has(token.name));
}

/**
 * Returns the end offsets of every match of `name` at `pos`, or an empty list when the token there
 * cannot start that type. Every type here spans a single token, so the result has at most one entry.
 */
export function matchLeafType(name: string, tokens: ValueToken[], pos: number): number[] {
  const token = tokens[pos];

  if (!token) return [];

  switch (name) {
    case 'length':
      return isLength(token) ? [pos + 1] : [];
    case 'length-percentage':
      return isLength(token) || token.kind === 'percentage' ? [pos + 1] : [];
    case 'percentage':
      return token.kind === 'percentage' ? [pos + 1] : [];
    case 'number':
      return token.kind === 'number' ? [pos + 1] : [];
    case 'integer':
      return token.kind === 'number' && Number.isInteger(token.value) ? [pos + 1] : [];
    case 'angle':
      return isDimension(token, ANGLE_UNITS) || isZero(token) ? [pos + 1] : [];
    case 'time':
      return isDimension(token, TIME_UNITS) || isZero(token) ? [pos + 1] : [];
    case 'frequency':
      return isDimension(token, FREQUENCY_UNITS) ? [pos + 1] : [];
    case 'resolution':
      return isDimension(token, RESOLUTION_UNITS) ? [pos + 1] : [];
    case 'flex':
      return isDimension(token, FLEX_UNITS) ? [pos + 1] : [];
    case 'string':
      return token.kind === 'string' ? [pos + 1] : [];
    case 'url':
      return token.kind === 'string' || isFunction(token, URL_FUNCTIONS) ? [pos + 1] : [];
    case 'image':
      return token.kind === 'string' || isFunction(token, IMAGE_FUNCTIONS) ? [pos + 1] : [];
    case 'color':
      return isColor(token) ? [pos + 1] : [];
    case 'custom-ident':
      return token.kind === 'ident' && !CSS_WIDE_KEYWORDS.has(token.name) ? [pos + 1] : [];
    case 'ident':
      return token.kind === 'ident' ? [pos + 1] : [];
    default:
      return [];
  }
}
