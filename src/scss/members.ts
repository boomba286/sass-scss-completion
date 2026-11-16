// Module member collection: what a module exports. Independent of the VS Code API (Node only).

import type { Signature } from './core';

/** A signature together with the file that declares it. */
export interface ModuleSignature extends Signature {
  file: string;
}

/** The members one indexed file declares, plus the URLs it re-exports with `@forward`. */
export interface ModuleFile {
  functions: ModuleSignature[];
  variables: string[];
  /** URLs passed to `@forward`, as written. */
  forwards: string[];
}

/** What a module exports, with everything it re-exports with `@forward` already merged in. */
export interface ModuleExports {
  functions: ModuleSignature[];
  variables: string[];
  /**
   * False when a `@forward` URL could not be resolved, so the member list is known to be
   * incomplete. A caller that reports unknown members must not treat this as the full list.
   */
  complete: boolean;
}

/** Resolves a `@forward` URL to the file path it names, or null when that file is not indexed. */
export type ModuleResolver = (url: string, fromFile: string) => string | null;

const EMPTY: ModuleExports = { functions: [], variables: [], complete: false };

/**
 * Collects the members a module exports: its own declarations plus those of every file it
 * re-exports with `@forward`, resolved recursively. A file reached twice is merged only once, so a
 * forwarding cycle terminates.
 */
export function collectModuleExports(
  filePath: string,
  files: ReadonlyMap<string, ModuleFile>,
  resolve: ModuleResolver,
): ModuleExports {
  return collect(filePath, files, resolve, new Set());
}

function collect(
  filePath: string,
  files: ReadonlyMap<string, ModuleFile>,
  resolve: ModuleResolver,
  visited: Set<string>,
): ModuleExports {
  const file = files.get(filePath);

  if (!file) return EMPTY;
  // Already merged through another path, so its members are in the result already.
  if (visited.has(filePath)) return { functions: [], variables: [], complete: true };

  visited.add(filePath);

  const functions = new Map<string, ModuleSignature>();
  const variables = new Set(file.variables);
  let complete = true;

  for (const signature of file.functions) {
    functions.set(`${signature.kind}:${signature.name}`, signature);
  }

  for (const url of file.forwards) {
    const target = resolve(url, filePath);

    if (target === null) {
      complete = false;
      continue;
    }

    const nested = collect(target, files, resolve, visited);

    if (!nested.complete) complete = false;

    for (const signature of nested.functions) {
      functions.set(`${signature.kind}:${signature.name}`, signature);
    }

    for (const name of nested.variables) variables.add(name);
  }

  return { functions: [...functions.values()], variables: [...variables], complete };
}
