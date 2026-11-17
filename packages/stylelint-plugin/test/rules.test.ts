import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import plugins from '../src/index';

/** Lints a snippet with one of the plugin's rules enabled and returns the reported warnings. */
async function lint(code: string, ruleName: string) {
  const result = await stylelint.lint({
    code,
    config: { plugins, rules: { [ruleName]: true } },
    customSyntax: 'postcss-scss',
  });

  return result.results[0]?.warnings ?? [];
}

/** The fixtures the extension's end-to-end tests use, which the plugin has to agree with. */
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures/workspace');

/** Lints a file, or a snippet named as one, and returns the warnings the rule reports. */
async function lintWith(
  ruleName: string,
  target: { code?: string; files?: string; codeFilename?: string; secondary?: Record<string, unknown> },
) {
  const result = await stylelint.lint({
    ...(target.code === undefined ? {} : { code: target.code }),
    ...(target.files === undefined ? {} : { files: target.files }),
    ...(target.codeFilename === undefined ? {} : { codeFilename: target.codeFilename }),
    config: {
      plugins,
      rules: { [ruleName]: target.secondary ? [true, target.secondary] : true },
    },
    customSyntax: 'postcss-scss',
  });

  return result.results[0]?.warnings ?? [];
}

/** A path inside the fixture workspace. */
function fixture(name: string): string {
  return path.join(WORKSPACE, name);
}

describe('sass-scss/property-value-no-unknown', () => {
  const rule = 'sass-scss/property-value-no-unknown';

  it('reports a value the property does not accept', async () => {
    const warnings = await lint('a { display: flexx; }', rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain("Unknown value 'flexx' for property 'display'");
  });

  it('accepts a value the property accepts', async () => {
    expect(await lint('a { display: flex; }', rule)).toHaveLength(0);
  });

  it('accepts a value built from a Sass variable', async () => {
    expect(await lint('a { display: $display; }', rule)).toHaveLength(0);
  });

  it('accepts a call to a function the document declares', async () => {
    const code = '@function theme($name) { @return $name; }\n\na { color: theme(primary); }';

    expect(await lint(code, rule)).toHaveLength(0);
  });

  it('does not warn when the rule is not enabled', async () => {
    const result = await stylelint.lint({
      code: 'a { display: flexx; }',
      config: { plugins, rules: {} },
      customSyntax: 'postcss-scss',
    });

    expect(result.results[0]?.warnings ?? []).toHaveLength(0);
  });
});

describe('sass-scss/no-undefined-custom-property', () => {
  const rule = 'sass-scss/no-undefined-custom-property';

  it('warns about a var() use nothing declares', async () => {
    const warnings = await lint('a { color: var(--missing); }', rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Unknown custom property --missing');
    expect(warnings[0]?.severity).toBe('warning');
  });

  it('accepts a var() use the document declares', async () => {
    const code = ':root { --brand: red; }\n\na { color: var(--brand); }';

    expect(await lint(code, rule)).toHaveLength(0);
  });
});

describe('sass-scss/no-undefined-function', () => {
  const rule = 'sass-scss/no-undefined-function';

  it('reports a call to a function nothing defines', async () => {
    const warnings = await lint('a { $x: nope(1); }', rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Undefined function nope');
  });

  it('accepts a Sass global function', async () => {
    expect(await lint('a { $x: lighten(#000, 10%); }', rule)).toHaveLength(0);
  });

  it('accepts a function the document declares', async () => {
    const code = '@function double($n) { @return $n * 2; }\n\na { $x: double(2); }';

    expect(await lint(code, rule)).toHaveLength(0);
  });
});

describe('sass-scss/no-undefined-variable', () => {
  const rule = 'sass-scss/no-undefined-variable';

  it('reports a variable nothing declares', async () => {
    const warnings = await lint('a { color: $missing; }', rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Used undefined variable $missing');
  });

  it('accepts a variable declared above the use', async () => {
    expect(await lint('$color: red;\na { color: $color; }', rule)).toHaveLength(0);
  });

  it('reports a loop variable used outside its loop', async () => {
    const code = '@each $name in a, b {\n  .x { color: $name; }\n}\n\na { color: $name; }';
    const warnings = await lint(code, rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Used undefined variable $name');
  });
});

describe('sass-scss/missing-required-arguments', () => {
  const rule = 'sass-scss/missing-required-arguments';

  it('reports a built-in call that omits a required argument', async () => {
    const code = "@use 'sass:map';\n\na { $x: map.get($m); }";
    const warnings = await lint(code, rule);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Missing required argument(s)');
  });

  it('accepts a built-in call with every required argument', async () => {
    const code = "@use 'sass:map';\n\na { $x: map.get($m, key); }";

    expect(await lint(code, rule)).toHaveLength(0);
  });

  it('ignores a namespace that is not a built-in module', async () => {
    const code = "@use './tokens';\n\na { $x: tokens.get($m); }";

    expect(await lint(code, rule)).toHaveLength(0);
  });
});

describe('sass-scss/no-undefined-function across files', () => {
  const rule = 'sass-scss/no-undefined-function';

  it('reports a function and a mixin the module does not export', async () => {
    const warnings = await lintWith(rule, { files: fixture('usage-unknown-member.scss') });

    expect(warnings).toHaveLength(2);

    const text = warnings.map((warning) => warning.text).join('\n');

    expect(text).toContain('Undefined function d.rem2');
    expect(text).toContain('Undefined mixin d.box2');
  });

  it('accepts members the module exports', async () => {
    const code = "@use 'definitions' as d;\n\na { width: d.rem(12); @include d.box(1); }";

    const warnings = await lintWith(rule, { code, codeFilename: fixture('usage-unknown-member.scss') });

    expect(warnings).toHaveLength(0);
  });

  it('accepts a function a module brings into scope with "as *"', async () => {
    const code = "@use 'definitions' as *;\n\na { $x: rem(12); }";

    const warnings = await lintWith(rule, { code, codeFilename: fixture('usage-unknown-member.scss') });

    expect(warnings).toHaveLength(0);
  });
});

describe('sass-scss/no-undefined-variable across files', () => {
  const rule = 'sass-scss/no-undefined-variable';

  it('reports a variable the module does not export', async () => {
    const warnings = await lintWith(rule, { files: fixture('usage-unknown-member.scss') });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Undefined variable d.$missing');
  });
});

describe('sass-scss/missing-required-arguments across files', () => {
  const rule = 'sass-scss/missing-required-arguments';

  it('reports calls that omit an argument the module declares', async () => {
    const warnings = await lintWith(rule, { files: fixture('usage-missing-arg.scss') });

    expect(warnings).toHaveLength(2);

    const text = warnings.map((warning) => warning.text).join('\n');

    expect(text).toContain('Missing required argument(s) $value in the call to d.rem.');
    expect(text).toContain('Missing required argument(s) $width in the call to d.box.');
  });
});

describe('sass-scss/no-undefined-custom-property across files', () => {
  const rule = 'sass-scss/no-undefined-custom-property';

  it('accepts a var() use a file listed in referenceFiles declares', async () => {
    const warnings = await lintWith(rule, {
      code: 'a { color: var(--main-color); }',
      codeFilename: fixture('usage-unknown-member.scss'),
      secondary: { referenceFiles: [fixture('usage-custom-properties.scss')] },
    });

    expect(warnings).toHaveLength(0);
  });

  it('reports a var() use no reference file declares', async () => {
    const warnings = await lintWith(rule, {
      code: 'a { color: var(--nope); }',
      codeFilename: fixture('usage-unknown-member.scss'),
      secondary: { referenceFiles: [fixture('usage-custom-properties.scss')] },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toContain('Unknown custom property --nope');
  });

  it('accepts a glob in referenceFiles', async () => {
    const warnings = await lintWith(rule, {
      code: 'a { color: var(--main-color); }',
      codeFilename: fixture('usage-unknown-member.scss'),
      secondary: { referenceFiles: [path.join(WORKSPACE, '*.scss')] },
    });

    expect(warnings).toHaveLength(0);
  });
});
