// Pure logic for finding errors in a document (missing required arguments, unknown members, undefined functions). Independent of the VS Code API.

import { keywordArgumentName, splitTopLevel } from './core';
import {
  findBuiltinFunction,
  missingRequiredParams,
  parseSassModuleNamespaces,
} from './builtin-modules';
import type { DiagnosticRule } from '../rules';

/** Finds the start position of a `namespace.name(` call. */
const CALL_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)\s*\(/g;

/** Finds `namespace.$name` member variable accesses. */
const MEMBER_VARIABLE_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\.\$([A-Za-z0-9_-]+)/g;

/**
 * How serious a problem is. `warning` marks one the Sass compiler accepts, so it points at
 * something suspicious rather than a build failure; every other issue is an `error`.
 */
export type DiagnosticSeverity = 'error' | 'warning';

export interface DiagnosticIssue {
  /** Start offset within the document. */
  start: number;
  /** End offset within the document. */
  end: number;
  message: string;
  /** The check that found the issue, so a project can turn it off or make it a warning. */
  rule: DiagnosticRule;
  /** Defaults to `error` when omitted. */
  severity?: DiagnosticSeverity;
}

/** A half-open `[start, end)` range of offsets inside the document. */
export interface TextRange {
  start: number;
  end: number;
}

/** The stylesheet syntax a file is written in. Sass adds `//` line comments; plain CSS does not. */
export type StylesheetSyntax = 'scss' | 'css';

export interface MaskOptions {
  /**
   * Whether `//` opens a line comment. Sass has them and plain CSS does not, so reading a `.css`
   * file with `false` keeps a value such as `url(//host/a.png)` intact. Defaults to `true`.
   */
  lineComments?: boolean;
}

/**
 * Creates a copy in which the insides of strings/comments are overwritten with spaces.
 * The length is preserved so offsets stay valid, and scanning this copy filters out
 * fake calls that appear inside strings or comments.
 */
export function maskNonCode(text: string, options: MaskOptions = {}): string {
  const lineComments = options.lineComments ?? true;
  const chars = text.split('');
  const length = text.length;
  let i = 0;

  while (i < length) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComments && ch === '/' && next === '/') {
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
      rule: 'missing-required-arguments',
    });
  }

  return issues;
}

/** A function or mixin exported by a workspace module, as seen by the index. */
export interface ModuleMember {
  /** Parameter names in declaration order. */
  params: readonly string[];
  /** Parameter names that have no default value and are not variadic. */
  required: ReadonlySet<string>;
}

/** The members a workspace module exports, as seen by the index. */
export interface ModuleMembers {
  functions: ReadonlyMap<string, ModuleMember>;
  mixins: ReadonlyMap<string, ModuleMember>;
  variables: ReadonlySet<string>;
}

/** Matches an `@include` keyword directly in front of a call. */
const INCLUDE_RE = /@include\s+$/;

/**
 * Required parameter names the call does not fill. Positional arguments fill parameters from the
 * front, and keyword arguments (`$name:`) fill them by name.
 */
function missingRequiredArgs(
  member: ModuleMember,
  positional: number,
  keywords: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  let filled = 0;

  for (const param of member.params) {
    if (filled < positional) {
      filled += 1;
      continue;
    }

    if (keywords.has(param)) continue;
    if (!member.required.has(param)) continue;

    missing.push(param);
  }

  return missing;
}

/**
 * Finds issues in calls into the workspace modules listed in `modules`: references to members the
 * module does not export (`ns.unknown(...)`, `@include ns.unknown(...)`, `ns.$unknown`), and calls
 * that omit a required argument. Only the namespaces present in `modules` are checked, so the
 * caller decides which `@use`d workspace modules were resolved; built-in namespaces must not be
 * passed in.
 */
export function findModuleIssues(
  text: string,
  modules: ReadonlyMap<string, ModuleMembers>,
): DiagnosticIssue[] {
  if (modules.size === 0) return [];

  const masked = maskNonCode(text);
  const issues: DiagnosticIssue[] = [];

  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CALL_RE.exec(masked)) !== null) {
    const members = modules.get(match[1]);

    if (!members) continue;

    const name = match[2];
    const mixin = INCLUDE_RE.test(masked.slice(0, match.index));
    const openParen = match.index + match[0].length - 1;
    const closeParen = findCloseParen(masked, openParen);

    // Skip a call whose parentheses are not closed yet (still being typed).
    if (closeParen === -1) continue;

    const member = (mixin ? members.mixins : members.functions).get(name);

    if (!member) {
      issues.push({
        start: match.index,
        end: closeParen + 1,
        message: `Undefined ${mixin ? 'mixin' : 'function'} ${match[1]}.${name}.`,
        rule: 'no-undefined-function',
      });
      continue;
    }

    const { positional, keywords } = analyzeArgs(text.slice(openParen + 1, closeParen));
    const missing = missingRequiredArgs(member, positional, keywords);

    if (missing.length === 0) continue;

    issues.push({
      start: match.index,
      end: closeParen + 1,
      message: `Missing required argument(s) ${missing
        .map((param) => `$${param}`)
        .join(', ')} in the call to ${match[1]}.${name}.`,
      rule: 'missing-required-arguments',
    });
  }

  MEMBER_VARIABLE_RE.lastIndex = 0;

  while ((match = MEMBER_VARIABLE_RE.exec(masked)) !== null) {
    const members = modules.get(match[1]);

    if (!members || members.variables.has(match[2])) continue;

    issues.push({
      start: match.index,
      end: match.index + match[0].length,
      message: `Undefined variable ${match[1]}.$${match[2]}.`,
      rule: 'no-undefined-variable',
    });
  }

  return issues;
}

/** Matches an unnamespaced call: a function name with `(` directly after it. */
const FUNCTION_CALL_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\(/g;

/** Keywords directly in front of a call mean the call names a mixin, not a function. */
const MIXIN_CALL_RE = /(?:@include|@mixin|@function)\s+$/;

/** Characters directly in front of a name mean it is not an unnamespaced function call. */
const NOT_A_CALL_PREFIX = new Set(['@', ':', '.']);

/** True when `offset` lies inside one of `ranges`. */
function isInsideRange(offset: number, ranges: readonly TextRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/**
 * Finds calls to functions that nothing defines, in the SassScript parts of a document: variable
 * values, `@return`, conditions, and so on.
 *
 * Two areas are deliberately left out. Property values are covered by
 * `findUnknownPropertyValues`, which judges them against the value definition syntax of the
 * property, so `valueRanges` (see `declarationValueRanges`) keeps this check from reporting the
 * same value twice. Everything that is not an unnamespaced function call is left out too: a
 * pseudo-class (`:not(…)`), an at-rule header (`@media (…)`), a namespaced call (`ns.name(…)`,
 * which `findModuleIssues` handles), and an `@include`/`@mixin`/`@function` header, which names a
 * mixin.
 *
 * `knownFunctions` carries the names that must not be reported: the Sass global functions, the
 * functions the document declares, the functions brought in by `@use '...' as *`, and the plain
 * CSS functions Sass passes through untouched. The caller decides which of those apply.
 */
export function findUndefinedFunctions(
  text: string,
  knownFunctions: ReadonlySet<string>,
  valueRanges: readonly TextRange[] = [],
): DiagnosticIssue[] {
  const masked = maskNonCode(text);
  const issues: DiagnosticIssue[] = [];

  FUNCTION_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FUNCTION_CALL_RE.exec(masked)) !== null) {
    const name = match[1];
    const start = match.index;

    if (knownFunctions.has(name)) continue;
    if (isInsideRange(start, valueRanges)) continue;

    const before = masked.slice(0, start);
    const previous = before[before.length - 1] ?? '';

    if (NOT_A_CALL_PREFIX.has(previous)) continue;
    if (MIXIN_CALL_RE.test(before)) continue;

    const openParen = start + match[0].length - 1;
    const closeParen = findCloseParen(masked, openParen);

    // Skip a call whose parentheses are not closed yet (still being typed).
    if (closeParen === -1) continue;

    issues.push({
      start,
      end: closeParen + 1,
      message: `Undefined function ${name}.`,
      rule: 'no-undefined-function',
    });
  }

  return issues;
}
