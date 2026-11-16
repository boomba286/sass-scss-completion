// `@use` statement parsing and module URL→file resolution. Independent of the VS Code API (Node only).

import * as path from 'node:path';

export interface UseStatement {
  /** Raw URL such as `sass:math`, `./foo`, `../bar/list`. */
  url: string;
  /** Namespace (alias or default). Null when `as *`. */
  namespace: string | null;
  /** Whether this is a global `as *` load. */
  global: boolean;
}

const USE_RE = /@use\s+['"]([^'"]+)['"](?:\s+as\s+([A-Za-z0-9_-]+|\*))?/g;

/** Default namespace for a URL (last path segment, with leading `_`/extension removed). */
export function defaultNamespace(url: string): string {
  const cleaned = url.replace(/^sass:/, '');
  const segments = cleaned
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const last = segments[segments.length - 1] ?? cleaned;

  return last.replace(/^_/, '').replace(/\.(scss|sass|css)$/i, '');
}

/** Parses all `@use` statements in the file text in order of appearance. */
export function parseUseStatements(text: string): UseStatement[] {
  const statements: UseStatement[] = [];
  USE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = USE_RE.exec(text)) !== null) {
    const url = match[1];
    const alias = match[2];

    if (alias === '*') {
      statements.push({ url, namespace: null, global: true });
      continue;
    }

    statements.push({ url, namespace: alias ?? defaultNamespace(url), global: false });
  }

  return statements;
}

const FORWARD_RE = /@forward\s+['"]([^'"]+)['"]/g;

/** URLs re-exported with `@forward` in the file text, in order of appearance. */
export function parseForwardUrls(text: string): string[] {
  const urls: string[] = [];
  FORWARD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FORWARD_RE.exec(text)) !== null) urls.push(match[1]);

  return urls;
}

export interface LoadedNamespace {
  namespace: string;
  url: string;
}

/** Namespaces loaded via `@use` (excluding `as *`). Each name is returned only once. */
export function loadedNamespaces(text: string): LoadedNamespace[] {
  const result: LoadedNamespace[] = [];

  for (const use of parseUseStatements(text)) {
    if (!use.namespace) continue;
    if (result.some((entry) => entry.namespace === use.namespace)) continue;

    result.push({ namespace: use.namespace, url: use.url });
  }

  return result;
}

/** Returns the module id if the URL is a built-in module (`sass:xxx`), otherwise null. */
export function builtinModuleId(url: string): string | null {
  const match = url.match(/^sass:([A-Za-z0-9_-]+)$/);

  return match ? match[1] : null;
}

/**
 * Expands the file path candidates the URL may point to, relative to `fromFile`, in priority order.
 * Includes the partial (`_foo.scss`) and index-file (`foo/_index.scss`) conventions.
 */
export function moduleFileCandidates(url: string, fromFile: string): string[] {
  const joined = path.resolve(path.dirname(fromFile), url.replace(/\.(scss|sass|css)$/i, ''));
  const dir = path.dirname(joined);
  const base = path.basename(joined);
  const extensions = ['.scss', '.sass', '.css'];
  const candidates: string[] = [];

  for (const extension of extensions) {
    candidates.push(path.join(dir, `${base}${extension}`));
    candidates.push(path.join(dir, `_${base}${extension}`));
  }

  for (const extension of extensions) {
    candidates.push(path.join(dir, base, `index${extension}`));
    candidates.push(path.join(dir, base, `_index${extension}`));
  }

  return candidates;
}
