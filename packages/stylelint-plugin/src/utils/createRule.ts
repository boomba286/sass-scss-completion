// Builds a stylelint rule around the engine.
//
// Every check in the engine takes the stylesheet text and returns issues as `{ start, end,
// message, severity? }`, with the offsets measured from the start of the document. A rule here
// passes the document text in and maps each issue onto the postcss root node, whose offsets are
// also document-absolute, so no line/column conversion is needed.
//
// A rule also receives a `FileContext`, which resolves the `@use` statements of the document to the
// files they name, so checks that cross files behave as they do in the editor. When stylelint lints
// a string with no file name, there is nothing to resolve against and the context is empty; the
// rules then judge the document alone.

import stylelint from 'stylelint';
import type { Rule } from 'stylelint';
import type { DiagnosticIssue } from '../engine';
import { buildFileContext, type FileContext } from './fileContext';

/** Base URL the rule metadata links to, one anchor per rule in the package README. */
const DOCS_BASE =
  'https://github.com/boomba286/sass-scss-completion/tree/main/packages/stylelint-plugin#';

export interface EngineRuleOptions {
  /** The rule name, as written in a stylelint config. */
  ruleName: string;
  /** Anchor in the package README that documents the rule. */
  anchor: string;
  /** Secondary options the rule accepts, each with a validator for its values. */
  secondary?: Record<string, ((value: unknown) => boolean)[]>;
  /** Runs the engine and returns the issues to report. */
  run: (
    text: string,
    context: FileContext,
    secondary: Readonly<Record<string, unknown>>,
  ) => readonly DiagnosticIssue[];
}

export function createEngineRule(options: EngineRuleOptions): Rule {
  const messages = stylelint.utils.ruleMessages(options.ruleName, {
    // The engine already produces the full message, so the rule only forwards it. stylelint
    // appends the rule name to whatever is reported, which keeps the message consistent.
    rejected: (message: string) => message,
  });

  const rule = (primary: unknown, secondary: unknown, _context: unknown) => {
    return (root: import('postcss').Root, result: import('stylelint').PostcssResult): void => {
      const valid = stylelint.utils.validateOptions(
        result,
        options.ruleName,
        { actual: primary, possible: [true] },
        { actual: secondary, possible: options.secondary ?? {}, optional: true },
      );

      if (!valid) return;

      const text = root.source?.input.css;

      if (typeof text !== 'string') return;

      const context = buildFileContext(text, root.source?.input.file ?? null);
      const secondaryOptions = (secondary ?? {}) as Readonly<Record<string, unknown>>;

      for (const issue of options.run(text, context, secondaryOptions)) {
        stylelint.utils.report({
          message: messages.rejected,
          messageArgs: [issue.message],
          node: root,
          index: issue.start,
          endIndex: issue.end,
          severity: issue.severity,
          result,
          ruleName: options.ruleName,
        });
      }
    };
  };

  return Object.assign(rule, {
    ruleName: options.ruleName,
    messages,
    meta: { url: `${DOCS_BASE}${options.anchor}` },
  }) as Rule;
}
