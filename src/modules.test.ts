import { describe, expect, it } from 'vitest';
import {
  builtinModuleId,
  defaultNamespace,
  loadedNamespaces,
  moduleFileCandidates,
  parseUseStatements,
} from './modules';

describe('defaultNamespace', () => {
  it('strips the sass: scheme', () => {
    expect(defaultNamespace('sass:math')).toBe('math');
  });

  it('takes the last path segment and drops partial/extension', () => {
    expect(defaultNamespace('../shared/_list')).toBe('list');
    expect(defaultNamespace('./tokens/colors.scss')).toBe('colors');
  });
});

describe('parseUseStatements', () => {
  it('parses a bare @use with the default namespace', () => {
    expect(parseUseStatements(`@use 'sass:math';`)).toEqual([
      { url: 'sass:math', namespace: 'math', global: false },
    ]);
  });

  it('honors an explicit `as` alias', () => {
    expect(parseUseStatements(`@use 'sass:color' as c;`)).toEqual([
      { url: 'sass:color', namespace: 'c', global: false },
    ]);
  });

  it('marks the `as *` global load', () => {
    expect(parseUseStatements(`@use 'sass:math' as *;`)).toEqual([
      { url: 'sass:math', namespace: null, global: true },
    ]);
  });

  it('parses multiple statements across lines', () => {
    const source = `@use 'sass:math';\n@use './tokens/list' as list;\n`;

    expect(parseUseStatements(source)).toEqual([
      { url: 'sass:math', namespace: 'math', global: false },
      { url: './tokens/list', namespace: 'list', global: false },
    ]);
  });

  it('does not leak state between calls', () => {
    expect(parseUseStatements(`@use 'sass:math';`)).toHaveLength(1);
    expect(parseUseStatements(`@use 'sass:color';`)).toHaveLength(1);
  });
});

describe('loadedNamespaces', () => {
  it('lists namespaces from @use, honoring aliases', () => {
    const source = `@use 'sass:math';\n@use 'sass:color' as c;\n`;

    expect(loadedNamespaces(source)).toEqual([
      { namespace: 'math', url: 'sass:math' },
      { namespace: 'c', url: 'sass:color' },
    ]);
  });

  it('skips the `as *` global load', () => {
    const source = `@use 'sass:math' as *;\n@use 'sass:color';\n`;

    expect(loadedNamespaces(source)).toEqual([{ namespace: 'color', url: 'sass:color' }]);
  });

  it('returns an empty list when there is no @use', () => {
    expect(loadedNamespaces('.a { color: red; }')).toEqual([]);
  });
});

describe('builtinModuleId', () => {
  it('extracts the id for a sass: URL', () => {
    expect(builtinModuleId('sass:map')).toBe('map');
  });

  it('returns null for a workspace URL', () => {
    expect(builtinModuleId('./tokens')).toBeNull();
  });
});

describe('moduleFileCandidates', () => {
  it('prefers the partial and index conventions for the given URL', () => {
    const candidates = moduleFileCandidates('./tokens/list', '/w/a.scss');

    expect(candidates[0]).toBe('/w/tokens/list.scss');
    expect(candidates[1]).toBe('/w/tokens/_list.scss');
    expect(candidates).toContain('/w/tokens/list/_index.scss');
  });
});
