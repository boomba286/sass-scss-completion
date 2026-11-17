// Re-exports of the analysis engine the VS Code extension already uses.
//
// The engine (`../../src`) is plain TypeScript with no VS Code dependency, so the same functions
// back both the extension's diagnostics and these rules. Nothing here reimplements a check; the
// modules only decide which inputs each rule passes in.

import { knownCssFunctions } from '~/css/properties';
import { DYNAMIC_FUNCTIONS } from '~/css/values/tokenizer';
import { extractSignatures } from '~/scss/core';
import { GLOBAL_FUNCTIONS } from '~/scss/global-functions';

export { declarationValueRanges, findUnknownPropertyValues } from '~/css/diagnostics';
export { extractCustomProperties, findUndefinedCustomProperties } from '~/css/custom-properties';
export {
  findMissingRequiredArgs,
  findModuleIssues,
  findUndefinedFunctions,
} from '~/scss/diagnostics';
export { findUndefinedVariables } from '~/scss/scopes';
export type { DiagnosticIssue, ModuleMembers } from '~/scss/diagnostics';

/**
 * The names a document may call without a namespace, so a call to one is never reported as
 * unknown: the Sass global functions, the plain CSS functions Sass passes through, the functions
 * the compiler resolves itself (`var`, `calc`, …), the functions the document declares, and the
 * functions a module brings into scope with `@use '...' as *` (passed in as `extra`).
 */
export function callableFunctions(text: string, extra: Iterable<string> = []): ReadonlySet<string> {
  const names = new Set<string>([...GLOBAL_FUNCTIONS, ...DYNAMIC_FUNCTIONS, ...knownCssFunctions()]);

  for (const signature of extractSignatures(text)) {
    if (signature.kind === 'function') names.add(signature.name);
  }

  for (const name of extra) names.add(name);

  return names;
}

/**
 * The part of the module check a rule reports. `findModuleIssues` returns one list covering unknown
 * functions, mixins, and variables and missing arguments; each rule keeps only the messages that
 * belong to it, told apart by the message the engine writes for each case.
 */
export type ModuleIssueKind =
  | 'undefined-function'
  | 'undefined-mixin'
  | 'undefined-variable'
  | 'missing-argument';

export function moduleIssueKind(message: string): ModuleIssueKind | null {
  if (message.startsWith('Undefined function ')) return 'undefined-function';
  if (message.startsWith('Undefined mixin ')) return 'undefined-mixin';
  if (message.startsWith('Undefined variable ')) return 'undefined-variable';
  if (message.startsWith('Missing required argument(s) ')) return 'missing-argument';

  return null;
}
