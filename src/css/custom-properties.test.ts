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

  it('ignores declarations inside comments and strings', () => {
    const text = '.a {\n  /* --commented: 1 */\n  content: "--quoted: 2";\n}';

    expect(extractCustomProperties(text)).toEqual([]);
  });
});

describe('findUndefinedCustomProperties', () => {
  it('reports a use whose name nothing declares as a warning', () => {
    const issues = findUndefinedCustomProperties('.a {\n  color: var(--missing);\n}', new Set());

    expect(issues).toEqual([
      { start: 18, end: 27, message: 'Unknown custom property --missing.', severity: 'warning' },
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

  it('ignores a use inside a comment', () => {
    expect(
      findUndefinedCustomProperties('.a {\n  /* var(--missing) */\n}', new Set()),
    ).toEqual([]);
  });
});
