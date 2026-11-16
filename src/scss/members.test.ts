import { describe, expect, it } from 'vitest';
import { collectModuleExports, type ModuleFile, type ModuleSignature } from './members';

/** A file map: every entry gets the empty defaults, so a test states only what it is about. */
function indexed(entries: Record<string, Partial<ModuleFile>>): Map<string, ModuleFile> {
  return new Map(
    Object.entries(entries).map(([filePath, entry]) => [
      filePath,
      { functions: [], variables: [], forwards: [], ...entry },
    ]),
  );
}

function signature(kind: ModuleSignature['kind'], name: string, file: string): ModuleSignature {
  return { kind, name, params: [], required: [], file };
}

/** Resolves `./name` to `/w/name.scss`, but only for the paths a test declares as indexed. */
function resolver(known: readonly string[]) {
  return (url: string): string | null => {
    const candidate = `/w/${url.replace(/^\.\//, '')}.scss`;

    return known.includes(candidate) ? candidate : null;
  };
}

describe('collectModuleExports', () => {
  it('returns the members a file declares itself', () => {
    const files = indexed({ '/w/a.scss': { variables: ['x'] } });

    expect(collectModuleExports('/w/a.scss', files, resolver(['/w/a.scss']))).toEqual({
      functions: [],
      variables: ['x'],
      complete: true,
    });
  });

  it('merges the members of a forwarded file', () => {
    const files = indexed({
      '/w/index.scss': { forwards: ['./tokens'] },
      '/w/tokens.scss': {
        variables: ['spacing'],
        functions: [signature('function', 'scale', '/w/tokens.scss')],
      },
    });

    const exports = collectModuleExports(
      '/w/index.scss',
      files,
      resolver(['/w/index.scss', '/w/tokens.scss']),
    );

    expect(exports.variables).toEqual(['spacing']);
    expect(exports.functions.map((fn) => fn.name)).toEqual(['scale']);
    expect(exports.complete).toBe(true);
  });

  it('follows a chain of forwards and keeps one copy of a repeated member', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./b'], variables: ['one'] },
      '/w/b.scss': { forwards: ['./c'], variables: ['one', 'two'] },
      '/w/c.scss': { variables: ['three'] },
    });

    const exports = collectModuleExports(
      '/w/a.scss',
      files,
      resolver(['/w/a.scss', '/w/b.scss', '/w/c.scss']),
    );

    expect(exports.variables).toEqual(['one', 'two', 'three']);
  });

  it('keeps a function and a mixin that share a name', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./b'] },
      '/w/b.scss': {
        functions: [
          signature('function', 'box', '/w/b.scss'),
          signature('mixin', 'box', '/w/b.scss'),
        ],
      },
    });

    const exports = collectModuleExports('/w/a.scss', files, resolver(['/w/a.scss', '/w/b.scss']));

    expect(exports.functions.map((fn) => fn.kind)).toEqual(['function', 'mixin']);
  });

  it('follows a forwarding chain of any depth', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./b'], variables: ['a'] },
      '/w/b.scss': { forwards: ['./c'], functions: [signature('function', 'b', '/w/b.scss')] },
      '/w/c.scss': { forwards: ['./d'], variables: ['c'] },
      '/w/d.scss': { variables: ['d'] },
    });

    const exports = collectModuleExports(
      '/w/a.scss',
      files,
      resolver(['/w/a.scss', '/w/b.scss', '/w/c.scss', '/w/d.scss']),
    );

    expect(exports.variables).toEqual(['a', 'c', 'd']);
    expect(exports.functions.map((fn) => fn.name)).toEqual(['b']);
    expect(exports.complete).toBe(true);
  });

  it('merges a file reached through two forward paths only once', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./b', './c'] },
      '/w/b.scss': { forwards: ['./d'] },
      '/w/c.scss': { forwards: ['./d'] },
      '/w/d.scss': {
        variables: ['d'],
        functions: [signature('function', 'dfun', '/w/d.scss')],
      },
    });

    const exports = collectModuleExports(
      '/w/a.scss',
      files,
      resolver(['/w/a.scss', '/w/b.scss', '/w/c.scss', '/w/d.scss']),
    );

    expect(exports.variables).toEqual(['d']);
    expect(exports.functions.map((fn) => fn.name)).toEqual(['dfun']);
  });

  it('reports an incomplete list when a forward cannot be resolved', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./missing'], variables: ['x'] },
    });

    const exports = collectModuleExports('/w/a.scss', files, resolver(['/w/a.scss']));

    expect(exports.variables).toEqual(['x']);
    expect(exports.complete).toBe(false);
  });

  it('terminates on a forwarding cycle and still merges both files', () => {
    const files = indexed({
      '/w/a.scss': { forwards: ['./b'], variables: ['a'] },
      '/w/b.scss': { forwards: ['./a'], variables: ['b'] },
    });

    const exports = collectModuleExports('/w/a.scss', files, resolver(['/w/a.scss', '/w/b.scss']));

    expect(exports.variables).toEqual(['a', 'b']);
    expect(exports.complete).toBe(true);
  });

  it('reports an empty, incomplete result for a file that is not indexed', () => {
    expect(collectModuleExports('/w/missing.scss', indexed({}), resolver([]))).toEqual({
      functions: [],
      variables: [],
      complete: false,
    });
  });
});
