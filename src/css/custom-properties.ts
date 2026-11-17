// CSS custom properties (`--name`): the declarations a stylesheet makes and the uses of `var(--name)`.
// Independent of the VS Code API (Node only).

import {
  maskNonCode,
  type DiagnosticIssue,
  type StylesheetSyntax,
} from '../scss/diagnostics';

/** A custom property declaration: a `--name` with `:` after it, at the start of a declaration. */
const DECLARATION_RE = /(?:^|[\s;{])(--[A-Za-z0-9_-]+)\s*:/g;

/** The first argument of a `var(...)` use, up to the `)` or `,` that ends it. */
const USAGE_RE = /(?:^|[^A-Za-z0-9_-])var\(\s*(--[A-Za-z0-9_-]+)/g;

/**
 * The custom property names a stylesheet declares, in source order. A declaration is a `--name`
 * followed by `:`; a `var(--name)` use is not one. A name built with interpolation
 * (`--#{$name}`) declares nothing fixed, so it is left out. A plain CSS file is read with the CSS
 * comment rules, where `//` is a value rather than a comment.
 */
export function extractCustomProperties(
  text: string,
  syntax: StylesheetSyntax = 'scss',
): string[] {
  const masked = maskNonCode(text, { lineComments: syntax === 'scss' });
  const names: string[] = [];

  DECLARATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DECLARATION_RE.exec(masked)) !== null) names.push(match[1]);

  return names;
}

/**
 * Finds `var(--name)` uses whose name nothing declares. `defined` carries the names declared in
 * the workspace and in the document being checked. A name built with interpolation
 * (`var(--a#{$x})`) says nothing fixed, so it is left alone. The compiler accepts an unknown name,
 * so these are warnings rather than errors.
 */
export function findUndefinedCustomProperties(
  text: string,
  defined: ReadonlySet<string>,
): DiagnosticIssue[] {
  const masked = maskNonCode(text);
  const issues: DiagnosticIssue[] = [];

  USAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = USAGE_RE.exec(masked)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length - name.length;

    if (masked[start + name.length] === '#') continue;
    if (defined.has(name)) continue;

    issues.push({
      start,
      end: start + name.length,
      message: `Unknown custom property ${name}.`,
      severity: 'warning',
    });
  }

  return issues;
}
