import { findMissingRequiredArgs, findModuleIssues, moduleIssueKind } from '../engine';
import { createEngineRule } from '../utils/createRule';

export const ruleName = 'sass-scss/missing-required-arguments';

// Covers calls into the built-in modules (`sass:math`, `sass:map`, …), whose parameter lists are
// known from the data the extension ships, and calls through a workspace module the document loads
// with `@use`, whose files are read from disk.
export default createEngineRule({
  ruleName,
  anchor: 'sass-scssmissing-required-arguments',
  run: (text, context) => [
    ...findMissingRequiredArgs(text),
    ...findModuleIssues(text, context.modules).filter(
      (issue) => moduleIssueKind(issue.message) === 'missing-argument',
    ),
  ],
});
