// Pure logic with no VS Code API dependency. Can be verified as-is in Node.

const IDENT_RE = /[A-Za-z0-9_-]/;

export interface CallSite {
  name: string;
  namespace: string | null;
  openParen: number;
  closeParen: number;
}

export type SignatureKind = 'function' | 'mixin';

export interface Signature {
  kind: SignatureKind;
  name: string;
  params: string[];
  /** Parameter names that have no default value and are not variadic, in declaration order. */
  required: string[];
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_RE.test(ch);
}

/**
 * Finds the innermost function/mixin call enclosing the given offset.
 */
export function findEnclosingCall(text: string, offset: number): CallSite | null {
  let depth = 0;
  let open = -1;

  for (let i = offset - 1; i >= 0; i -= 1) {
    const ch = text[i];

    if (ch === ')') {
      depth += 1;
    } else if (ch === '(') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }

  if (open === -1) return null;

  let j = open - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  const nameEnd = j + 1;
  while (j >= 0 && isIdentChar(text[j])) j -= 1;
  const name = text.slice(j + 1, nameEnd);

  if (!name) return null;

  let namespace: string | null = null;
  let k = j;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;

  if (k >= 0 && text[k] === '.') {
    let m = k - 1;
    while (m >= 0 && /\s/.test(text[m])) m -= 1;
    const nsEnd = m + 1;
    while (m >= 0 && isIdentChar(text[m])) m -= 1;
    const candidate = text.slice(m + 1, nsEnd);
    if (candidate) namespace = candidate;
  }

  let d = 0;
  let close = -1;

  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '(') {
      d += 1;
    } else if (ch === ')') {
      d -= 1;
      if (d === 0) {
        close = i;
        break;
      }
    }
  }

  return { name, namespace, openParen: open, closeParen: close };
}

/** Splits on commas at the top level (outside parentheses/brackets/braces/strings). */
export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

/** A parameter segment that declares a default value, e.g. `$height: 10`. */
const DEFAULT_PARAM_RE = /^\$[A-Za-z0-9_-]+\s*:/;

/** A variadic parameter segment, e.g. `$args...`. */
const VARIADIC_PARAM_RE = /\.\.\.\s*$/;

/** Splits a signature string into parameter names and the subset that cannot be omitted. */
function parseSignatureParams(signature: string): { params: string[]; required: string[] } {
  const params: string[] = [];
  const required: string[] = [];

  for (const part of splitTopLevel(signature)) {
    const match = part.match(/\$([A-Za-z0-9_-]+)/);

    if (!match) continue;

    params.push(match[1]);

    const trimmed = part.trim();
    const optional = DEFAULT_PARAM_RE.test(trimmed) || VARIADIC_PARAM_RE.test(trimmed);

    if (!optional) required.push(match[1]);
  }

  return { params, required };
}

/** Collects all @function / @mixin signatures from the file text. */
export function extractSignatures(text: string): Signature[] {
  const found: Signature[] = [];
  const opener = /@(function|mixin)\s+([A-Za-z0-9_-]+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(text)) !== null) {
    const openParen = match.index + match[0].length - 1;
    let depth = 0;
    let closeParen = -1;

    for (let i = openParen; i < text.length; i += 1) {
      const ch = text[i];

      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParen = i;
          break;
        }
      }
    }

    if (closeParen === -1) continue;

    const signature = text.slice(openParen + 1, closeParen);
    const { params, required } = parseSignatureParams(signature);

    found.push({
      kind: match[1] as SignatureKind,
      name: match[2],
      params,
      required,
    });
  }

  return found;
}

/** Returns the name of a keyword argument (`$name: value`) segment, or null otherwise. */
export function keywordArgumentName(segment: string): string | null {
  const match = segment.match(/^\$([A-Za-z0-9_-]+)\s*:/);

  return match ? match[1] : null;
}

/**
 * Collects keyword-argument names already passed in the argument region, excluding the token under the cursor.
 * Only `$name:` forms count; positional values such as `math.div($a, 2)` are not treated as named parameters.
 */
export function usedParamNames(
  argText: string,
  argStart: number,
  cursorOffset: number,
): Set<string> {
  const used = new Set<string>();
  const re = /\$([A-Za-z0-9_-]+)\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(argText)) !== null) {
    const start = argStart + match.index;
    const end = start + match[0].length;

    if (cursorOffset >= start && cursorOffset <= end) continue;

    used.add(match[1]);
  }

  return used;
}

/** Counts positional arguments among the 'completed' arguments before the cursor. */
export function countPositionalArgs(prefix: string): number {
  const segments = splitTopLevel(prefix).slice(0, -1);
  let count = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (!trimmed) continue;
    if (keywordArgumentName(trimmed) !== null) continue;
    count += 1;
  }

  return count;
}

/**
 * Computes the list of parameter names to suggest at the current position.
 * - Excludes parameters already used by name (deduplication).
 * - Excludes as many leading parameters as have been filled positionally.
 */
export function suggestParams(
  text: string,
  offset: number,
  params: string[],
): string[] | null {
  const call = findEnclosingCall(text, offset);

  if (!call) return null;

  const argStart = call.openParen + 1;
  const regionEnd = call.closeParen === -1 ? text.length : call.closeParen;
  const argText = text.slice(argStart, regionEnd);
  const prefix = argText.slice(0, Math.max(offset - argStart, 0));
  const used = usedParamNames(argText, argStart, offset);
  const positional = countPositionalArgs(prefix);

  return params.filter((name, index) => !used.has(name) && index >= positional);
}

export interface MemberContext {
  /** Namespace of the `namespace.` before the cursor. */
  namespace: string;
  /** Already-typed member prefix (includes `$` for variables). */
  prefix: string;
  /** Whether this is a variable member (`ns.$`). */
  variable: boolean;
}

const MEMBER_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\.(\$?[A-Za-z0-9_-]*)$/;

/** Detects a `namespace.member` (or `namespace.$variable`) pattern immediately before the cursor. */
export function findModuleMemberContext(text: string, offset: number): MemberContext | null {
  const match = text.slice(0, offset).match(MEMBER_RE);

  if (!match) return null;

  const prefix = match[2];

  return { namespace: match[1], prefix, variable: prefix.startsWith('$') };
}

export interface MemberToken {
  /** Namespace of `namespace.member`. */
  namespace: string;
  /** Member name without `$`. */
  name: string;
  /** Whether this is a variable member (`ns.$var`). */
  variable: boolean;
  /** Token start offset. */
  start: number;
  /** Token end offset. */
  end: number;
}

const MEMBER_TOKEN_RE = /([A-Za-z_-][A-Za-z0-9_-]*)\.(\$?)([A-Za-z0-9_-]+)/g;

/** Finds the `namespace.member` (or `namespace.$variable`) token enclosing the offset. */
export function findModuleMemberToken(text: string, offset: number): MemberToken | null {
  MEMBER_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MEMBER_TOKEN_RE.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > offset) break;

    if (offset >= start && offset <= end) {
      return {
        namespace: match[1],
        name: match[3],
        variable: match[2] === '$',
        start,
        end,
      };
    }
  }

  return null;
}

export interface NamespaceContext {
  /** Namespace prefix being typed before the cursor. */
  prefix: string;
  /** Prefix start offset. */
  start: number;
}

/**
 * If the cursor is in a context where a namespace (e.g. `color`) is being typed,
 * returns the prefix and its start position.
 * Returns null immediately after `.`/`$` (member/variable access) or when the prefix is empty.
 */
export function findNamespaceContext(text: string, offset: number): NamespaceContext | null {
  let start = offset;

  while (start > 0 && IDENT_RE.test(text[start - 1])) start -= 1;

  const previous = start > 0 ? text[start - 1] : '';

  if (previous === '.' || previous === '$') return null;

  const prefix = text.slice(start, offset);

  if (!prefix) return null;

  return { prefix, start };
}

/** Collects variable declaration (`$name:`) names from the file text. */
export function extractVariables(text: string): string[] {
  const names = new Set<string>();
  const re = /(^|[\n;{])\s*\$([A-Za-z0-9_-]+)\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) names.add(match[2]);

  return [...names];
}
