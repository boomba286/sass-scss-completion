// Decides whether a tokenized declaration value is accepted by a parsed value definition syntax.
//
// The matcher walks the tree and, at every node, returns the set of token offsets a match can end
// at. Alternation and the multipliers produce several offsets, so the caller keeps every option
// alive; a value is accepted when the whole token list can be consumed. This is a plain
// non-deterministic walk rather than a compiled automaton, which keeps the code close to the
// grammar and is fast enough for one declaration value at a time.

import type { RepeatNode, SeparatorNode, SyntaxNode } from './ast';
import type { ValueToken } from '../values/tokenizer';
import { CSS_WIDE_KEYWORDS, matchLeafType } from '../values/type-matcher';

/** A set of token offsets a partial match can end at. */
type Ends = Set<number>;

/** True when `tokens` is accepted by `node` in full. */
export function matchesValue(node: SyntaxNode, tokens: ValueToken[]): boolean {
  const only = tokens[0];

  // A CSS-wide keyword is a whole value on its own and stands in for any property.
  if (tokens.length === 1 && only?.kind === 'ident' && CSS_WIDE_KEYWORDS.has(only.name)) return true;

  return matchNode(node, tokens, 0).has(tokens.length);
}

/** Matches a sequence of operands one after another. */
function matchSequence(operands: SyntaxNode[], tokens: ValueToken[], pos: number): Ends {
  let current: Ends = new Set([pos]);

  for (const operand of operands) {
    const next: Ends = new Set();

    for (const point of current) {
      for (const end of matchNode(operand, tokens, point)) next.add(end);
    }

    if (next.size === 0) return next;

    current = next;
  }

  return current;
}

/**
 * Matches the operands of `||` (one or more) and `&&` (all of them), in any order, each operand at
 * most once. `requireAll` selects between the two.
 */
function matchAnyOrder(
  operands: SyntaxNode[],
  tokens: ValueToken[],
  pos: number,
  requireAll: boolean,
): Ends {
  const results: Ends = new Set();
  const taken = operands.map(() => false);

  const walk = (point: number, matched: number): void => {
    if (requireAll ? matched === operands.length : matched >= 1) results.add(point);
    if (matched === operands.length) return;

    for (let index = 0; index < operands.length; index += 1) {
      if (taken[index]) continue;

      taken[index] = true;

      for (const end of matchNode(operands[index]!, tokens, point)) walk(end, matched + 1);

      taken[index] = false;
    }
  };

  walk(pos, 0);

  return results;
}

/** Matches the postfix multipliers: `?`, `*`, `+`, `#`, `{n}`, and `{n,m}`. */
function matchRepeat(node: RepeatNode, tokens: ValueToken[], pos: number): Ends {
  const results: Ends = new Set();

  if (node.min === 0) results.add(pos);

  const limit = node.max ?? tokens.length + 1;
  let frontier = new Set<number>();

  for (const end of matchNode(node.child, tokens, pos)) {
    if (end > pos) frontier.add(end);
  }

  for (let count = 1; count <= limit; count += 1) {
    if (frontier.size === 0) break;

    if (node.min <= count) for (const end of frontier) results.add(end);

    const next = new Set<number>();

    for (const point of frontier) {
      const separator: SeparatorNode | undefined = node.separator
        ? { kind: 'separator', value: node.separator }
        : undefined;
      const afterSeparator = separator
        ? matchNode(separator, tokens, point)
        : new Set<number>([point]);

      for (const start of afterSeparator) {
        for (const end of matchNode(node.child, tokens, start)) {
          if (end > start) next.add(end);
        }
      }
    }

    frontier = next;
  }

  return results;
}

/** Returns every offset a match of `node` can end at, starting from `pos`. */
function matchNode(node: SyntaxNode, tokens: ValueToken[], pos: number): Ends {
  switch (node.kind) {
    case 'keyword': {
      const token = tokens[pos];

      if (node.function) {
        const matches = token?.kind === 'function' && (node.value === '' || token.name === node.value);

        return matches ? new Set([pos + 1]) : new Set();
      }

      if (node.value === '') return new Set([pos]);

      const matches = token?.kind === 'ident' && token.name === node.value;

      return matches ? new Set([pos + 1]) : new Set();
    }
    case 'separator': {
      const token = tokens[pos];
      const matches = token?.kind === 'operator' && token.text === node.value;

      return matches ? new Set([pos + 1]) : new Set();
    }
    case 'type': {
      const token = tokens[pos];

      if (node.function) return token?.kind === 'function' ? new Set([pos + 1]) : new Set();

      return new Set(matchLeafType(node.name, tokens, pos));
    }
    case 'property-ref':
      // An unresolved reference stands for a component that was not expanded; consume one token.
      return tokens[pos] ? new Set([pos + 1]) : new Set();
    case 'group':
      return matchNode(node.child, tokens, pos);
    case 'alternation': {
      const ends: Ends = new Set();

      for (const option of node.options) {
        for (const end of matchNode(option, tokens, pos)) ends.add(end);
      }

      return ends;
    }
    case 'sequence':
      return matchSequence(node.operands, tokens, pos);
    case 'any-order':
      return matchAnyOrder(node.operands, tokens, pos, false);
    case 'all':
      return matchAnyOrder(node.operands, tokens, pos, true);
    case 'repeat':
      return matchRepeat(node, tokens, pos);
  }
}
