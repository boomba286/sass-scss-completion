// Splits a declaration value into the tokens the value-syntax matcher works with.
//
// The tokenizer is intentionally small: it only recognises the shapes a CSS value definition
// syntax refers to (identifiers, numbers with units, strings, hex colours, function calls) and
// reports whether the value can be decided statically at all. A value that contains a Sass
// variable, interpolation, Sass maths, or a call the compiler evaluates is marked `dynamic`,
// so callers can leave it alone instead of guessing.

export type ValueTokenKind =
  | 'ident'
  | 'number'
  | 'dimension'
  | 'percentage'
  | 'string'
  | 'hash'
  | 'function'
  | 'operator'
  | 'variable';

export interface ValueToken {
  kind: ValueTokenKind;
  /** Raw source text of the token. */
  text: string;
  /** Lower-cased name of an `ident` or `function` token; empty for every other kind. */
  name: string;
  /** Numeric part of a `number`, `dimension`, or `percentage` token. */
  value?: number;
  /** Lower-cased unit of a `dimension` token. */
  unit?: string;
  /** Offset of the token inside the value text. */
  start: number;
  /** Offset just past the token. */
  end: number;
}

export interface TokenizedValue {
  tokens: ValueToken[];
  /** True when the value depends on Sass variables, interpolation, or Sass-only maths. */
  dynamic: boolean;
}

/** Functions whose result is not described by a CSS type, or that Sass resolves before output. */
export const DYNAMIC_FUNCTIONS = new Set([
  'var',
  'env',
  'calc',
  'min',
  'max',
  'clamp',
  'calc-size',
  'anchor',
  'anchor-size',
  'if',
  'attr',
]);

/** Operators that separate parts of a CSS value. Every other operator means Sass maths. */
const STRUCTURAL_OPERATORS = new Set([',', '/']);

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const UNIT = /%|[-A-Za-z]+/y;
const IDENTIFIER = /-?[A-Za-z_][A-Za-z0-9_-]*/y;
const IDENTIFIER_RUN = /[A-Za-z0-9_-]+/y;
const HEX = /#[0-9A-Fa-f]+/y;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;
const NAME_START = /[A-Za-z_]/;

/** True when the text at `index` starts a number rather than an identifier. */
function isNumberStart(text: string, index: number): boolean {
  const char = text[index] ?? '';

  if (DIGIT.test(char)) return true;
  if (char === '.' && DIGIT.test(text[index + 1] ?? '')) return true;

  if (char === '+' || char === '-') {
    const next = text[index + 1] ?? '';

    if (DIGIT.test(next)) return true;
    if (next === '.' && DIGIT.test(text[index + 2] ?? '')) return true;
  }

  return false;
}

/** Consumes a run of name characters and returns the index just past it. */
function scanNameRun(text: string, start: number): number {
  IDENTIFIER_RUN.lastIndex = start;

  const match = IDENTIFIER_RUN.exec(text);

  return match && match.index === start ? start + match[0].length : start;
}

/** Consumes a quoted string, honouring escapes, and returns the index just past the closing quote. */
function scanString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;

  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === quote) return index + 1;
    index += 1;
  }

  return index;
}

/**
 * Consumes a balanced `(...)` group starting at the opening parenthesis and returns the index just
 * past the closing one. Reports whether the group contains something only Sass can resolve.
 */
function scanGroup(text: string, openIndex: number): { end: number; dynamic: boolean } {
  let depth = 0;
  let dynamic = false;
  let index = openIndex;

  while (index < text.length) {
    const char = text[index];

    if (char === '"' || char === "'") {
      index = scanString(text, index);
      continue;
    }
    if (char === '#' && text[index + 1] === '{') {
      dynamic = true;
      index = scanGroup(text, index + 1).end;
      continue;
    }
    if (char === '$') {
      dynamic = true;
      index = scanNameRun(text, index + 1);
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      index += 1;
      if (depth === 0) return { end: index, dynamic };
      continue;
    }
    index += 1;
  }

  return { end: index, dynamic };
}

/**
 * Tokenizes one declaration value. `!important` must already be removed by the caller: it is not
 * part of the value and would otherwise look like two stray identifiers.
 */
export function tokenizeValue(text: string): TokenizedValue {
  const tokens: ValueToken[] = [];
  let dynamic = false;
  let index = 0;

  const add = (kind: ValueTokenKind, start: number, end: number, extra?: Partial<ValueToken>): void => {
    tokens.push({ kind, text: text.slice(start, end), name: '', start, end, ...extra });
  };

  while (index < text.length) {
    const start = index;
    const char = text[start] ?? '';

    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }

    // `$name` and `#{...}` are resolved by Sass, so the value as written carries no CSS meaning.
    if (char === '$') {
      index = scanNameRun(text, start + 1);
      add('variable', start, index);
      dynamic = true;
      continue;
    }

    if (char === '#' && text[start + 1] === '{') {
      index = scanGroup(text, start + 1).end;
      add('variable', start, index);
      dynamic = true;
      continue;
    }

    if (char === '"' || char === "'") {
      index = scanString(text, start);
      add('string', start, index);
      continue;
    }

    if (char === '#') {
      HEX.lastIndex = start;

      const hex = HEX.exec(text);

      if (hex && hex.index === start && hex[0].length > 1) {
        index = start + hex[0].length;
        add('hash', start, index);
        continue;
      }

      index = start + 1;
      add('operator', start, index);
      dynamic = true;
      continue;
    }

    if (isNumberStart(text, start)) {
      NUMBER.lastIndex = start;

      const numberText = NUMBER.exec(text)?.[0] ?? '';
      let end = start + numberText.length;
      let kind: ValueTokenKind = 'number';
      let unit: string | undefined;

      UNIT.lastIndex = end;

      const unitMatch = UNIT.exec(text);

      if (unitMatch && unitMatch.index === end && unitMatch[0].length > 0) {
        unit = unitMatch[0].toLowerCase();
        end += unitMatch[0].length;
        kind = unit === '%' ? 'percentage' : 'dimension';
      }

      index = end;
      add(kind, start, end, { value: Number(numberText), unit });
      continue;
    }

    IDENTIFIER.lastIndex = start;

    const identifierMatch = IDENTIFIER.exec(text);

    if (identifierMatch && identifierMatch.index === start) {
      let end = start + identifierMatch[0].length;
      let name = identifierMatch[0];
      let namespaced = false;

      // A dotted chain such as `math.div` is a Sass member access, not a CSS name.
      while (text[end] === '.' && NAME_START.test(text[end + 1] ?? '')) {
        IDENTIFIER.lastIndex = end + 1;

        const segment = IDENTIFIER.exec(text);

        if (!segment || segment.index !== end + 1) break;

        namespaced = true;
        name += `.${segment[0]}`;
        end += 1 + segment[0].length;
      }

      if (text[end] === '(') {
        const group = scanGroup(text, end);

        index = group.end;
        add('function', start, index, { name: name.toLowerCase() });

        if (group.dynamic || namespaced || DYNAMIC_FUNCTIONS.has(name.toLowerCase())) dynamic = true;
        continue;
      }

      index = end;
      add('ident', start, end, { name: name.toLowerCase() });

      if (namespaced) dynamic = true;
      continue;
    }

    index = start + 1;
    add('operator', start, index);

    if (!STRUCTURAL_OPERATORS.has(char)) dynamic = true;
  }

  return { tokens, dynamic };
}
