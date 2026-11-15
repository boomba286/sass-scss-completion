// Pure logic for finding errors in a document (missing required arguments, undefined variables). Independent of the VS Code API.

import { extractSignatures, keywordArgumentName, splitTopLevel } from './core';
import {
  findBuiltinFunction,
  missingRequiredParams,
  parseSassModuleNamespaces,
} from './builtin-modules';

/** Finds the start position of a `namespace.name(` call. */
const CALL_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)\s*\(/g;

/** Finds `$name` references/declarations. */
const VARIABLE_RE = /\$([A-Za-z0-9_-]+)/g;

export interface DiagnosticIssue {
  /** Start offset within the document. */
  start: number;
  /** End offset within the document. */
  end: number;
  message: string;
}

/**
 * Creates a copy in which the insides of strings/comments are overwritten with spaces.
 * The length is preserved so offsets stay valid, and scanning this copy filters out
 * fake calls that appear inside strings or comments.
 */
export function maskNonCode(text: string): string {
  const chars = text.split('');
  const length = text.length;
  let i = 0;

  while (i < length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '/') {
      while (i < length && text[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < length && !(text[i] === '*' && text[i + 1] === '/')) {
        chars[i] = ' ';
        i += 1;
      }
      if (i < length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      chars[i] = ' ';
      i += 1;
      while (i < length && text[i] !== quote) {
        if (text[i] === '\\') {
          chars[i] = ' ';
          i += 1;
        }
        if (i < length) {
          chars[i] = ' ';
          i += 1;
        }
      }
      if (i < length) {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }

    i += 1;
  }

  return chars.join('');
}

/** Index of the `)` matching the `(` at `openParen`. Returns -1 if none. */
function findCloseParen(masked: string, openParen: number): number {
  let depth = 0;

  for (let i = openParen; i < masked.length; i += 1) {
    const ch = masked[i];

    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/** Counts positional arguments and the set of keyword arguments in the argument text. */
export function analyzeArgs(argText: string): { positional: number; keywords: Set<string> } {
  const keywords = new Set<string>();
  let positional = 0;

  for (const part of splitTopLevel(argText)) {
    const trimmed = part.trim();

    if (!trimmed) continue;

    const keyword = keywordArgumentName(trimmed);

    if (keyword !== null) {
      keywords.add(keyword);
      continue;
    }

    positional += 1;
  }

  return { positional, keywords };
}

/**
 * Finds built-in module calls in the text that are missing required arguments.
 * Only calls whose namespace is declared via `@use 'sass:<module>'` are considered.
 * Calls with unclosed parentheses (still being typed) are skipped.
 */
export function findMissingRequiredArgs(text: string): DiagnosticIssue[] {
  const namespaces = parseSassModuleNamespaces(text);

  if (namespaces.size === 0) return [];

  const masked = maskNonCode(text);
  const issues: DiagnosticIssue[] = [];
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CALL_RE.exec(masked)) !== null) {
    const namespace = match[1];
    const name = match[2];
    const moduleId = namespaces.get(namespace);

    if (!moduleId) continue;

    const entry = findBuiltinFunction(moduleId, name);

    if (!entry) continue;

    const openParen = match.index + match[0].length - 1;
    const closeParen = findCloseParen(masked, openParen);

    if (closeParen === -1) continue;

    const { positional, keywords } = analyzeArgs(text.slice(openParen + 1, closeParen));
    const missing = missingRequiredParams(entry, positional, keywords);

    if (missing.length === 0) continue;

    issues.push({
      start: match.index,
      end: closeParen + 1,
      message: `Missing required argument(s) ${missing
        .map((param) => `$${param}`)
        .join(', ')} in the call to ${namespace}.${name}.`,
    });
  }

  return issues;
}

/** Collects variable names considered defined in the document (local declarations, parameters, loop variables). */
function collectDefinedVariables(masked: string): Set<string> {
  const defined = new Set<string>();

  // Local variable declarations `$name:` (only when preceded by start-of-statement, newline, `;`, or `{`).
  for (const match of masked.matchAll(/(?:^|[\n;{])\s*\$([A-Za-z0-9_-]+)\s*:/g)) {
    defined.add(match[1]);
  }

  // `@function` / `@mixin` parameters.
  for (const signature of extractSignatures(masked)) {
    for (const param of signature.params) defined.add(param);
  }

  // `@each $a, $b in ...` loop variables.
  for (const match of masked.matchAll(/@each\s+((?:\$[A-Za-z0-9_-]+\s*,?\s*)+)in\b/g)) {
    for (const variable of match[1].matchAll(/\$([A-Za-z0-9_-]+)/g)) defined.add(variable[1]);
  }

  // `@for $i from ...` loop variables.
  for (const match of masked.matchAll(/@for\s+\$([A-Za-z0-9_-]+)\s+from\b/g)) {
    defined.add(match[1]);
  }

  return defined;
}

/**
 * Finds uses of undeclared `$variables` across the whole document (whole-file reference check).
 * Local declarations (`$x:`), function/mixin parameters, and `@each`/`@for` loop variables
 * are treated as definitions; `namespace.$variable` member access and keyword arguments
 * `$name:` are not treated as references.
 * `extraDefined` carries names that are defined outside the file, e.g. variables brought into
 * global scope by `@use '...' as *`.
 */
export function findUndefinedVariables(
  text: string,
  extraDefined: ReadonlySet<string> = new Set(),
): DiagnosticIssue[] {
  const masked = maskNonCode(text);
  const defined = collectDefinedVariables(masked);

  for (const name of extraDefined) defined.add(name);

  const issues: DiagnosticIssue[] = [];

  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_RE.exec(masked)) !== null) {
    const name = match[1];
    const start = match.index;
    const end = start + match[0].length;

    // `ns.$var` is a module variable access, so it is not a target.
    if (start > 0 && masked[start - 1] === '.') continue;

    // `$name:` is a variable declaration or keyword argument, so it is not a reference.
    if (/^\s*:/.test(masked.slice(end))) continue;

    if (defined.has(name)) continue;

    issues.push({ start, end, message: `Used undefined variable $${name}.` });
  }

  return issues;
}
