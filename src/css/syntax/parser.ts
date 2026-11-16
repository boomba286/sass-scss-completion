// Parses a CSS value definition syntax string into the tree described by `ast.ts`.
//
// Precedence, lowest first: `|`, then `||`, then `&&`, then juxtaposition, then the postfix
// multipliers. Anything the parser does not recognise is skipped rather than throwing, so a
// syntax string that uses a notation added later degrades into a slightly looser tree instead of
// breaking every property that shares it.

import type { NumericRange, SyntaxNode } from './ast';

const INFINITY_SYMBOL = '\u221e';

type SyntaxToken =
  | { type: 'group-open' }
  | { type: 'group-close' }
  | { type: 'paren-open' }
  | { type: 'paren-close' }
  | { type: 'or' }
  | { type: 'any-order' }
  | { type: 'all' }
  | { type: 'optional' }
  | { type: 'zero-or-more' }
  | { type: 'one-or-more' }
  | { type: 'hash' }
  | { type: 'range-open' }
  | { type: 'range-close' }
  | { type: 'comma' }
  | { type: 'slash' }
  | { type: 'keyword'; value: string }
  | { type: 'number'; value: number }
  | { type: 'type'; node: SyntaxNode }
  | { type: 'property-ref'; name: string };

const NUMBER = /^[0-9]+(?:\.[0-9]+)?/;
const WORD = /^-?[A-Za-z_][A-Za-z0-9_-]*/;

/** Reads one bound of a `<type [min,max]>` range, falling back when it is missing or open ended. */
function readBound(text: string, fallback: number): number {
  const trimmed = text.trim();

  if (trimmed === '') return fallback;
  if (trimmed.includes(INFINITY_SYMBOL)) return trimmed.startsWith('-') ? -Infinity : Infinity;

  const value = Number(trimmed);

  return Number.isNaN(value) ? fallback : value;
}

/** Turns the text between `<` and `>` into a type reference or a property reference. */
function readTypeToken(inner: string): SyntaxToken {
  const trimmed = inner.trim();

  if (trimmed.startsWith("'")) {
    return { type: 'property-ref', name: trimmed.replace(/^'|'$/g, '').trim().toLowerCase() };
  }

  const rangeStart = trimmed.indexOf('[');
  let head = trimmed;
  let range: NumericRange | undefined;

  if (rangeStart >= 0) {
    const rangeEnd = trimmed.indexOf(']', rangeStart);
    const bounds = trimmed
      .slice(rangeStart + 1, rangeEnd < 0 ? undefined : rangeEnd)
      .split(',');

    head = trimmed.slice(0, rangeStart).trim();
    range = { min: readBound(bounds[0] ?? '', -Infinity), max: readBound(bounds[1] ?? '', Infinity) };
  }

  const isFunction = /\(\s*\)$/.test(head);

  return {
    type: 'type',
    node: {
      kind: 'type',
      name: head.replace(/\(\s*\)$/, '').trim().toLowerCase(),
      function: isFunction,
      range,
    },
  };
}

function tokenize(syntax: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < syntax.length) {
    const char = syntax[index] ?? '';

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '<') {
      const close = syntax.indexOf('>', index + 1);

      if (close < 0) break;

      tokens.push(readTypeToken(syntax.slice(index + 1, close)));
      index = close + 1;
      continue;
    }

    if (char === '[') {
      tokens.push({ type: 'group-open' });
      index += 1;
      continue;
    }
    if (char === ']') {
      tokens.push({ type: 'group-close' });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'paren-open' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'paren-close' });
      index += 1;
      continue;
    }
    if (char === '?') {
      tokens.push({ type: 'optional' });
      index += 1;
      continue;
    }
    if (char === '*') {
      tokens.push({ type: 'zero-or-more' });
      index += 1;
      continue;
    }
    if (char === '+') {
      tokens.push({ type: 'one-or-more' });
      index += 1;
      continue;
    }
    if (char === '#') {
      tokens.push({ type: 'hash' });
      index += 1;
      continue;
    }
    if (char === '{') {
      tokens.push({ type: 'range-open' });
      index += 1;
      continue;
    }
    if (char === '}') {
      tokens.push({ type: 'range-close' });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }
    if (char === '/') {
      tokens.push({ type: 'slash' });
      index += 1;
      continue;
    }
    if (char === '|') {
      tokens.push(syntax[index + 1] === '|' ? { type: 'any-order' } : { type: 'or' });
      index += syntax[index + 1] === '|' ? 2 : 1;
      continue;
    }
    if (char === '&') {
      if (syntax[index + 1] === '&') {
        tokens.push({ type: 'all' });
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    const number = NUMBER.exec(syntax.slice(index));

    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    const word = WORD.exec(syntax.slice(index));

    if (word) {
      tokens.push({ type: 'keyword', value: word[0].toLowerCase() });
      index += word[0].length;
      continue;
    }

    index += 1;
  }

  return tokens;
}

class Parser {
  private index = 0;

  public constructor(private readonly tokens: SyntaxToken[]) {}

  public parse(): SyntaxNode {
    return this.alternation();
  }

  private peek(): SyntaxToken | undefined {
    return this.tokens[this.index];
  }

  private next(): SyntaxToken | undefined {
    const token = this.tokens[this.index];

    this.index += 1;

    return token;
  }

  /**
   * True for tokens that end the current sequence: a closing bracket, one of the combinators, or a
   * multiplier that has nothing to attach to.
   */
  private atSequenceEnd(token: SyntaxToken): boolean {
    switch (token.type) {
      case 'group-close':
      case 'paren-close':
      case 'or':
      case 'any-order':
      case 'all':
      case 'range-open':
      case 'range-close':
      case 'optional':
      case 'zero-or-more':
      case 'one-or-more':
      case 'hash':
        return true;
      default:
        return false;
    }
  }

  private alternation(): SyntaxNode {
    const options = [this.anyOrder()];

    while (this.peek()?.type === 'or') {
      this.next();
      options.push(this.anyOrder());
    }

    return options.length === 1 ? options[0]! : { kind: 'alternation', options };
  }

  private anyOrder(): SyntaxNode {
    const operands = [this.all()];

    while (this.peek()?.type === 'any-order') {
      this.next();
      operands.push(this.all());
    }

    return operands.length === 1 ? operands[0]! : { kind: 'any-order', operands };
  }

  private all(): SyntaxNode {
    const operands = [this.sequence()];

    while (this.peek()?.type === 'all') {
      this.next();
      operands.push(this.sequence());
    }

    return operands.length === 1 ? operands[0]! : { kind: 'all', operands };
  }

  private sequence(): SyntaxNode {
    const operands: SyntaxNode[] = [];

    while (this.index < this.tokens.length) {
      const token = this.peek();

      if (!token || this.atSequenceEnd(token)) break;

      const before = this.index;
      const component = this.component();

      if (component) {
        operands.push(component);
      } else if (this.index === before) {
        this.index += 1;
      }
    }

    if (operands.length === 0) return { kind: 'keyword', value: '', function: false };

    return operands.length === 1 ? operands[0]! : { kind: 'sequence', operands };
  }

  private component(): SyntaxNode | null {
    const token = this.next();

    if (!token) return null;

    switch (token.type) {
      case 'group-open': {
        const child = this.alternation();

        if (this.peek()?.type === 'group-close') this.next();

        return this.multiplied({ kind: 'group', child });
      }
      case 'type':
        return this.multiplied(token.node);
      case 'property-ref':
        return this.multiplied({ kind: 'property-ref', name: token.name });
      case 'comma':
        return this.multiplied({ kind: 'separator', value: ',' });
      case 'slash':
        return this.multiplied({ kind: 'separator', value: '/' });
      case 'keyword': {
        if (this.peek()?.type !== 'paren-open') {
          return this.multiplied({ kind: 'keyword', value: token.value, function: false });
        }

        this.next();

        const argument = this.alternation();

        if (this.peek()?.type === 'paren-close') this.next();

        return this.multiplied({ kind: 'keyword', value: token.value, function: true, argument });
      }
      default:
        return null;
    }
  }

  /** Applies the multipliers written directly after a component. */
  private multiplied(node: SyntaxNode): SyntaxNode {
    let current = node;

    for (;;) {
      const token = this.peek();

      if (!token) return current;

      switch (token.type) {
        case 'optional':
          this.next();
          current = { kind: 'repeat', min: 0, max: 1, separator: null, child: current };
          break;
        case 'zero-or-more':
          this.next();
          current = { kind: 'repeat', min: 0, max: null, separator: null, child: current };
          break;
        case 'one-or-more':
          this.next();
          current = { kind: 'repeat', min: 1, max: null, separator: null, child: current };
          break;
        case 'hash': {
          this.next();

          let min = 1;

          if (this.peek()?.type === 'optional') {
            this.next();
            min = 0;
          }

          current = { kind: 'repeat', min, max: null, separator: ',', child: current };
          break;
        }
        case 'range-open': {
          this.next();

          const bounds: number[] = [];

          while (this.peek()) {
            const inner = this.peek()!;

            if (inner.type === 'number') bounds.push(inner.value);
            else if (inner.type !== 'comma') break;
            this.next();
          }

          if (this.peek()?.type === 'range-close') this.next();

          if (bounds.length > 0) {
            current = {
              kind: 'repeat',
              min: bounds[0]!,
              max: bounds[1] ?? bounds[0]!,
              separator: null,
              child: current,
            };
          }
          break;
        }
        default:
          return current;
      }
    }
  }
}

/** Parses a value definition syntax string. */
export function parseSyntax(syntax: string): SyntaxNode {
  return new Parser(tokenize(syntax)).parse();
}

