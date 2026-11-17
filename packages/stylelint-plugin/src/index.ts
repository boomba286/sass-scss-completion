// stylelint plugin entry point. The rules reuse the analysis engine behind the Sass/SCSS IntelliSense
// VS Code extension, so an agent or a CI job can surface the same problems the editor
// reports for a stylesheet that is not open in an editor.

import stylelint from 'stylelint';
import missingRequiredArguments from './rules/missing-required-arguments';
import noUndefinedCustomProperty from './rules/no-undefined-custom-property';
import noUndefinedFunction from './rules/no-undefined-function';
import noUndefinedVariable from './rules/no-undefined-variable';
import propertyValueNoUnknown from './rules/property-value-no-unknown';

const rules = [
  propertyValueNoUnknown,
  noUndefinedCustomProperty,
  noUndefinedFunction,
  noUndefinedVariable,
  missingRequiredArguments,
];

export default rules.map((rule) => stylelint.createPlugin(rule.ruleName, rule));
