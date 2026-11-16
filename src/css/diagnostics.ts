// Finds CSS declarations whose value does not match what the property accepts, and reports the
// offset ranges of declaration values so other checks can stay out of them.
//
// The rules come from `properties.ts`, which builds them out of the value definition syntax in the
// CSS data shipped with vscode-css-languageservice. A value the compiler resolves (a Sass variable,
// interpolation, or a call of a function something else defines) is left alone, since its text says
// nothing about the value that ends up in the stylesheet. Independent of the VS Code API.

import { TextDocument, getSCSSLanguageService } from 'vscode-css-languageservice';
import type { DiagnosticIssue, TextRange } from '../scss/diagnostics';
import { knownCssFunctions, propertyRules, type PropertyRule } from './properties';
import { matchesValue } from './syntax/matcher';
import { tokenizeValue, type ValueToken } from './values/tokenizer';
import { unprefixed } from './values/type-matcher';
import { ALL_UNITS } from './values/units';

/**
 * The subset of the CSS parse-tree node API used here. `vscode-css-languageservice` types the
 * parsed stylesheet as an opaque object, so the nodes are described structurally instead.
 */
interface CssNode {
  offset: number;
  getText(): string;
  getChildren(): CssNode[];
  getProperty?(): { getName(): string };
  getValue?(): CssNode | null;
}

/** Strips a trailing `!important`, which is not part of the value. */
const IMPORTANT_RE = /\s*!\s*important\s*$/i;

const languageService = getSCSSLanguageService();

/**
 * True when a token makes the whole value impossible to judge, so no error is reported for it:
 *
 * - a quoted string, which is often assembled from Sass rather than written out by hand;
 * - a vendor-prefixed identifier such as `-webkit-box`, whose keyword set is not in the CSS data;
 * - a dimension with a unit no CSS type uses, which is either a typo or a unit this list does not
 *   know yet;
 * - a call to a function this property's syntax accepts (the syntax can judge it), or to a function
 *   known elsewhere (`knownFunctions`, plus every function the CSS data mentions). A call to a name
 *   none of those know cannot come from Sass either, so it is judged as an ordinary value and
 *   reported when the property does not accept it.
 */
function isUndecidable(
  token: ValueToken,
  rule: PropertyRule,
  knownFunctions: ReadonlySet<string>,
): boolean {
  switch (token.kind) {
    case 'string':
      return true;
    case 'ident':
      return token.name.startsWith('-');
    case 'dimension':
      return !ALL_UNITS.has(token.unit ?? '');
    case 'function': {
      if (rule.mode !== 'syntax') return true;

      const name = unprefixed(token.name);

      if (rule.functions.has(name)) return false;

      return knownCssFunctions().has(name) || knownFunctions.has(name);
    }
    default:
      return false;
  }
}

/**
 * True when `tokens` is an acceptable value for `rule`. A single bare identifier is checked against
 * the property's keyword set first, because the CSS data documents values the value definition
 * syntax no longer lists (legacy and vendor-prefixed ones such as `optimizeSpeed` or `invert`); the
 * data is the source of truth, so it is never contradicted. In keyword mode anything that is not a
 * single bare identifier cannot be judged, so it is accepted.
 */
function isAccepted(rule: PropertyRule, tokens: ValueToken[]): boolean {
  const only = tokens[0];
  const single = tokens.length === 1 ? only : undefined;

  // A leading dash means a vendor-prefixed keyword, which is never worth flagging.
  if (single?.kind === 'ident' && (single.name.startsWith('-') || rule.keywords.has(single.name))) {
    return true;
  }

  if (rule.mode === 'syntax') return matchesValue(rule.ast, tokens);

  return single?.kind !== 'ident';
}

/**
 * Visits every declaration of the document in source order. Both the value checker and the range
 * collector read the stylesheet through here, so they always agree on what a declaration is.
 */
function eachDeclaration(
  text: string,
  visit: (propertyName: string, value: CssNode) => void,
): void {
  const document = TextDocument.create('file:///property-value-check.scss', 'scss', 0, text);
  const stylesheet = languageService.parseStylesheet(document) as unknown as CssNode;

  const walk = (node: CssNode): void => {
    const property = typeof node.getProperty === 'function' ? node.getProperty() : undefined;
    const value = typeof node.getValue === 'function' ? node.getValue() : null;

    if (property && value) visit(property.getName(), value);

    for (const child of node.getChildren()) walk(child);
  };

  walk(stylesheet);
}

/** The value text of a declaration, with a trailing `!important` removed and whitespace trimmed. */
function measureValue(value: CssNode): { text: string; start: number } {
  const raw = value.getText().replace(IMPORTANT_RE, '');

  return { text: raw.trim(), start: value.offset + (raw.length - raw.trimStart().length) };
}

/**
 * Offset ranges of every declaration value in the document. Checks that apply to SassScript use
 * them to stay out of property values, which `findUnknownPropertyValues` already covers.
 */
export function declarationValueRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];

  eachDeclaration(text, (_propertyName, value) => {
    const measured = measureValue(value);

    if (measured.text.length === 0) return;

    ranges.push({ start: measured.start, end: measured.start + measured.text.length });
  });

  return ranges;
}

/**
 * Finds declarations whose value the property does not accept, for example `display: flexx` or
 * `color: notacolor`. A value that holds a variable, interpolation, or any token `isUndecidable`
 * rejects is skipped, and so are properties whose syntax this checker cannot judge.
 *
 * `knownFunctions` names the functions the project defines, so a call such as `casing()` is not
 * mistaken for a typo when the property's own syntax does not mention the function.
 */
export function findUnknownPropertyValues(
  text: string,
  knownFunctions: ReadonlySet<string> = new Set(),
): DiagnosticIssue[] {
  const rules = propertyRules();

  if (rules.size === 0) return [];

  const issues: DiagnosticIssue[] = [];

  eachDeclaration(text, (propertyName, value) => {
    const rule = rules.get(propertyName.toLowerCase());

    if (!rule) return;

    const measured = measureValue(value);

    if (measured.text.length === 0) return;

    const { tokens, dynamic } = tokenizeValue(measured.text);
    const decidable =
      tokens.length > 0 && tokens.every((token) => !isUndecidable(token, rule, knownFunctions));

    if (dynamic || !decidable || isAccepted(rule, tokens)) return;

    issues.push({
      start: measured.start,
      end: measured.start + measured.text.length,
      message: `Unknown value '${measured.text}' for property '${propertyName}'.`,
    });
  });

  return issues;
}
