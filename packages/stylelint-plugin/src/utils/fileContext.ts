// The cross-file inputs a rule needs for one document.
//
// A stylelint rule sees one file at a time, while the engine the extension uses judges a document
// against the modules it loads. This module closes the gap: it resolves the `@use` statements in the
// text to real files and reads the members they export, so the rules can check calls through a
// workspace module and accept members loaded with `@use '...' as *`.

import { globSync } from 'tinyglobby';
import { BUILTIN_VARIABLES, listBuiltinMembers } from '~/scss/builtin-modules';
import type { SignatureKind } from '~/scss/core';
import type { ModuleMember, ModuleMembers } from '~/scss/diagnostics';
import type { ModuleExports } from '~/scss/members';
import { builtinModuleId, parseUseStatements } from '~/scss/modules';
import { customPropertyNames, exportsOf, resolveModulePath } from './fileIndex';

/** Everything a rule needs to judge a document against the modules it loads. */
export interface FileContext {
  /** Workspace modules loaded with `@use ... as <namespace>`, keyed by namespace. */
  modules: Map<string, ModuleMembers>;
  /** `$variables` brought into scope by `@use '...' as *`. */
  globalVariables: Set<string>;
  /** Function names brought into scope by `@use '...' as *`. */
  globalFunctions: Set<string>;
}

const EMPTY: FileContext = {
  modules: new Map(),
  globalVariables: new Set(),
  globalFunctions: new Set(),
};

/** Indexes one kind of signature by name, keeping the parameter lists the checks need. */
function memberIndex(exports: ModuleExports, kind: SignatureKind): Map<string, ModuleMember> {
  const members = new Map<string, ModuleMember>();

  for (const signature of exports.functions) {
    if (signature.kind !== kind) continue;

    members.set(signature.name, { params: signature.params, required: new Set(signature.required) });
  }

  return members;
}

/** A module's exports in the shape the module checks take. */
function toMembers(exports: ModuleExports): ModuleMembers {
  return {
    functions: memberIndex(exports, 'function'),
    mixins: memberIndex(exports, 'mixin'),
    variables: new Set(exports.variables),
  };
}

/** Adds the members a built-in module puts in scope for `@use 'sass:<module>' as *`. */
function addBuiltinGlobals(
  moduleId: string,
  variables: Set<string>,
  functions: Set<string>,
): void {
  for (const variable of BUILTIN_VARIABLES[moduleId] ?? []) variables.add(variable.name);

  for (const member of listBuiltinMembers(moduleId)) {
    if (member.kind === 'function') functions.add(member.name);
  }
}

/**
 * Resolves the `@use` statements in `text` against `filePath`. Built-in namespaces are left to the
 * missing-arguments check, which already knows their members; only workspace modules and `as *`
 * loads are collected here. A module whose re-exports could not all be followed is left out, so
 * reporting never flags a member that a file the index failed to reach might declare.
 */
export function buildFileContext(text: string, filePath: string | null): FileContext {
  if (filePath === null) return EMPTY;

  const modules = new Map<string, ModuleMembers>();
  const globalVariables = new Set<string>();
  const globalFunctions = new Set<string>();

  for (const use of parseUseStatements(text)) {
    const moduleId = builtinModuleId(use.url);

    if (moduleId) {
      if (use.global) addBuiltinGlobals(moduleId, globalVariables, globalFunctions);
      continue;
    }

    const resolved = resolveModulePath(use.url, filePath);

    if (resolved === null) continue;

    const exports = exportsOf(resolved);

    if (!exports.complete) continue;

    if (use.global) {
      for (const name of exports.variables) globalVariables.add(name);

      for (const signature of exports.functions) {
        if (signature.kind === 'function') globalFunctions.add(signature.name);
      }

      continue;
    }

    if (use.namespace === null) continue;

    modules.set(use.namespace, toMembers(exports));
  }

  return { modules, globalVariables, globalFunctions };
}

/**
 * The custom property names declared in the files matching `patterns`. Patterns are globs resolved
 * from the working directory, the base stylelint resolves configs and file arguments against.
 */
export function referenceCustomProperties(patterns: readonly string[]): Set<string> {
  if (patterns.length === 0) return new Set();

  return customPropertyNames(globSync([...patterns], { absolute: true, onlyFiles: true }));
}
