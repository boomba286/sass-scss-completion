import { findModuleIssues, findUndefinedVariables, moduleIssueKind } from '../engine';
import { createEngineRule } from '../utils/createRule';

export const ruleName = 'sass-scss/no-undefined-variable';

// The engine understands the Sass scopes (`@if`/`@for`/`@each`/`@while`, mixin and function
// bodies), so a variable declared later in the same scope, or outside the block that uses it, is
// reported against the position of the use. Variables a module brings into scope with
// `@use '...' as *` are accepted, and `ns.$name` through a module the document loads with `@use` is
// checked against the names that module exports.
export default createEngineRule({
  ruleName,
  anchor: 'sass-scssno-undefined-variable',
  run: (text, context) => [
    ...findUndefinedVariables(text, context.globalVariables),
    ...findModuleIssues(text, context.modules).filter(
      (issue) => moduleIssueKind(issue.message) === 'undefined-variable',
    ),
  ],
});
