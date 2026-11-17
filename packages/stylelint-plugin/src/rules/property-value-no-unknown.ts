import { callableFunctions, findUnknownPropertyValues } from '../engine';
import { createEngineRule } from '../utils/createRule';

export const ruleName = 'sass-scss/property-value-no-unknown';

// The core rule `declaration-property-value-no-unknown` covers a similar ground with css-tree. This
// one judges values against the CSS data shipped with `vscode-css-languageservice` and, unlike the
// core rule, treats a function the project declares as a valid value, so a value such as
// `color: theme(primary)` is not reported as unknown. Enable only one of the two.
//
// A function loaded with `@use '...' as *` is treated as the project's own, so it is accepted too.
export default createEngineRule({
  ruleName,
  anchor: 'sass-scssproperty-value-no-unknown',
  run: (text, context) =>
    findUnknownPropertyValues(text, callableFunctions(text, context.globalFunctions)),
});
