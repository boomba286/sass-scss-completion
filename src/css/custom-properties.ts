// CSS custom properties (`--name`): the declarations a stylesheet makes and the uses of `var(--name)`.
// Independent of the VS Code API (Node only).

import {
  maskNonCode,
  type DiagnosticIssue,
  type StylesheetSyntax,
} from '../scss/diagnostics';
import { expand, interpolationValues, readName } from '../scss/interpolation';

/** The start of a custom property declaration: `--` at the start of a statement. */
const DECLARATION_START_RE = /(?:^|[\s;{])--/g;

/** The first argument of a `var(...)` use, up to the `)` or `,` that ends it. */
const USAGE_RE = /(?:^|[^A-Za-z0-9_-])var\(\s*(--[A-Za-z0-9_-]+)/g;

/** The suffix that marks an entry covering every name starting with the text before it. */
const PATTERN_SUFFIX = '*';

/** True when the character at `from`, skipping spaces, is the `:` that makes a declaration. */
function isDeclaration(masked: string, from: number): boolean {
  let i = from;

  while (i < masked.length && /\s/.test(masked[i])) i += 1;

  return masked[i] === ':';
}

/**
 * The custom property names a stylesheet declares, in source order. A declaration is a `--name`
 * followed by `:`; a `var(--name)` use is not one.
 *
 * A name built with interpolation is expanded from the literal values the file fixes (a
 * `$name: ...` declaration, an `@each` list, or a map's keys), so a loop whose list is written in
 * the same file yields its exact names (`--font-size-xl`). When the file only fixes a prefix, such
 * as `--font-size-#{$name}` over a `$font-sizes` map declared in a module it loads, the prefix is
 * returned as a pattern (`--font-size-`) followed by `*`. A pattern stands for every name that
 * starts with it, so a loop publishing names in another file is understood; it is never offered for
 * completion. A plain CSS file is read with the CSS comment rules, where `//` is a value rather
 * than a comment.
 */
export function extractCustomProperties(
  text: string,
  syntax: StylesheetSyntax = 'scss',
): string[] {
  const masked = maskNonCode(text, { lineComments: syntax === 'scss' });
  const values = interpolationValues(masked, text);
  const names: string[] = [];

  DECLARATION_START_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DECLARATION_START_RE.exec(masked)) !== null) {
    const start = match.index + match[0].length - 2;
    const { template, end } = readName(masked, start);

    // `--` alone names nothing, and a declaration needs the `:` after the name.
    if (template.length <= 2 || !isDeclaration(masked, end)) continue;

    const expanded = expand(template, values);

    if (expanded.length > 0) {
      for (const name of expanded) names.push(name);
      continue;
    }

    // An interpolation nothing fixes still leaves the fixed part of the name, which bounds the
    // family of names the declaration can produce. `--#{$name}` fixes only `--`, which names
    // nothing, so it is left out.
    const cut = template.indexOf('#{');

    if (cut > 2) names.push(template.slice(0, cut) + PATTERN_SUFFIX);
  }

  return names;
}

/** True when the name is declared outright, or a declared pattern covers it. */
function isDeclared(name: string, defined: ReadonlySet<string>, patterns: readonly string[]): boolean {
  if (defined.has(name)) return true;

  return patterns.some((prefix) => name.startsWith(prefix));
}

/**
 * Finds `var(--name)` uses whose name nothing declares. `defined` carries the names declared in the
 * workspace and in the document being checked, including the `--prefix*` patterns a loop leaves
 * behind. A name built with interpolation (`var(--a#{$x})`) says nothing fixed, so it is left alone.
 * The compiler accepts an unknown name, so these are warnings rather than errors.
 */
export function findUndefinedCustomProperties(
  text: string,
  defined: ReadonlySet<string>,
): DiagnosticIssue[] {
  const masked = maskNonCode(text);
  const patterns: string[] = [];

  for (const entry of defined) {
    if (entry.endsWith(PATTERN_SUFFIX)) patterns.push(entry.slice(0, -1));
  }

  const issues: DiagnosticIssue[] = [];

  USAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = USAGE_RE.exec(masked)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length - name.length;

    if (masked[start + name.length] === '#') continue;
    if (isDeclared(name, defined, patterns)) continue;

    issues.push({
      start,
      end: start + name.length,
      message: `Unknown custom property ${name}.`,
      rule: 'no-undefined-custom-property',
      severity: 'warning',
    });
  }

  return issues;
}
