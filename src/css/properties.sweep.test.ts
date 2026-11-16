import { describe, expect, it } from 'vitest';
import { getDefaultCSSDataProvider } from 'vscode-css-languageservice';
import { findUnknownPropertyValues } from './diagnostics';
import { propertyRules } from './properties';
import type { SyntaxNode } from './syntax/ast';
import { matchesValue } from './syntax/matcher';
import { tokenizeValue } from './values/tokenizer';

/**
 * The documented values the checker still rejects. `format()` is only valid after a `url()` in
 * `src`, so the CSS data lists it as a value while the value definition syntax refuses it on its
 * own; the checker follows the syntax. The set is compared in both directions, so it cannot go
 * stale without the test failing.
 */
const REJECTED_DOCUMENTED_VALUES = new Set(['src: format()']);

describe('the CSS data and the value definition syntax agree', () => {
  it('accepts every value the CSS data documents, and rejects only the known exception', () => {
    const rules = propertyRules();
    const rejected = new Set<string>();

    for (const property of getDefaultCSSDataProvider().provideProperties()) {
      // Vendor-prefixed properties are not part of any standard and are left unchecked.
      if (property.name.startsWith('-') || !rules.has(property.name.toLowerCase())) continue;

      for (const value of property.values ?? []) {
        const declaration = `.a { ${property.name}: ${value.name}; }`;

        if (findUnknownPropertyValues(declaration).length > 0) {
          rejected.add(`${property.name}: ${value.name}`);
        }
      }
    }

    expect(rejected).toEqual(REJECTED_DOCUMENTED_VALUES);
  });
});

/** A literal for each primitive type, so a value can be synthesised out of a value definition. */
const PRIMITIVE_SAMPLE: Readonly<Record<string, string>> = {
  length: '1px',
  'length-percentage': '1px',
  percentage: '1%',
  number: '1',
  integer: '1',
  angle: '1deg',
  time: '1s',
  frequency: '1hz',
  resolution: '1dpi',
  flex: '1fr',
  color: 'red',
  image: 'url(x.png)',
  url: 'url(x.png)',
  string: '"x"',
  'custom-ident': 'x',
  ident: 'x',
};

/**
 * Builds a value the syntax should accept, by walking the tree and taking the first branch of every
 * choice. This is deliberately a different algorithm from the matcher: the matcher recognises a
 * token list, this one synthesises one, so agreement between the two carries weight. Returns `null`
 * when a node cannot be turned into a literal, which fails the test rather than passing silently.
 */
function synthesize(node: SyntaxNode): string | null {
  switch (node.kind) {
    case 'keyword': {
      if (!node.function) return node.value;

      const argument = node.argument ? synthesize(node.argument) : '';

      return argument === null ? null : `${node.value || 'x'}(${argument})`;
    }
    case 'type':
      return node.function ? `${node.name}(x)` : (PRIMITIVE_SAMPLE[node.name] ?? null);
    case 'separator':
      return node.value;
    case 'group':
      return synthesize(node.child);
    case 'alternation': {
      for (const option of node.options) {
        const value = synthesize(option);

        if (value) return value;
      }

      return null;
    }
    case 'any-order':
    case 'all':
    case 'sequence': {
      const parts: string[] = [];

      for (const operand of node.operands) {
        const value = synthesize(operand);

        if (value === null) return null;

        if (value !== '') parts.push(value);
      }

      return parts.join(' ');
    }
    case 'repeat': {
      const parts: string[] = [];

      for (let index = 0; index < Math.max(1, node.min); index += 1) {
        const value = synthesize(node.child);

        if (value === null) return null;

        parts.push(value);
      }

      return parts.join(node.separator === ',' ? ', ' : ' ');
    }
    default:
      return null;
  }
}

describe('every syntax rule round-trips through the matcher', () => {
  it('accepts a value synthesised from its own syntax', () => {
    const rejected: string[] = [];

    for (const [name, rule] of propertyRules()) {
      if (rule.mode !== 'syntax') continue;

      const value = synthesize(rule.ast);

      if (!value || !matchesValue(rule.ast, tokenizeValue(value).tokens)) {
        rejected.push(`${name} :: ${JSON.stringify(value)}`);
      }
    }

    expect(rejected).toEqual([]);
  });

  it('rejects a dimension whose unit no rule accepts', () => {
    const accepting: string[] = [];

    for (const [name, rule] of propertyRules()) {
      if (rule.mode !== 'syntax') continue;

      if (matchesValue(rule.ast, tokenizeValue('1notaunit').tokens)) accepting.push(name);
    }

    expect(accepting).toEqual([]);
  });
});

describe('every keyword rule rejects an unknown identifier', () => {
  it('flags an identifier outside its keyword set', () => {
    const accepted: string[] = [];

    for (const [name, rule] of propertyRules()) {
      if (rule.mode !== 'keywords') continue;

      if (findUnknownPropertyValues(`.a { ${name}: zznotakeywordzz; }`).length === 0) {
        accepted.push(name);
      }
    }

    expect(accepted).toEqual([]);
  });
});
