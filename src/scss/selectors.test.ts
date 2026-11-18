import { describe, expect, it } from 'vitest';
import { extractAttributes } from './selectors';

/** The extracted candidates as `[name, value]` pairs, to compare directly. */
function pairs(text: string): [string, string | null][] {
  return extractAttributes(text).map(({ name, value }) => [name, value]);
}

describe('extractAttributes', () => {
  it('reads class, id, and attribute selectors', () => {
    const source = `
      .btn { color: red; }
      #app { display: block; }
      [data-state="open"] { opacity: 1; }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'btn'],
      ['id', 'app'],
      ['data-state', 'open'],
    ]);
  });

  it('reads an attribute selector that only names the attribute', () => {
    expect(pairs(`[disabled] { opacity: 0.5; }`)).toEqual([['disabled', null]]);
  });

  it('reads the attribute of a suffixed attribute selector', () => {
    expect(pairs(`a[href$=".pdf"]::after { content: "x"; }`)).toEqual([['href', '.pdf']]);
  });

  it('resolves `&__element` against the enclosing block (BEM)', () => {
    const source = `
      .card {
        color: red;

        &:hover { color: blue; }
        &__title { font-weight: bold; }
        &.is-active { color: green; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'card'],
      ['class', 'card__title'],
      ['class', 'is-active'],
    ]);
  });

  it('expands an interpolated name from a fixed variable value', () => {
    const source = `
      $variant: primary;

      .btn-#{$variant} { color: red; }
    `;

    expect(pairs(source)).toEqual([['class', 'btn-primary']]);
  });

  it('raises the expansion to every value of a comma-separated list', () => {
    const source = `
      $variants: primary, secondary;

      .btn-#{$variants} { color: red; }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'btn-primary'],
      ['class', 'btn-secondary'],
    ]);
  });

  it('enumerates the list an @each header walks', () => {
    const source = `
      @each $name in primary, secondary {
        .btn-#{$name} { color: red; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'btn-primary'],
      ['class', 'btn-secondary'],
    ]);
  });

  it('enumerates an @each that walks a declared list variable', () => {
    const source = `
      $sizes: sm, lg;

      @each $size in $sizes {
        .pad-#{$size} { padding: 0; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'pad-sm'],
      ['class', 'pad-lg'],
    ]);
  });

  it('enumerates an @each that walks a space-separated list, one name per item', () => {
    const source = `
      @each $item in 1 2 3 {
        .item-#{$item} { margin: 0; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'item-1'],
      ['class', 'item-2'],
      ['class', 'item-3'],
    ]);
  });

  it('enumerates an @each that walks a map, one name per key', () => {
    const source = `
      $sizes: (sm: 1rem, lg: 2rem);

      @each $name, $value in $sizes {
        .pad-#{$name} { padding: 0; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'pad-sm'],
      ['class', 'pad-lg'],
    ]);
  });

  it('drops an @each whose list is a name that cannot build a selector', () => {
    const source = `
      @each $name in fr. {
        .clr-#{$name} { color: red; }
      }
      .kept { color: red; }
    `;

    // `fr.` is a namespace, not a value, so `clr-...` is not offered; the plain selector stays.
    expect(pairs(source)).toEqual([['class', 'kept']]);
  });

  it('drops a name built from an interpolation nothing fixes', () => {
    const source = `
      .icon-#{$name} { color: red; }
      .kept { color: red; }
    `;

    expect(pairs(source)).toEqual([['class', 'kept']]);
  });

  it('ignores at-rules and their nested selectors are still read', () => {
    const source = `
      @media (min-width: 40em) {
        .wide { display: flex; }
      }

      @include breakpoint {
        .inside { display: none; }
      }
    `;

    expect(pairs(source)).toEqual([
      ['class', 'wide'],
      ['class', 'inside'],
    ]);
  });

  it('does not read selectors out of declarations, strings, or comments', () => {
    const source = `
      // .commented { color: red; }
      .real {
        content: ".string";
        background: url("a.b.png");
        grid-template-columns: [full-start] 1fr;
      }
      /* .blocked { color: red; } */
    `;

    expect(pairs(source)).toEqual([['class', 'real']]);
  });

  it('does not repeat a name that appears in several selectors', () => {
    const source = `
      .btn { color: red; }
      .btn:hover { color: blue; }
      .btn { color: green; }
    `;

    expect(pairs(source)).toEqual([['class', 'btn']]);
  });

  it('reads the comment written directly above a selector', () => {
    const source = `
      // The primary button.
      .btn { color: red; }
    `;

    expect(extractAttributes(source)).toEqual([
      { name: 'class', value: 'btn', comment: 'The primary button.' },
    ]);
  });

  it('joins the lines of a block comment above a selector', () => {
    const source = `
      /* The card.
       * Holds the content. */
      .card { color: red; }
    `;

    expect(extractAttributes(source)).toEqual([
      { name: 'class', value: 'card', comment: 'The card. Holds the content.' },
    ]);
  });

  it('leaves a file header to the file when a blank line follows it', () => {
    const source = `
      // Shared selectors.

      .btn { color: red; }
    `;

    expect(extractAttributes(source)).toEqual([
      { name: 'class', value: 'btn', comment: null },
    ]);
  });
});

describe('extractAttributes with the CSS syntax', () => {
  // A protocol-relative URL holds a `//` that a Sass file would read as a line comment, which would
  // swallow the rest of the line, so the rule it sits in never closes.
  const source = '.icon { background: url(//cdn.example.com/icon.png); } .card { color: red; }';

  it('keeps a `//` inside a value, so the rest of the line stays in the scan', () => {
    expect(extractAttributes(source, 'css').map(({ name, value }) => [name, value])).toEqual([
      ['class', 'icon'],
      ['class', 'card'],
    ]);
  });

  it('reads `//` as a line comment in Sass, dropping the rest of the line', () => {
    expect(extractAttributes(source, 'scss').map(({ name, value }) => [name, value])).toEqual([
      ['class', 'icon'],
    ]);
  });

  it('does not take a `//` line for a comment above a selector', () => {
    const text = '// not a comment\n.plain { color: red; }';

    expect(extractAttributes(text, 'css')).toEqual([
      { name: 'class', value: 'plain', comment: null },
    ]);
  });
});
