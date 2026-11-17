// The diagnostic rules a project can turn off or report as a warning, and how the
// `sass-scss-completion.rules` setting resolves each one. Independent of the VS Code API.
//
// The names match the rules the `@boomba286/stylelint-plugin-sass-scss` package exposes, so a
// project keeps one vocabulary across the editor and the command line. A rule left out of the
// setting keeps the severity its own issues carry, which is what the extension does today.

/** A check whose problems the editor reports. */
export const DIAGNOSTIC_RULES = [
  'missing-required-arguments',
  'no-undefined-function',
  'no-undefined-variable',
  'no-undefined-custom-property',
  'property-value-no-unknown',
] as const;

export type DiagnosticRule = (typeof DIAGNOSTIC_RULES)[number];

const RULE_NAMES = new Set<string>(DIAGNOSTIC_RULES);

/** What a `rules` entry can ask for. `warn` and `error` override the rule's own severity. */
export type RuleSetting = 'off' | 'warn' | 'error';

const SETTING_VALUES = new Set<string>(['off', 'warn', 'error']);

/**
 * Reads the raw `sass-scss-completion.rules` setting: a map from a rule name to `off`, `warn`, or
 * `error`. A name no rule has, or a value that is not one of the three, is ignored, so a typo in
 * `settings.json` leaves the rule at its default rather than silencing it.
 */
export function parseRuleSettings(raw: unknown): Map<DiagnosticRule, RuleSetting> {
  const settings = new Map<DiagnosticRule, RuleSetting>();

  if (typeof raw !== 'object' || raw === null) return settings;

  for (const [name, value] of Object.entries(raw)) {
    if (!RULE_NAMES.has(name)) continue;
    if (typeof value !== 'string' || !SETTING_VALUES.has(value)) continue;

    settings.set(name as DiagnosticRule, value as RuleSetting);
  }

  return settings;
}

/**
 * The state a rule runs in: the `off`/`warn`/`error` the setting names, or, when it names none,
 * the `inherent` severity the rule's own issues carry.
 */
export function resolveRuleState(
  rule: DiagnosticRule,
  settings: ReadonlyMap<DiagnosticRule, RuleSetting>,
  inherent: 'error' | 'warning',
): 'off' | 'error' | 'warning' {
  const setting = settings.get(rule);

  if (setting === 'off') return 'off';
  if (setting === 'warn') return 'warning';
  if (setting === 'error') return 'error';

  return inherent;
}
