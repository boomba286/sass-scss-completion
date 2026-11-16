// Names of the Sass functions a stylesheet may call without a namespace.
//
// Curated from the dart-sass sources (the `global` lists in `lib/src/functions/*.dart`, which
// `lib/src/functions.dart` concatenates) and the Sass documentation. Sass keeps these global
// names for backwards compatibility, so code written before the module system may still call
// them, and a diagnostic must never report them as unknown. The module form (`color.adjust`,
// `map.get`, `string.length`, …) is the recommended style, but the global name stays valid.
//
// https://sass-lang.com/documentation/modules/#global-functions

export const GLOBAL_FUNCTIONS: ReadonlySet<string> = new Set([
  // sass:color
  'red',
  'green',
  'blue',
  'mix',
  'rgb',
  'rgba',
  'invert',
  'hue',
  'saturation',
  'lightness',
  'hsl',
  'hsla',
  'grayscale',
  'adjust-hue',
  'lighten',
  'darken',
  'saturate',
  'desaturate',
  'opacify',
  'fade-in',
  'transparentize',
  'fade-out',
  'alpha',
  'opacity',
  'color',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'complement',
  'ie-hex-str',
  'adjust-color',
  'scale-color',
  'change-color',

  // sass:list
  'length',
  'nth',
  'set-nth',
  'join',
  'append',
  'zip',
  'index',
  'is-bracketed',
  'list-separator',

  // sass:map
  'map-get',
  'map-merge',
  'map-remove',
  'map-keys',
  'map-values',
  'map-has-key',

  // sass:math
  'abs',
  'ceil',
  'floor',
  'max',
  'min',
  'percentage',
  'random',
  'round',
  'unit',
  'comparable',
  'unitless',

  // sass:meta
  'feature-exists',
  'inspect',
  'type-of',
  'keywords',
  'variable-exists',
  'global-variable-exists',
  'function-exists',
  'mixin-exists',
  'content-exists',
  'module-variables',
  'module-functions',
  'module-mixins',
  'get-function',
  'get-mixin',
  'get-module',
  'load',
  'call',

  // sass:selector
  'is-superselector',
  'simple-selectors',
  'selector-parse',
  'selector-nest',
  'selector-append',
  'selector-extend',
  'selector-replace',
  'selector-unify',

  // sass:string
  'unquote',
  'quote',
  'to-upper-case',
  'to-lower-case',
  'unique-id',
  'str-length',
  'str-insert',
  'str-index',
  'str-slice',

  // Conditional expression, and the boolean word operators. They are operators rather than
  // functions, but the call form (`not($a)`, `and($a, $b)`, `or($a, $b)`) appears in conditions,
  // so it must not be reported as an unknown function either.
  'if',
  'not',
  'and',
  'or',
]);
