import { extractCustomProperties, findUndefinedCustomProperties } from '../engine';
import { createEngineRule } from '../utils/createRule';
import { referenceCustomProperties } from '../utils/fileContext';

export const ruleName = 'sass-scss/no-undefined-custom-property';

/**
 * True for one `referenceFiles` entry. The option is a list of glob patterns, so a non-string entry
 * is rejected by stylelint's option validation rather than silently ignored.
 */
function isPattern(value: unknown): boolean {
  return typeof value === 'string';
}

/** The `referenceFiles` patterns, read from the rule's secondary options. */
function patterns(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

// The compiler accepts a `var(--name)` whose name nothing declares, so the engine marks these as
// warnings rather than errors. A name built with interpolation (`var(--a#{$x})`) is left alone.
//
// Declarations in the document itself count, and so do the ones in the files `referenceFiles`
// matches, which covers a project that declares its custom properties in files other than the one
// being linted.
export default createEngineRule({
  ruleName,
  anchor: 'sass-scssno-undefined-custom-property',
  secondary: { referenceFiles: [isPattern] },
  run: (text, _context, secondary) => {
    const declared = new Set([
      ...extractCustomProperties(text),
      ...referenceCustomProperties(patterns(secondary.referenceFiles)),
    ]);

    return findUndefinedCustomProperties(text, declared);
  },
});
