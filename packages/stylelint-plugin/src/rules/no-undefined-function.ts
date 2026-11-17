import {
  callableFunctions,
  declarationValueRanges,
  findModuleIssues,
  findUndefinedFunctions,
  moduleIssueKind,
} from '../engine';
import { createEngineRule } from '../utils/createRule';

export const ruleName = 'sass-scss/no-undefined-function';

// The kinds `findModuleIssues` reports that name a callable the module does not export.
const CALLABLE_KINDS = new Set(['undefined-function', 'undefined-mixin']);

// Property values are judged by `sass-scss/property-value-no-unknown`, so their ranges are excluded
// here to keep a single unknown value from being reported twice. Calls through a workspace module
// the document loads with `@use` name a callable the same way, so they are reported here too.
export default createEngineRule({
  ruleName,
  anchor: 'sass-scssno-undefined-function',
  run: (text, context) => [
    ...findUndefinedFunctions(
      text,
      callableFunctions(text, context.globalFunctions),
      declarationValueRanges(text),
    ),
    ...findModuleIssues(text, context.modules).filter((issue) =>
      CALLABLE_KINDS.has(moduleIssueKind(issue.message) ?? ''),
    ),
  ],
});
