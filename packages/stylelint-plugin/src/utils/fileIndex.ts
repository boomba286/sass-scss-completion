// Node file-system index for the cross-file checks.
//
// The extension builds its index from `vscode.workspace.findFiles`; a stylelint run has no
// workspace API, so this module reads the same data with `node:fs`. It follows only what a document
// actually loads: every `@use`/`@forward` URL is resolved against the file that writes it, using the
// partial (`_name.scss`) and index-file (`name/_index.scss`) conventions. A module that does not
// resolve is simply absent, and the rules skip a module whose re-exports could not all be followed,
// so an unresolvable import never turns into a false positive.

import * as fs from 'node:fs';
import { extractCustomProperties } from '~/css/custom-properties';
import { extractSignatures, extractVariables } from '~/scss/core';
import { collectModuleExports, type ModuleExports, type ModuleFile } from '~/scss/members';
import { moduleFileCandidates, parseForwardUrls } from '~/scss/modules';

/** A file as the index sees it: the members it declares, the URLs it re-exports, its custom properties. */
interface IndexedFile extends ModuleFile {
  customProperties: string[];
}

interface CacheEntry extends IndexedFile {
  mtimeMs: number;
  size: number;
}

/** Parsed files by path, re-parsed only once the file's size or modification time changes. */
const cache = new Map<string, CacheEntry>();

/** Reads and parses one file, or null when it cannot be read. */
function readFile(filePath: string): IndexedFile | null {
  let stat: fs.Stats;

  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const cached = cache.get(filePath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;

  let text: string;

  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const entry: CacheEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    functions: extractSignatures(text).map((signature) => ({ ...signature, file: filePath })),
    variables: extractVariables(text),
    forwards: parseForwardUrls(text),
    customProperties: extractCustomProperties(text),
  };

  cache.set(filePath, entry);

  return entry;
}

/** Resolves a `@use`/`@forward` URL to the file it names, relative to `fromFile`. */
export function resolveModulePath(url: string, fromFile: string): string | null {
  for (const candidate of moduleFileCandidates(url, fromFile)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/** The files reachable from `entry` by following `@forward`, each parsed once. */
function loadGraph(entry: string): Map<string, ModuleFile> {
  const files = new Map<string, ModuleFile>();
  const queue = [entry];

  while (queue.length > 0) {
    const filePath = queue.shift() as string;

    if (files.has(filePath)) continue;

    const file = readFile(filePath);

    if (!file) continue;

    files.set(filePath, file);

    for (const url of file.forwards) {
      const target = resolveModulePath(url, filePath);

      if (target !== null) queue.push(target);
    }
  }

  return files;
}

/** The members a file exports, every `@forward` it reaches already merged in. */
export function exportsOf(filePath: string): ModuleExports {
  return collectModuleExports(filePath, loadGraph(filePath), resolveModulePath);
}

/** The custom property names declared in the given files. */
export function customPropertyNames(filePaths: Iterable<string>): Set<string> {
  const names = new Set<string>();

  for (const filePath of filePaths) {
    const file = readFile(filePath);

    if (!file) continue;

    for (const name of file.customProperties) names.add(name);
  }

  return names;
}
