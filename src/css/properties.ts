// Builds the validation rule for every property the extension knows about, from the CSS data that
// ships with vscode-css-languageservice.
//
// Each property carries a value definition syntax, but the data leaves many of the types that
// syntax refers to (<display-outside>, <line-style>, <ratio>, ...) undefined. `TYPE_SYNTAX` fills
// those in so the syntax can be matched in full. A property whose syntax still refers to a type
// that is neither a primitive nor listed here is left unchecked rather than guessed at.

import { getDefaultCSSDataProvider, type IPropertyData } from 'vscode-css-languageservice';
import type { SyntaxNode } from './syntax/ast';
import { parseSyntax } from './syntax/parser';
import { COLOR_FUNCTIONS } from './values/colors';
import {
  CSS_WIDE_KEYWORDS,
  IMAGE_FUNCTIONS,
  PRIMITIVE_TYPES,
  URL_FUNCTIONS,
} from './values/type-matcher';

/**
 * Definitions for the types the CSS data refers to but does not define. The right-hand side is a
 * value definition syntax string, so it is parsed the same way as a property syntax.
 *
 * Sources: CSS Display 3 (`display-*`), CSS Backgrounds 3 (`line-style`, `line-width`, `visual-box`,
 * `box`, `repeat-style`, `bg-size`), CSS Fonts 4 (`absolute-size`, `relative-size`,
 * `font-weight-absolute`, `family-name`), CSS Values 4 (`number-percentage`, `ratio`), CSS Color 4
 * (`opacity-value`), CSS Animations 1 (`keyframes-name`), CSS UI 4 (`outline-line-style`).
 */
const TYPE_SYNTAX: ReadonlyMap<string, string> = new Map([
  ['display-outside', 'block | inline | run-in'],
  ['display-inside', 'flow | flow-root | table | flex | grid | ruby'],
  ['display-listitem', '<display-outside>? && [ flow | flow-root ]? && list-item'],
  [
    'display-internal',
    'table-row-group | table-header-group | table-footer-group | table-row | table-cell | ' +
      'table-column-group | table-column | table-caption | ruby-base | ruby-text | ' +
      'ruby-base-container | ruby-text-container',
  ],
  ['display-box', 'contents | none'],
  ['display-legacy', 'inline-block | inline-table | inline-flex | inline-grid'],
  [
    'line-style',
    'none | hidden | dotted | dashed | solid | double | groove | ridge | inset | outset',
  ],
  [
    'outline-line-style',
    'auto | none | hidden | dotted | dashed | solid | double | groove | ridge | inset | outset',
  ],
  ['line-width', 'thin | medium | thick | <length>'],
  ['absolute-size', 'xx-small | x-small | small | medium | large | x-large | xx-large | xxx-large'],
  ['relative-size', 'larger | smaller'],
  ['font-weight-absolute', 'normal | bold | bolder | lighter | <number>'],
  ['number-percentage', '<number> | <percentage>'],
  ['opacity-value', '<number> | <percentage>'],
  ['ratio', '<number> [ / <number> ]?'],
  ['family-name', '<string> | <custom-ident>+'],
  ['visual-box', 'content-box | padding-box | border-box'],
  ['box', 'border-box | padding-box | content-box'],
  ['repeat-style', 'repeat-x | repeat-y | [ repeat | space | round | no-repeat ]{1,2}'],
  ['bg-size', '[ <length-percentage> | auto ]{1,2} | cover | contain'],
  ['keyframes-name', '<custom-ident> | <string>'],
]);

/**
 * Restrictions marking a property as accepting names the compiler cannot know. A property that
 * carries one of them is never treated as a closed set of keywords.
 */
const OPEN_RESTRICTIONS = new Set([
  'identifier',
  'string',
  'font',
  'color',
  'url',
  'image',
  'property',
  'family-name',
]);

/** A value made of exactly one bare CSS identifier. */
const VALUE_IDENT_RE = /^-?[A-Za-z][A-Za-z0-9-]*$/;

/** An identifier, possibly vendor-prefixed, used to pick keywords out of a value syntax. */
const IDENTIFIER_RE = /-?[A-Za-z][A-Za-z0-9-]*/g;

/** A `<type>` reference inside a value syntax. */
const TYPE_REFERENCE_RE = /<[^>]*>/g;

/**
 * How a property's value is checked. `keywords` holds the CSS-wide keywords plus every keyword the
 * property documents in its `values` list, which is often wider than the value definition syntax
 * (vendor-prefixed and legacy keywords such as `-webkit-box` or `optimizeSpeed`). A value that is
 * one of them is accepted whatever the syntax says, so the data is never contradicted.
 */
export type PropertyRule =
  | { mode: 'syntax'; ast: SyntaxNode; functions: Set<string>; keywords: Set<string> }
  | { mode: 'keywords'; keywords: Set<string> };

/** True when the property accepts only keywords, so an unknown identifier is always wrong. */
function isClosedEnum(entry: IPropertyData): boolean {
  const restrictions = entry.restrictions ?? [];

  return (
    restrictions.includes('enum') &&
    !restrictions.some((restriction) => OPEN_RESTRICTIONS.has(restriction))
  );
}

/** Every keyword the property accepts: the CSS-wide ones, its known values, and its syntax. */
function acceptedKeywords(entry: IPropertyData): Set<string> {
  const accepted = new Set(CSS_WIDE_KEYWORDS);

  for (const value of entry.values ?? []) {
    for (const piece of value.name.split(',')) {
      const keyword = piece.trim();

      if (VALUE_IDENT_RE.test(keyword)) accepted.add(keyword.toLowerCase());
    }
  }

  const syntax = (entry.syntax ?? '').replace(TYPE_REFERENCE_RE, ' ');

  for (const literal of syntax.match(IDENTIFIER_RE) ?? []) accepted.add(literal.toLowerCase());

  return accepted;
}

const data = new Map<string, IPropertyData>(
  getDefaultCSSDataProvider()
    .provideProperties()
    .map((entry) => [entry.name.toLowerCase(), entry]),
);

/**
 * Replaces the `<'property'>` references and the types listed in `TYPE_SYNTAX` with the syntax they
 * stand for. Returns `null` when a reference cannot be expanded, which makes the whole property
 * unchecked instead of loosely matched.
 */
function expand(node: SyntaxNode, visiting: ReadonlySet<string>): SyntaxNode | null {
  switch (node.kind) {
    case 'property-ref': {
      const key = `property:${node.name}`;

      if (visiting.has(key)) return null;

      const target = data.get(node.name)?.syntax;

      if (!target) return null;

      return expand(parseSyntax(target), new Set([...visiting, key]));
    }
    case 'type': {
      const syntax = TYPE_SYNTAX.get(node.name);

      if (!syntax || node.function) return node;

      const key = `type:${node.name}`;

      if (visiting.has(key)) return null;

      return expand(parseSyntax(syntax), new Set([...visiting, key]));
    }
    case 'group': {
      const child = expand(node.child, visiting);

      return child ? { kind: 'group', child } : null;
    }
    case 'alternation': {
      const options = expandEach(node.options, visiting);

      return options ? { kind: 'alternation', options } : null;
    }
    case 'any-order': {
      const operands = expandEach(node.operands, visiting);

      return operands ? { kind: 'any-order', operands } : null;
    }
    case 'all': {
      const operands = expandEach(node.operands, visiting);

      return operands ? { kind: 'all', operands } : null;
    }
    case 'sequence': {
      const operands = expandEach(node.operands, visiting);

      return operands ? { kind: 'sequence', operands } : null;
    }
    case 'repeat': {
      const child = expand(node.child, visiting);

      return child ? { ...node, child } : null;
    }
    case 'keyword': {
      if (!node.argument) return node;

      const argument = expand(node.argument, visiting);

      return argument ? { ...node, argument } : null;
    }
    default:
      return node;
  }
}

function expandEach(
  nodes: readonly SyntaxNode[],
  visiting: ReadonlySet<string>,
): SyntaxNode[] | null {
  const expanded: SyntaxNode[] = [];

  for (const node of nodes) {
    const value = expand(node, visiting);

    if (!value) return null;

    expanded.push(value);
  }

  return expanded;
}

/**
 * The function names a syntax accepts. A value that calls a function this set does not contain (a
 * Sass function, for instance) cannot be judged from the syntax, so the caller leaves it unchecked.
 */
function acceptedFunctions(node: SyntaxNode, into: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case 'type':
      if (node.function) into.add(node.name);
      else if (node.name === 'color') for (const name of COLOR_FUNCTIONS) into.add(name);
      else if (node.name === 'image') for (const name of IMAGE_FUNCTIONS) into.add(name);
      else if (node.name === 'url') for (const name of URL_FUNCTIONS) into.add(name);
      break;
    case 'keyword':
      if (node.function) into.add(node.value);
      if (node.argument) acceptedFunctions(node.argument, into);
      break;
    case 'group':
      acceptedFunctions(node.child, into);
      break;
    case 'alternation':
      for (const option of node.options) acceptedFunctions(option, into);
      break;
    case 'any-order':
    case 'all':
    case 'sequence':
      for (const operand of node.operands) acceptedFunctions(operand, into);
      break;
    case 'repeat':
      acceptedFunctions(node.child, into);
      break;
    default:
      break;
  }

  return into;
}

/** True when the syntax still refers to a type the matcher cannot decide. */
function hasUnsupportedType(node: SyntaxNode): boolean {
  switch (node.kind) {
    case 'type':
      return !node.function && !PRIMITIVE_TYPES.has(node.name);
    case 'group':
      return hasUnsupportedType(node.child);
    case 'alternation':
      return node.options.some(hasUnsupportedType);
    case 'any-order':
    case 'all':
    case 'sequence':
      return node.operands.some(hasUnsupportedType);
    case 'repeat':
      return hasUnsupportedType(node.child);
    case 'keyword':
      return node.argument ? hasUnsupportedType(node.argument) : false;
    default:
      return false;
  }
}

/** The rule for one property, or `undefined` when its value cannot be checked soundly. */
function ruleFor(entry: IPropertyData): PropertyRule | undefined {
  const syntax = entry.syntax?.trim();

  if (syntax) {
    const expanded = expand(parseSyntax(syntax), new Set());

    if (expanded && !hasUnsupportedType(expanded)) {
      return {
        mode: 'syntax',
        ast: expanded,
        functions: acceptedFunctions(expanded),
        keywords: acceptedKeywords(entry),
      };
    }
  }

  if (isClosedEnum(entry)) return { mode: 'keywords', keywords: acceptedKeywords(entry) };

  return undefined;
}

let rules: Map<string, PropertyRule> | undefined;

/** The validation rule for every property whose value can be checked, keyed by lower-cased name. */
export function propertyRules(): Map<string, PropertyRule> {
  if (!rules) {
    rules = new Map();

    for (const entry of data.values()) {
      // Vendor-prefixed properties are left out: their value definitions and their documented
      // values disagree (`-ms-scroll-snap-x`, `-moz-force-broken-image-icon`), and they are not
      // part of any standard. Only standard properties are checked.
      if (entry.name.startsWith('-')) continue;

      const rule = ruleFor(entry);

      if (rule) rules.set(entry.name.toLowerCase(), rule);
    }
  }

  return rules;
}

let cssFunctions: Set<string> | undefined;

/**
 * Every function name any property's value definition syntax accepts (a colour function such as
 * `rgb()`, a shape function such as `circle()`, `var()`, ...). Such a call produces a value the
 * property's own syntax describes, so it is never treated as a mistake. Built out of the syntax
 * itself, so it stays in step with the CSS data instead of being a hand-kept list.
 */
export function knownCssFunctions(): Set<string> {
  if (!cssFunctions) {
    cssFunctions = new Set();

    for (const rule of propertyRules().values()) {
      if (rule.mode !== 'syntax') continue;

      for (const name of rule.functions) cssFunctions.add(name);
    }
  }

  return cssFunctions;
}
