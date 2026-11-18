import { describe, expect, it } from 'vitest';
import { extractCustomProperties, findUndefinedCustomProperties } from './custom-properties';

describe('extractCustomProperties', () => {
  it('finds the names declared in a rule', () => {
    const text = [
      ':root {\t',
      '  --main-color: skyblue;',
      '  --basic-padding: 5px 15px;',
      '',
      '}',
    ].join('\n');

    expect(extractCustomProperties(text)).toEqual(['--main-color', '--basic-padding']);
  });

  it('finds a declaration with no space before the colon', () => {
    expect(extractCustomProperties('.a{--gap:4px}')).toEqual(['--gap']);
  });

  it('does not take a var() use for a declaration', () => {
    expect(extractCustomProperties('.a {\n  color: var(--main-color);\n}')).toEqual([]);
  });

  it('leaves out a name built with interpolation', () => {
    expect(extractCustomProperties('.a {\n  --#{$name}: 1;\n}')).toEqual([]);
  });

  it('expands a name a loop over a map publishes', () => {
    const text = [
      '$sizes: (sm: 1rem, lg: 2rem);',
      ':root {',
      '  @each $name, $value in $sizes {',
      '    --size-#{$name}: #{$value};',
      '  }',
      '}',
    ].join('\n');

    expect(extractCustomProperties(text)).toEqual(['--size-sm', '--size-lg']);
  });

  it('expands a name a loop over a flat list publishes', () => {
    const text = [
      '$states: hover, focus;',
      ':root {',
      '  @each $state in $states {',
      '    --bg-#{$state}: red;',
      '  }',
      '}',
    ].join('\n');

    expect(extractCustomProperties(text)).toEqual(['--bg-hover', '--bg-focus']);
  });

  it('expands a name a loop over an inline list publishes', () => {
    expect(
      extractCustomProperties(':root { @each $size in sm, lg { --pad-#{$size}: 1rem; } }'),
    ).toEqual(['--pad-sm', '--pad-lg']);
  });

  it('records the fixed prefix of an interpolation the file does not fix', () => {
    expect(extractCustomProperties(':root {\n  --font-size-#{$name}: 1;\n}')).toEqual([
      '--font-size-*',
    ]);
  });

  it('ignores declarations inside comments and strings', () => {
    const text = '.a {\n  /* --commented: 1 */\n  content: "--quoted: 2";\n}';

    expect(extractCustomProperties(text)).toEqual([]);
  });

  it('keeps a `//` inside a value when the file is plain CSS', () => {
    const text = '.icon { background: url(//cdn.example.com/icon.png); } :root { --gap: 4px; }';

    expect(extractCustomProperties(text, 'css')).toEqual(['--gap']);
  });
});

describe('findUndefinedCustomProperties', () => {
  it('reports a use whose name nothing declares as a warning', () => {
    const issues = findUndefinedCustomProperties('.a {\n  color: var(--missing);\n}', new Set());

    expect(issues).toEqual([
      {
        start: 18,
        end: 27,
        message: 'Unknown custom property --missing.',
        rule: 'no-undefined-custom-property',
        severity: 'warning',
      },
    ]);
  });

  it('accepts a declared name and the fallback of a use', () => {
    const text = '.a {\n  padding: var(--gap, 4px);\n  color: var(--gap);\n}';

    expect(findUndefinedCustomProperties(text, new Set(['--gap']))).toEqual([]);
  });

  it('reports a use nested in the fallback of another use', () => {
    const issues = findUndefinedCustomProperties(
      '.a {\n  color: var(--a, var(--b));\n}',
      new Set(['--a']),
    );

    expect(issues.map((issue) => issue.message)).toEqual(['Unknown custom property --b.']);
  });

  it('leaves out a name built with interpolation', () => {
    expect(findUndefinedCustomProperties('.a {\n  color: var(--x#{$i});\n}', new Set())).toEqual([]);
  });

  it('accepts a name a declared pattern covers', () => {
    expect(
      findUndefinedCustomProperties(
        '.a {\n  color: var(--font-size-xl);\n}',
        new Set(['--font-size-*']),
      ),
    ).toEqual([]);
  });

  it('reports a name outside every declared pattern', () => {
    expect(
      findUndefinedCustomProperties(
        '.a {\n  color: var(--font-siz-xl);\n}',
        new Set(['--font-size-*']),
      ),
    ).toEqual([
      {
        start: 18,
        end: 31,
        message: 'Unknown custom property --font-siz-xl.',
        rule: 'no-undefined-custom-property',
        severity: 'warning',
      },
    ]);
  });

  it('ignores a use inside a comment', () => {
    expect(
      findUndefinedCustomProperties('.a {\n  /* var(--missing) */\n}', new Set()),
    ).toEqual([]);
  });
});
