// Sass variable scoping: which `$names` a position can see and which references nothing declares.
// Independent of the VS Code API (Node only).
//
// The reader models dart-sass, as verified against 1.79 and 1.108:
//   - a `{ ... }` block opens a scope; the file itself is the root (global) scope;
//   - a `$name: value` written inside a flow-control block (@if / @else / @each / @for / @while)
//     assigns to the variable of the same name in the block that holds the flow rule, and is local
//     to the flow block when that block does not have the name;
//   - a loop variable (@each / @for) is bound in the loop block and shadows an outer name;
//   - `!global` binds the name in the root scope;
//   - a declaration must come before its use, at every level including the root scope;
//   - a @mixin / @function body runs when it is called, so its parameters and locals stay local
//     and a root declaration counts inside it whatever its position. That last part is a deliberate
//     approximation: dart-sass only sees a global declared before the call, but following call sites
//     would flag the common "declare the global after the mixin, before the include" pattern, so the
//     reader errs toward accepting rather than reporting.
// Two limits are known and accepted: a keyword argument written on its own line (`$name: value` as
// an argument) reads as a declaration, and indented Sass has no braces, so every scope reads as the
// root scope.

import { maskNonCode, type DiagnosticIssue } from './diagnostics';

type ScopeKind = 'root' | 'block' | 'flow' | 'callable';

interface Declaration {
  name: string;
  /** Offset of the `$` in the declaration. */
  at: number;
}

interface Scope {
  kind: ScopeKind;
  parent: Scope | null;
  /** Offset of the `{` that opens the block, or -1 for the root scope. */
  brace: number;
  /** Offset just past the `{` (0 for the root scope). */
  start: number;
  /** Offset of the closing `}` (document length for the root scope). */
  end: number;
  declarations: Declaration[];
}

/** A `$name: value` at the start of a declaration. The leading delimiter keeps keyword arguments out. */
const LOCAL_DECL_RE = /(?:^|[\n;{}])\s*\$([A-Za-z0-9_-]+)\s*:/g;

/** The variables an `@each $a, $b in ...` header binds. */
const EACH_RE = /@each\s+((?:\$[A-Za-z0-9_-]+\s*,?\s*)+)in\b/g;

/** The variable an `@for $i from ...` header binds. */
const FOR_RE = /@for\s+\$([A-Za-z0-9_-]+)\s+from\b/g;

/** The head of an `@mixin` / `@function` signature, up to the `(` of the parameter list. */
const CALLABLE_RE = /@(?:function|mixin)\s+[A-Za-z0-9_-]+\s*\(/g;

/** A `$name` use. */
const VARIABLE_RE = /\$([A-Za-z0-9_-]+)/g;

/** Index just past the `}` matching the interpolation that starts at the `#{` at `hash`. */
export function skipInterpolation(masked: string, hash: number): number {
  let depth = 0;
  let i = hash + 1;

  while (i < masked.length) {
    const ch = masked[i];

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }

  return i;
}

/** The `{` that opens the body of the statement whose header ends at `from`, or -1 when there is none. */
function nextBrace(masked: string, from: number): number {
  let i = from;

  while (i < masked.length) {
    const ch = masked[i];

    if (ch === '#' && masked[i + 1] === '{') {
      i = skipInterpolation(masked, i);
      continue;
    }
    if (ch === '{') return i;
    // Indented Sass has no braces, so the header runs to the end of the document without a body.
    if (ch === '}' || ch === ';') return -1;
    i += 1;
  }

  return -1;
}

/** The kind of block a header opens. */
function classifyHeader(header: string): ScopeKind {
  if (/^\s*@(mixin|function)\b/.test(header)) return 'callable';
  if (/^\s*@(if|else|each|for|while)\b/.test(header)) return 'flow';
  return 'block';
}

/** Builds the scope tree by walking the braces, skipping the braces of `#{ ... }` interpolation. */
function parseScopes(masked: string): { root: Scope; scopes: Scope[] } {
  const root: Scope = {
    kind: 'root',
    parent: null,
    brace: -1,
    start: 0,
    end: masked.length,
    declarations: [],
  };
  const scopes: Scope[] = [root];
  const stack: Scope[] = [root];
  let headerStart = 0;
  let i = 0;

  while (i < masked.length) {
    const ch = masked[i];

    if (ch === '#' && masked[i + 1] === '{') {
      i = skipInterpolation(masked, i);
      continue;
    }
    if (ch === '{') {
      const parent = stack[stack.length - 1] ?? root;
      const scope: Scope = {
        kind: classifyHeader(masked.slice(headerStart, i)),
        parent,
        brace: i,
        start: i + 1,
        end: masked.length,
        declarations: [],
      };

      scopes.push(scope);
      stack.push(scope);
      headerStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      const scope = stack.pop() ?? root;

      scope.end = i;
      headerStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === ';') headerStart = i + 1;
    i += 1;
  }

  return { root, scopes };
}

/** The innermost scope whose body contains `offset`. */
function scopeContaining(scopes: readonly Scope[], offset: number): Scope {
  let best = scopes[0];

  for (const scope of scopes) {
    if (scope.start <= offset && offset < scope.end && scope.start >= best.start) best = scope;
  }

  return best;
}

/** The scope a statement with the given header end opens, falling back to the enclosing scope. */
function scopeAfter(scopes: readonly Scope[], masked: string, headerEnd: number): Scope {
  const brace = nextBrace(masked, headerEnd);

  if (brace !== -1) {
    const opened = scopes.find((scope) => scope.brace === brace);

    if (opened) return opened;
  }

  return scopeContaining(scopes, headerEnd);
}

/** True when the scope itself declares `name` before `at`. */
function ownsBefore(scope: Scope, name: string, at: number): boolean {
  return scope.declarations.some(
    (declaration) => declaration.name === name && declaration.at < at,
  );
}

/** Binds a `$name: value` declaration to the scope dart-sass would put it in. */
function bindDeclaration(root: Scope, scope: Scope, name: string, at: number, global: boolean): void {
  if (global) {
    root.declarations.push({ name, at });
    return;
  }

  // A flow-control block does not shadow a name its own block already holds; it assigns to it.
  const parent = scope.kind === 'flow' ? scope.parent : null;

  if (parent && ownsBefore(parent, name, at)) {
    parent.declarations.push({ name, at });
    return;
  }

  scope.declarations.push({ name, at });
}

/** True when `!global` appears after the `:` of a declaration. */
function hasGlobalFlag(masked: string, from: number): boolean {
  let end = from;

  while (end < masked.length) {
    const ch = masked[end];

    if (ch === ';' || ch === '{' || ch === '}') break;
    end += 1;
  }

  return /!\s*global\b/.test(masked.slice(from, end));
}

/** The `$` offsets that declare a name (signature parameters and loop variables), not a use. */
function collectHeaderDeclarations(
  scopes: readonly Scope[],
  masked: string,
  bind: (scope: Scope, name: string, at: number) => void,
): { skip: Set<number> } {
  const skip = new Set<number>();

  EACH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EACH_RE.exec(masked)) !== null) {
    const group = match[1];
    const base = match.index + match[0].indexOf(group);
    const scope = scopeAfter(scopes, masked, match.index + match[0].length);
    const variable = /\$([A-Za-z0-9_-]+)/g;
    let variableMatch: RegExpExecArray | null;

    while ((variableMatch = variable.exec(group)) !== null) {
      const at = base + variableMatch.index;

      skip.add(at);
      bind(scope, variableMatch[1], at);
    }
  }

  FOR_RE.lastIndex = 0;

  while ((match = FOR_RE.exec(masked)) !== null) {
    const at = match.index + match[0].indexOf('$');
    const scope = scopeAfter(scopes, masked, match.index + match[0].length);

    skip.add(at);
    bind(scope, match[1], at);
  }

  CALLABLE_RE.lastIndex = 0;

  while ((match = CALLABLE_RE.exec(masked)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = findCloseParen(masked, openParen);

    if (closeParen === -1) continue;

    const scope = scopeAfter(scopes, masked, closeParen + 1);
    const params = masked.slice(openParen + 1, closeParen);
    // Only a `$name` that starts a parameter segment declares a name; one in a default value is a use.
    const paramRe = /(?:^|,)\s*\$([A-Za-z0-9_-]+)/g;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRe.exec(params)) !== null) {
      const at = openParen + 1 + paramMatch.index + paramMatch[0].indexOf('$');

      skip.add(at);
      bind(scope, paramMatch[1], at);
    }
  }

  return { skip };
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

interface ScopeModel {
  root: Scope;
  scopes: Scope[];
  /** `$` offsets of header declarations, which are not uses. */
  skip: Set<number>;
  masked: string;
}

/** Parses the masked document into scopes and binds every declaration to the scope dart-sass uses. */
function analyze(masked: string): ScopeModel {
  const { root, scopes } = parseScopes(masked);

  // Signature parameters and loop variables first, so the flow rule below sees them.
  const { skip } = collectHeaderDeclarations(scopes, masked, (scope, name, at) => {
    scope.declarations.push({ name, at });
  });

  const locals: { name: string; at: number; global: boolean }[] = [];

  LOCAL_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LOCAL_DECL_RE.exec(masked)) !== null) {
    const at = match.index + match[0].indexOf('$');

    locals.push({ name: match[1], at, global: hasGlobalFlag(masked, at + match[1].length + 1) });
  }

  locals.sort((a, b) => a.at - b.at);

  for (const local of locals) {
    bindDeclaration(root, scopeContaining(scopes, local.at), local.name, local.at, local.global);
  }

  return { root, scopes, skip, masked };
}

/** True when `scope` or one of its ancestors is a @mixin / @function body. */
function insideCallable(scope: Scope): boolean {
  for (let current: Scope | null = scope; current; current = current.parent) {
    if (current.kind === 'callable') return true;
  }

  return false;
}

/** True when `name` is in scope at `offset`, following dart-sass ordering and scoping. */
function isVisible(model: ScopeModel, name: string, offset: number): boolean {
  const scope = scopeContaining(model.scopes, offset);
  const callable = insideCallable(scope);

  for (let current: Scope | null = scope; current; current = current.parent) {
    for (const declaration of current.declarations) {
      if (declaration.name !== name) continue;
      // A callable runs later, so a root declaration counts whatever its position.
      if (current.kind === 'root' && callable) return true;
      if (declaration.at < offset) return true;
    }
  }

  return false;
}

/** The `$name` uses of the document that nothing declares, in source order. */
export function findUndefinedVariables(
  text: string,
  extraDefined: ReadonlySet<string> = new Set(),
): DiagnosticIssue[] {
  const model = analyze(maskNonCode(text));
  const issues: DiagnosticIssue[] = [];

  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_RE.exec(model.masked)) !== null) {
    const name = match[1];
    const start = match.index;
    const end = start + match[0].length;

    // `ns.$var` is a module member access, and a header declaration is not a use.
    if (start > 0 && model.masked[start - 1] === '.') continue;
    if (model.skip.has(start)) continue;

    // `$name:` is a variable declaration or a keyword argument, so it is not a reference either.
    if (/^\s*:/.test(model.masked.slice(end))) continue;

    if (extraDefined.has(name)) continue;
    if (isVisible(model, name, start)) continue;

    issues.push({
      start,
      end,
      message: `Used undefined variable $${name}.`,
      rule: 'no-undefined-variable',
    });
  }

  return issues;
}

/** The variable names a `$` at `offset` can refer to, for completion. */
export function visibleVariablesAt(
  text: string,
  offset: number,
  extraDefined: ReadonlySet<string> = new Set(),
): string[] {
  const model = analyze(maskNonCode(text));
  const scope = scopeContaining(model.scopes, offset);
  const callable = insideCallable(scope);
  const names = new Set<string>(extraDefined);

  for (let current: Scope | null = scope; current; current = current.parent) {
    for (const declaration of current.declarations) {
      if (current.kind === 'root' && callable) names.add(declaration.name);
      else if (declaration.at < offset) names.add(declaration.name);
    }
  }

  return [...names].sort();
}
