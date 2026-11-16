// Metadata and lookup logic for Sass built-in module functions/mixins. A pure module with no VS Code API dependency.
// Parameter names/descriptions/defaults/examples are curated from the official docs (https://sass-lang.com/documentation/modules/)
// and `.agents/skills/sass-built-in-modules/references/*.md`.

import { builtinModuleId, parseUseStatements } from './modules';

export type BuiltinKind = 'function' | 'mixin';

export interface BuiltinFunction {
  /** Module id. e.g. 'math' → `sass:math` */
  module: string;
  /** Function/mixin name without namespace. e.g. 'div' */
  name: string;
  /** Defaults to 'function'. */
  kind: BuiltinKind;
  /** Ordered parameter names (without '$'). Rest parameters are included in place. */
  params: string[];
  /** Optional parameters (with defaults) and their default-value expressions. Keys are names without '$'. */
  defaults?: Record<string, string>;
  /** Rest (variadic) parameter names. Excluded from suggestions since they cannot be passed as keyword arguments. */
  rest?: string[];
  /** Function/mixin description. */
  description: string;
  /** Per-parameter descriptions. Keys are names without '$'. */
  paramDocs: Record<string, string>;
  /** A short practical usage example (SCSS). */
  example: string;
  /** Official documentation URL. */
  url: string;
}

const MODULE_URLS: Record<string, string> = {
  math: 'https://sass-lang.com/documentation/modules/math/',
  string: 'https://sass-lang.com/documentation/modules/string/',
  color: 'https://sass-lang.com/documentation/modules/color/',
  list: 'https://sass-lang.com/documentation/modules/list/',
  map: 'https://sass-lang.com/documentation/modules/map/',
  selector: 'https://sass-lang.com/documentation/modules/selector/',
  meta: 'https://sass-lang.com/documentation/modules/meta/',
};

/** One-line description for each built-in module. Exposed in `@use` completion docs. */
const MODULE_DESCRIPTIONS: Record<string, string> = {
  math: 'Provides math functions for numeric operations, units, trigonometry, and random numbers.',
  string: 'Provides string manipulation functions for searching, splitting, inserting, and case conversion.',
  color: 'Provides color functions for channel inspection, adjustment, mixing, and color-space conversion.',
  list: 'Provides list functions for length, indexing, joining, and separators.',
  map: 'Provides map functions for lookup, merging, and nested-key access.',
  selector: 'Provides selector functions for nesting, combining, extending, and parsing.',
  meta: 'Provides meta functions for type inspection, dynamic function calls, and module introspection.',
};

/** Built-in module ids. */
export const BUILTIN_MODULE_IDS: readonly string[] = Object.keys(MODULE_URLS);

/** Built-in module id → official documentation URL. */
export const BUILTIN_MODULE_URLS: Readonly<Record<string, string>> = MODULE_URLS;

/** Built-in module id → one-line description. */
export const BUILTIN_MODULE_DESCRIPTIONS: Readonly<Record<string, string>> = MODULE_DESCRIPTIONS;

function fn(
  module: string,
  name: string,
  params: string[],
  description: string,
  paramDocs: Record<string, string>,
  example: string,
  extra: { kind?: BuiltinKind; rest?: string[]; defaults?: Record<string, string> } = {},
): BuiltinFunction {
  return {
    module,
    name,
    kind: extra.kind ?? 'function',
    params,
    defaults: extra.defaults,
    rest: extra.rest,
    description,
    paramDocs,
    example,
    url: `${MODULE_URLS[module]}#${name}`,
  };
}

/** Parameters shared by sass:color's channel-manipulation functions (adjust/change). */
const COLOR_CHANNELS = [
  'red',
  'green',
  'blue',
  'hue',
  'saturation',
  'lightness',
  'whiteness',
  'blackness',
  'x',
  'y',
  'z',
  'chroma',
  'alpha',
  'space',
];

/** In adjust/change/scale, all channels default to `null` (optional). */
const COLOR_CHANNEL_DEFAULTS: Record<string, string> = Object.fromEntries(
  COLOR_CHANNELS.map((channel) => [channel, 'null']),
);

const COLOR_PARAM_DOCS: Record<string, string> = {
  color: 'The source color to manipulate.',
  red: 'Red channel value.',
  green: 'Green channel value.',
  blue: 'Blue channel value.',
  hue: 'Hue angle (deg).',
  saturation: 'Saturation.',
  lightness: 'Lightness.',
  whiteness: 'HWB whiteness channel.',
  blackness: 'HWB blackness channel.',
  x: 'X coordinate of an XYZ-family color space. (Dart Sass 1.79.0+)',
  y: 'Y coordinate of an XYZ-family color space. (Dart Sass 1.79.0+)',
  z: 'Z coordinate of an XYZ-family color space. (Dart Sass 1.79.0+)',
  chroma: 'Chroma of an LCH-family color space. (Dart Sass 1.79.0+)',
  alpha: 'Alpha (opacity), 0-1.',
  space: 'Color space in which to interpret channels. Defaults to the color space of `$color`.',
};

export const BUILTIN_FUNCTIONS: readonly BuiltinFunction[] = [
  // ── sass:math ──────────────────────────────────────────────────────────
  fn(
    'math',
    'div',
    ['number1', 'number2'],
    'Returns the result of dividing two numbers. Replaces the `/` operator and handles units too.',
    {
      number1: 'Dividend (numerator). Units present only here remain in the numerator of the result.',
      number2: 'Divisor (denominator). Units present only here go to the denominator of the result.',
    },
    'math.div(20px, 2) // 10px',
  ),
  fn('math', 'pow', ['base', 'exponent'], 'Returns `$base` raised to the power of `$exponent`.', {
    base: 'Base. Must be unitless.',
    exponent: 'Exponent. Must be unitless; negative and fractional values are allowed.',
  }, 'math.pow(2, 10) // 1024'),
  fn('math', 'round', ['number'], 'Rounds `$number` to the nearest integer.', {
    number: 'The number to round.',
  }, 'math.round(4.5) // 5'),
  fn('math', 'ceil', ['number'], 'Rounds `$number` up to the next integer.', {
    number: 'The number to round up.',
  }, 'math.ceil(4.2) // 5'),
  fn('math', 'floor', ['number'], 'Rounds `$number` down to the previous integer.', {
    number: 'The number to round down.',
  }, 'math.floor(4.8) // 4'),
  fn('math', 'abs', ['number'], 'Returns the absolute value of `$number`.', {
    number: 'The number whose absolute value to compute.',
  }, 'math.abs(-8px) // 8px'),
  fn('math', 'min', ['number'], 'Returns the smallest of the arguments.', {
    number: 'Numbers to compare (variadic, at least one).',
  }, 'math.min(3px, 8px, 5px) // 3px', { rest: ['number'] }),
  fn('math', 'max', ['number'], 'Returns the largest of the arguments.', {
    number: 'Numbers to compare (variadic, at least one).',
  }, 'math.max(3px, 8px, 5px) // 8px', { rest: ['number'] }),
  fn('math', 'clamp', ['min', 'number', 'max'], 'Clamps `$number` between `$min` and `$max`.', {
    min: 'Lower bound. If `$number` is smaller, this value is returned.',
    number: 'The number to clamp.',
    max: 'Upper bound. If `$number` is greater, this value is returned.',
  }, 'math.clamp(0, 150, 100) // 100'),
  fn('math', 'percentage', ['number'], 'Returns a unitless number as a `%` value (0.5 → 50%).', {
    number: 'A unitless number.',
  }, 'math.percentage(0.25) // 25%'),
  fn('math', 'unit', ['number'], 'Returns the unit of `$number` as a quoted string.', {
    number: 'The number whose unit to look up.',
  }, 'math.unit(100px) // "px"'),
  fn('math', 'is-unitless', ['number'], 'Returns `true` if `$number` has no unit.', {
    number: 'The number to check for a unit.',
  }, 'math.is-unitless(100) // true'),
  fn('math', 'sqrt', ['number'], 'Returns the square root of `$number`.', {
    number: 'The number whose square root to compute. `NaN` if negative.',
  }, 'math.sqrt(16) // 4'),
  fn('math', 'hypot', ['number'], 'Returns the Euclidean distance of the arguments (square root of the sum of squares).', {
    number: 'Numbers to compute the distance of (variadic).',
  }, 'math.hypot(3, 4) // 5', { rest: ['number'] }),
  fn('math', 'log', ['number', 'base'], 'Returns the logarithm of `$number`.', {
    number: 'The number whose logarithm to compute.',
    base: 'Base. Defaults to the natural logarithm (e).',
  }, 'math.log(8, 2) // 3', { defaults: { base: 'null' } }),
  fn(
    'math',
    'random',
    ['limit'],
    'Returns a random number. Without `$limit`, a real number between 0 (inclusive) and 1 (exclusive); with it, an integer between 1 and `$limit` (inclusive).',
    {
      limit: 'Upper bound for the random number (integer). Defaults to a real number between 0 and 1.',
    },
    'math.random(6) // 1..6',
    { defaults: { limit: 'null' } },
  ),
  fn('math', 'compatible', ['number1', 'number2'], 'Returns `true` if the two numbers have compatible units.', {
    number1: 'The first number to compare.',
    number2: 'The second number to compare.',
  }, 'math.compatible(1px, 2px) // true'),
  fn('math', 'cos', ['number'], 'Returns the cosine of `$number`.', {
    number: 'An angle (deg/rad/grad/turn).',
  }, 'math.cos(180deg) // -1'),
  fn('math', 'sin', ['number'], 'Returns the sine of `$number`.', {
    number: 'An angle (deg/rad/grad/turn).',
  }, 'math.sin(90deg) // 1'),
  fn('math', 'tan', ['number'], 'Returns the tangent of `$number`.', {
    number: 'An angle (deg/rad/grad/turn).',
  }, 'math.tan(45deg) // 1'),
  fn('math', 'acos', ['number'], 'Returns the arccosine of `$number` in `deg`.', {
    number: 'A unitless number (-1 to 1).',
  }, 'math.acos(0) // 90deg'),
  fn('math', 'asin', ['number'], 'Returns the arcsine of `$number` in `deg`.', {
    number: 'A unitless number (-1 to 1).',
  }, 'math.asin(1) // 90deg'),
  fn('math', 'atan', ['number'], 'Returns the arctangent of `$number` in `deg`.', {
    number: 'A unitless number.',
  }, 'math.atan(1) // 45deg'),
  fn('math', 'atan2', ['y', 'x'], 'Returns the arctangent of `$y / $x` in `deg` (quadrant-aware).', {
    y: 'y coordinate (numerator).',
    x: 'x coordinate (denominator).',
  }, 'math.atan2(1, 1) // 45deg'),

  // ── sass:string ────────────────────────────────────────────────────────
  fn('string', 'quote', ['string'], 'Returns `$string` wrapped in quotes. Returns it unchanged if already quoted.', {
    string: 'The value to quote.',
  }, 'string.quote(hello) // "hello"'),
  fn('string', 'unquote', ['string'], 'Removes the quotes from `$string`.', {
    string:
      'The string to unquote. For injecting into other values, interpolation (`#{$x}`) is the officially recommended approach.',
  }, 'string.unquote("hello") // hello'),
  fn(
    'string',
    'index',
    ['string', 'substring'],
    'Returns the position (1-based) where `$substring` first appears. `null` if not found.',
    {
      string: 'The string to search in.',
      substring: 'The substring to find.',
    },
    'string.index("hello", "l") // 3',
  ),
  fn('string', 'insert', ['string', 'insert', 'index'], 'Inserts `$insert` into `$string` at position `$index`.', {
    string: 'The original string.',
    insert: 'The string to insert.',
    index: 'Insertion position (1-based).',
  }, 'string.insert("Roboto", " Mono", 7) // "Roboto Mono"'),
  fn('string', 'length', ['string'], 'Returns the number of characters in `$string` (replaces the global `str-length`).', {
    string: 'The string whose length to count.',
  }, 'string.length("hello") // 5'),
  fn(
    'string',
    'slice',
    ['string', 'start-at', 'end-at'],
    'Slices `$string` from `$start-at` to `$end-at` (1-based; negative counts from the end).',
    {
      string: 'The string to slice.',
      'start-at': 'Start index (1-based; may be negative).',
      'end-at': 'End index (inclusive, 1-based; may be negative). Default -1 = to the end.',
    },
    'string.slice("Roboto Mono", 1, 6) // "Roboto"',
    { defaults: { 'end-at': '-1' } },
  ),
  fn('string', 'to-upper-case', ['string'], 'Converts `$string` to uppercase.', {
    string: 'The string to convert.',
  }, 'string.to-upper-case("abc") // "ABC"'),
  fn('string', 'to-lower-case', ['string'], 'Converts `$string` to lowercase.', {
    string: 'The string to convert.',
  }, 'string.to-lower-case("ABC") // "abc"'),
  fn(
    'string',
    'split',
    ['string', 'separator', 'limit'],
    'Splits `$string` by `$separator` and returns a list. (Dart Sass 1.57.0+)',
    {
      string: 'The string to split.',
      separator: 'The separator string.',
      limit: 'Maximum number of splits. No limit when omitted.',
    },
    'string.split("a,b,c", ",") // ["a", "b", "c"]',
    { defaults: { limit: 'null' } },
  ),
  fn(
    'string',
    'unique-id',
    [],
    'Returns a random valid CSS identifier. Useful for `@keyframes` names, etc.',
    {},
    'string.unique-id() // "u1234abcd"',
  ),

  // ── sass:color ─────────────────────────────────────────────────────────
  fn(
    'color',
    'adjust',
    ['color', ...COLOR_CHANNELS],
    'Returns a color with `$color`\'s channels adjusted by **fixed amounts**. Channels are passed as keyword arguments.',
    { ...COLOR_PARAM_DOCS, ...{ red: 'Amount to add to the red channel.', green: 'Amount to add to the green channel.', blue: 'Amount to add to the blue channel.' } },
    'color.adjust(#036, $lightness: 20%) // #0066cc',
    { defaults: COLOR_CHANNEL_DEFAULTS },
  ),
  fn(
    'color',
    'change',
    ['color', ...COLOR_CHANNELS],
    'Returns a color with `$color`\'s channels **set to specific values**. Channels are passed as keyword arguments.',
    COLOR_PARAM_DOCS,
    'color.change(#f00, $hue: 120deg) // #00ff00',
    { defaults: COLOR_CHANNEL_DEFAULTS },
  ),
  fn(
    'color',
    'scale',
    [
      'color',
      'red',
      'green',
      'blue',
      'saturation',
      'lightness',
      'whiteness',
      'blackness',
      'x',
      'y',
      'z',
      'chroma',
      'alpha',
      'space',
    ],
    'Returns a color with `$color`\'s channels shifted by **relative percentages**. All arguments other than `$color` must be passed as keywords.',
    {
      ...COLOR_PARAM_DOCS,
      red: 'Red channel shift percentage (%). + moves toward the maximum, - toward the minimum, by that fraction of the remaining range.',
      green: 'Green channel shift percentage (%).',
      blue: 'Blue channel shift percentage (%).',
      saturation: 'Saturation shift percentage (%).',
      lightness: 'Lightness shift percentage (%).',
      whiteness: 'HWB whiteness channel shift percentage (%).',
      blackness: 'HWB blackness channel shift percentage (%).',
      alpha: 'Alpha shift percentage (%).',
    },
    'color.scale(#333, $lightness: 30%) // #707070',
    { defaults: COLOR_CHANNEL_DEFAULTS },
  ),
  fn('color', 'mix', ['color1', 'color2', 'weight', 'method'], 'Returns a color mixing the two colors using the `$weight` ratio.', {
    color1: 'The first color (the weighting reference).',
    color2: 'The second color.',
    weight: 'Weight of `$color1` (%). Defaults to 50%.',
    method: 'Interpolation method (color space). Uses the default when omitted. (Dart Sass 1.79.0+)',
  }, 'color.mix(#f00, #00f, $weight: 25%) // #4000bf', { defaults: { weight: '50%', method: 'null' } }),
  fn('color', 'complement', ['color', 'space'], 'Returns the complement of `$color` (hue rotated 180°).', {
    color: 'The base color.',
    space: 'Polar color space to rotate in (hsl/hwb/lch/oklch). Defaults to the color space of `$color`.',
  }, 'color.complement(#036) // #663300', { defaults: { space: 'null' } }),
  fn('color', 'invert', ['color', 'weight', 'space'], 'Returns the inverse (negative) of `$color`.', {
    color: 'The color to invert.',
    weight: 'Inversion strength (%). Defaults to 100%.',
    space: 'Color space to invert in. Defaults to the color space of `$color`.',
  }, 'color.invert(#036, $weight: 60%) // #998f85', { defaults: { weight: '100%', space: 'null' } }),
  fn('color', 'grayscale', ['color'], 'Returns a gray with the same lightness as `$color`.', {
    color: 'The color to desaturate.',
  }, 'color.grayscale(#036) // #333333'),
  fn('color', 'to-space', ['color', 'space'], 'Converts `$color` to the `$space` color space.', {
    color: 'The color to convert.',
    space: 'The target color space.',
  }, 'color.to-space(#036, oklch) // oklch(32.33% 0.10254 253.885deg)'),
  fn('color', 'to-gamut', ['color', 'space', 'method'], 'Maps `$color` into the gamut of `$space`.', {
    color: 'The color to map.',
    space: 'Target color space. Defaults to the color space of `$color`.',
    method: 'Gamut-mapping algorithm. Defaults to `local-minde`.',
  }, 'color.to-gamut(#036, $space: display-p3, $method: local-minde) // #003366', { defaults: { space: 'null', method: 'local-minde' } }),
  fn('color', 'channel', ['color', 'channel', 'space'], 'Returns the value of the `$channel` of `$color`.', {
    color: 'The color to inspect.',
    channel: 'Channel name (a quoted string). e.g. "hue".',
    space: 'Color space in which to interpret the channel. Defaults to the color space of `$color`.',
  }, 'color.channel(#036, "hue") // 210deg', { defaults: { space: 'null' } }),
  fn('color', 'red', ['color'], 'Returns the red channel value of `$color`.', { color: 'The color to inspect.' }, 'color.red(#036) // 0'),
  fn('color', 'green', ['color'], 'Returns the green channel value of `$color`.', { color: 'The color to inspect.' }, 'color.green(#036) // 51'),
  fn('color', 'blue', ['color'], 'Returns the blue channel value of `$color`.', { color: 'The color to inspect.' }, 'color.blue(#036) // 102'),
  fn('color', 'hue', ['color'], 'Returns the hue angle of `$color`.', { color: 'The color to inspect.' }, 'color.hue(#036) // 210deg'),
  fn('color', 'saturation', ['color'], 'Returns the saturation of `$color`.', { color: 'The color to inspect.' }, 'color.saturation(#036) // 100%'),
  fn('color', 'lightness', ['color'], 'Returns the lightness of `$color`.', { color: 'The color to inspect.' }, 'color.lightness(#036) // 20%'),
  fn('color', 'whiteness', ['color'], 'Returns the HWB whiteness channel of `$color`.', { color: 'The color to inspect.' }, 'color.whiteness(#036) // 0%'),
  fn('color', 'blackness', ['color'], 'Returns the HWB blackness channel of `$color`.', { color: 'The color to inspect.' }, 'color.blackness(#036) // 60%'),
  fn('color', 'alpha', ['color'], 'Returns the alpha value of `$color` (replaces the global `opacity`).', {
    color: 'The color whose alpha to inspect.',
  }, 'color.alpha(rgba(0, 0, 0, 0.5)) // 0.5'),
  fn('color', 'same', ['color1', 'color2'], 'Returns `true` if the two colors are visually identical.', {
    color1: 'The first color to compare.',
    color2: 'The second color to compare.',
  }, 'color.same(#036, #003366) // true'),
  fn('color', 'is-legacy', ['color'], 'Returns `true` if `$color` is in a legacy color space (rgb/hsl/hwb).', {
    color: 'The color to check.',
  }, 'color.is-legacy(#036) // true'),
  fn('color', 'is-missing', ['color', 'channel'], 'Returns `true` if the `$channel` of `$color` is missing.', {
    color: 'The color to check.',
    channel: 'Channel name (a quoted string).',
  }, 'color.is-missing(#036, "hue") // false'),
  fn(
    'color',
    'is-powerless',
    ['color', 'channel', 'space'],
    'Returns `true` if the `$channel` of `$color` is powerless (e.g. hue when saturation is 0).',
    {
      color: 'The color to check.',
      channel: 'Channel name (a quoted string).',
      space: 'Color space in which to interpret the channel. Defaults to the color space of `$color`.',
    },
    'color.is-powerless(hsl(0, 0%, 50%), "hue") // true',
    { defaults: { space: 'null' } },
  ),
  fn('color', 'ie-hex-str', ['color'], 'Returns a string in `#AARRGGBB` form (for legacy IE `-ms-filter`).', {
    color: 'The color to convert.',
  }, 'color.ie-hex-str(#036) // #FF003366'),

  // ── sass:list ──────────────────────────────────────────────────────────
  fn('list', 'length', ['list'], 'Returns the number of items in `$list`.', { list: 'The target list.' }, 'list.length(1 2 3) // 3'),
  fn('list', 'nth', ['list', 'n'], 'Returns the `$n`-th item of `$list` (1-based; negative counts from the end).', {
    list: 'The target list.',
    n: 'Item position (1-based). Negative counts from the end.',
  }, 'list.nth(1 2 3, 2) // 2'),
  fn('list', 'set-nth', ['list', 'n', 'value'], 'Returns a new list with the `$n`-th item of `$list` replaced by `$value`.', {
    list: 'The target list.',
    n: 'Position to replace (1-based).',
    value: 'The new value.',
  }, 'list.set-nth(1 2 3, 2, 9) // 1 9 3'),
  fn('list', 'index', ['list', 'value'], 'Returns the position (1-based) where `$value` first appears. `null` if not found.', {
    list: 'The target list.',
    value: 'The value to find.',
  }, 'list.index(1 2 3, 2) // 2'),
  fn('list', 'append', ['list', 'val', 'separator'], 'Returns a new list with `$val` appended to the end of `$list`.', {
    list: 'The target list.',
    val: 'The value to append.',
    separator: 'Separator (`auto`/`space`/`comma`/`slash`). Defaults to `auto`.',
  }, 'list.append(1 2, 3) // 1 2 3', { defaults: { separator: 'auto' } }),
  fn('list', 'join', ['list1', 'list2', 'separator', 'bracketed'], 'Returns a list merging `$list1` and `$list2`.', {
    list1: 'The first list.',
    list2: 'The second list.',
    separator: 'Separator (`auto`/`space`/`comma`/`slash`). Defaults to `auto`.',
    bracketed: 'Whether to use brackets (`auto`/`true`/`false`). Defaults to `auto`.',
  }, 'list.join(1 2, 3 4) // 1 2 3 4', { defaults: { separator: 'auto', bracketed: 'auto' } }),
  fn('list', 'zip', ['lists'], 'Returns a list that pairs items at the same position across several lists.', {
    lists: 'Lists to zip (variadic).',
  }, 'list.zip(1 2, a b) // (1 a, 2 b)', { rest: ['lists'] }),
  fn('list', 'separator', ['list'], 'Returns the separator of `$list` (`space`/`comma`/`slash`).', {
    list: 'The target list.',
  }, 'list.separator(1, 2) // comma'),
  fn('list', 'is-bracketed', ['list'], 'Returns `true` if `$list` is bracketed.', { list: 'The target list.' }, 'list.is-bracketed([1 2]) // true'),
  fn('list', 'slash', ['elements'], 'Creates a slash-separated list.', {
    elements: 'Elements to make into a list (variadic).',
  }, 'list.slash(1, 2, 3) // 1 / 2 / 3', { rest: ['elements'] }),

  // ── sass:map ───────────────────────────────────────────────────────────
  fn(
    'map',
    'get',
    ['map', 'key', 'keys'],
    'Returns the value of `$key` in `$map`. Extra arguments follow nested keys. `null` if not found.',
    {
      map: 'The map to look up.',
      key: 'The first key.',
      keys: 'Extra nested keys (variadic).',
    },
    'map.get((primary: #036), primary) // #036',
    { rest: ['keys'] },
  ),
  fn('map', 'has-key', ['map', 'key', 'keys'], 'Returns `true` if `$map` contains `$key` (including nested).', {
    map: 'The map to check.',
    key: 'The first key.',
    keys: 'Extra nested keys (variadic).',
  }, 'map.has-key((primary: #036), primary) // true', { rest: ['keys'] }),
  fn('map', 'keys', ['map'], 'Returns a list of the keys in `$map`.', { map: 'The target map.' }, 'map.keys((primary: #036, gap: 8px)) // (primary, gap)'),
  fn('map', 'values', ['map'], 'Returns a list of the values in `$map`.', { map: 'The target map.' }, 'map.values((primary: #036, gap: 8px)) // (#036, 8px)'),
  fn(
    'map',
    'merge',
    ['map1', 'keys', 'map2'],
    'Returns a new map that **shallow**-merges `$map1` and `$map2`. An intermediate key path may also be specified.',
    {
      map1: 'The base map.',
      keys: 'Nested key path to merge at (variadic, optional).',
      map2: 'The map to overlay.',
    },
    'map.merge((a: 1), (b: 2)) // (a: 1, b: 2)',
    { rest: ['keys'] },
  ),
  fn('map', 'set', ['map', 'keys', 'value'], 'Returns a new map with the value at the key path set to `$value` (immutable).', {
    map: 'The target map.',
    keys: 'Key path to set (variadic).',
    value: 'The value to set.',
  }, 'map.set((a: 1), a, 2) // (a: 2)', { rest: ['keys'] }),
  fn('map', 'remove', ['map', 'keys'], 'Returns a new map with `$keys` removed from `$map`.', {
    map: 'The target map.',
    keys: 'Keys to remove (variadic).',
  }, 'map.remove((a: 1, b: 2), a) // (b: 2)', { rest: ['keys'] }),
  fn('map', 'deep-merge', ['map1', 'map2'], 'Returns a new map that **recursively** merges `$map1` and `$map2`.', {
    map1: 'The base map.',
    map2: 'The map to overlay.',
  }, 'map.deep-merge((a: (x: 1)), (a: (y: 2))) // (a: (x: 1, y: 2))'),
  fn('map', 'deep-remove', ['map', 'key', 'keys'], 'Returns a new map with the value at the nested key path removed.', {
    map: 'The target map.',
    key: 'The first key.',
    keys: 'Extra nested keys (variadic).',
  }, 'map.deep-remove((a: (x: 1, y: 2)), a, y) // (a: (x: 1))', { rest: ['keys'] }),

  // ── sass:selector ──────────────────────────────────────────────────────
  fn('selector', 'nest', ['selectors'], 'Combines selectors as if nested (a space = descendant).', {
    selectors: 'Selectors to combine (variadic).',
  }, 'selector.nest(".card", ".title") // .card .title', { rest: ['selectors'] }),
  fn('selector', 'append', ['selectors'], 'Combines selectors without spaces (compound).', {
    selectors: 'Selectors to combine (variadic).',
  }, 'selector.append(".btn", ":hover") // .btn:hover', { rest: ['selectors'] }),
  fn('selector', 'unify', ['selector1', 'selector2'], 'Returns a selector matched by both selectors. `null` if impossible.', {
    selector1: 'The first selector.',
    selector2: 'The second selector.',
  }, 'selector.unify(".a", ".b") // .a.b'),
  fn('selector', 'extend', ['selector', 'extendee', 'extender'], 'Extends `$extendee` with `$extender`, the same as `@extend`.', {
    selector: 'The base selector.',
    extendee: 'The selector to be extended.',
    extender: 'The extending selector.',
  }, 'selector.extend(".a.b", ".b", ".c") // .a.b, .a.c'),
  fn('selector', 'replace', ['selector', 'original', 'replacement'], 'Replaces `$original` with `$replacement` in `$selector`.', {
    selector: 'The base selector.',
    original: 'The selector to replace.',
    replacement: 'The replacement selector.',
  }, 'selector.replace(".a .b", ".b", ".c") // .a .c'),
  fn('selector', 'parse', ['selector'], 'Parses `$selector` into a structured list.', { selector: 'The selector to parse.' }, 'selector.parse(".a .b") // (.a .b,)'),
  fn('selector', 'is-superselector', ['super', 'sub'], 'Returns `true` if `$super` contains all of `$sub`.', {
    super: 'The candidate super-selector.',
    sub: 'The candidate sub-selector.',
  }, 'selector.is-superselector(".a", ".a.b") // true'),
  fn('selector', 'simple-selectors', ['selector'], 'Returns a list of the simple selectors in `$selector` (a single compound).', {
    selector: 'The selector to decompose.',
  }, 'selector.simple-selectors(".a.b") // .a, .b'),

  // ── sass:meta ──────────────────────────────────────────────────────────
  fn('meta', 'type-of', ['value'], 'Returns the value\'s type as a quoted string (`"number"`, `"string"`, `"map"` …).', {
    value: 'The value whose type to inspect.',
  }, 'meta.type-of(10px) // "number"'),
  fn('meta', 'inspect', ['value'], 'Returns a human-readable string for the value (for debugging/`@error` messages).', {
    value: 'The value to represent.',
  }, 'meta.inspect((a: 1)) // (a: 1)'),
  fn('meta', 'keywords', ['args'], 'Extracts only the keyword arguments from `$args...` as a map.', {
    args: 'The `$args...` of a mixin/function that receives an argument list.',
  }, 'meta.keywords($args) // (a: 1, b: 2)'),
  fn('meta', 'call', ['function', 'args'], 'Dynamically calls a function value.', {
    function: 'The function value to call (the result of `meta.get-function`).',
    args: 'Arguments to pass (variadic).',
  }, 'meta.call(meta.get-function("div", $module: "math"), 10, 2) // 5', { rest: ['args'] }),
  fn('meta', 'get-function', ['name', 'css', 'module'], 'Gets a function as a first-class value by name.', {
    name: 'The function name (a quoted string).',
    css: 'If `true`, treat it as a CSS function. Defaults to `false`.',
    module: 'Module namespace to look the function up in. Defaults to the current module.',
  }, 'meta.get-function("div", $module: "math") // get-function("div")', { defaults: { css: 'false', module: 'null' } }),
  fn('meta', 'get-mixin', ['name', 'module'], 'Gets a mixin as a first-class value by name.', {
    name: 'The mixin name (a quoted string).',
    module: 'Module namespace to look the mixin up in. Defaults to the current module.',
  }, 'meta.get-mixin("box") // get-mixin("box")', { defaults: { module: 'null' } }),
  fn('meta', 'apply', ['mixin', 'args'], 'Includes a mixin value at the current position.', {
    mixin: 'The mixin value to include.',
    args: 'Arguments to pass (variadic).',
  }, '@include meta.apply($mixin, 1, 2);', { kind: 'mixin', rest: ['args'] }),
  fn('meta', 'load-css', ['url', 'with'], 'Injects the module\'s CSS at the current position.', {
    url: 'The module URL to load.',
    with: 'Map of module variable overrides. Optional.',
  }, '@include meta.load-css("bootstrap", $with: (primary: #f00));', { kind: 'mixin', defaults: { with: 'null' } }),
  fn('meta', 'css', ['module'], 'Includes the CSS of an already-loaded module.', {
    module: 'Module namespace whose CSS to include.',
  }, '@include meta.css("theme");', { kind: 'mixin' }),
  fn('meta', 'load', ['url', 'with'], 'Loads a module value without side effects.', {
    url: 'The module URL to load.',
    with: 'Map of module variable overrides. Optional.',
  }, 'meta.load("theme", $with: (primary: #f00))', { defaults: { with: 'null' } }),
  fn('meta', 'variable-exists', ['name'], 'Returns `true` if a variable with the given name exists in the current scope.', {
    name: 'The variable name (a quoted string).',
  }, 'meta.variable-exists("gap") // true'),
  fn('meta', 'global-variable-exists', ['name', 'module'], 'Returns whether a global variable exists.', {
    name: 'The variable name (a quoted string).',
    module: 'Module namespace to look the variable up in. Defaults to global.',
  }, 'meta.global-variable-exists("gap") // true', { defaults: { module: 'null' } }),
  fn('meta', 'function-exists', ['name', 'module'], 'Returns whether a function exists.', {
    name: 'The function name (a quoted string).',
    module: 'Module namespace to look the function up in. Defaults to the current module.',
  }, 'meta.function-exists("div", $module: "math") // true', { defaults: { module: 'null' } }),
  fn('meta', 'mixin-exists', ['name', 'module'], 'Returns whether a mixin exists.', {
    name: 'The mixin name (a quoted string).',
    module: 'Module namespace to look the mixin up in. Defaults to the current module.',
  }, 'meta.mixin-exists("box") // true', { defaults: { module: 'null' } }),
  fn('meta', 'content-exists', [], 'Returns `true` if a `@content` block was passed to the current mixin.', {}, '@debug meta.content-exists(); // true'),
  fn('meta', 'accepts-content', ['mixin'], 'Returns `true` if the mixin value can receive `@content`.', {
    mixin: 'The mixin value to check.',
  }, 'meta.accepts-content(meta.get-mixin("box")) // true'),
  fn('meta', 'module-variables', ['module'], 'Returns a map of the module\'s variables.', {
    module: 'The target module namespace.',
  }, 'meta.module-variables("math") // ("pi": 3.14159…, "e": 2.71828…, …)'),
  fn('meta', 'module-functions', ['module'], 'Returns a map of the module\'s functions.', {
    module: 'The target module namespace.',
  }, 'meta.module-functions("math") // ("div": get-function("div"), …)'),
  fn('meta', 'calc-args', ['calc'], 'Returns the argument list of a `calc()` value.', {
    calc: 'A `calc()` value.',
  }, 'meta.calc-args(calc(10px + 5%)) // (10px + 5%,)'),
  fn('meta', 'calc-name', ['calc'], 'Returns the name of a `calc()` value.', {
    calc: 'A `calc()` value.',
  }, 'meta.calc-name(calc(10px + 5%)) // "calc"'),
];

const FUNCTION_INDEX = new Map<string, BuiltinFunction>(
  BUILTIN_FUNCTIONS.map((entry) => [`${entry.module}.${entry.name}`, entry]),
);

/** Looks up the metadata for the `name` function/mixin of built-in module `module`. */
export function findBuiltinFunction(module: string, name: string): BuiltinFunction | null {
  return FUNCTION_INDEX.get(`${module}.${name}`) ?? null;
}

/** Returns all members (functions, mixins) of built-in module `module`. */
export function listBuiltinMembers(module: string): BuiltinFunction[] {
  return BUILTIN_FUNCTIONS.filter((entry) => entry.module === module);
}

/** Required (non-omittable) parameter names. Excludes rest and defaulted parameters. */
export function requiredParams(entry: BuiltinFunction): string[] {
  const optional = entry.defaults ?? {};
  const rest = new Set(entry.rest ?? []);

  return entry.params.filter(
    (param) => !rest.has(param) && optional[param] === undefined,
  );
}

/** Optional (omittable) parameter names that have defaults. */
export function optionalParams(entry: BuiltinFunction): string[] {
  const optional = entry.defaults ?? {};

  return entry.params.filter((param) => optional[param] !== undefined);
}

/** Maximum number of optional parameters to list in a signature (extras are truncated to `…`). */
const SIGNATURE_OPTIONAL_LIMIT = 3;

/**
 * Builds a signature for display. Required is `$name`, optional is `$name: default`, rest is `$name...`.
 * When there are many optional parameters, only up to `SIGNATURE_OPTIONAL_LIMIT` are shown and the rest are truncated to `…`.
 */
export function formatSignature(entry: BuiltinFunction): string {
  const optional = entry.defaults ?? {};
  const rest = new Set(entry.rest ?? []);
  const parts: string[] = [];
  let shownOptional = 0;
  let truncated = false;

  for (const param of entry.params) {
    if (rest.has(param)) {
      parts.push(`$${param}...`);
      continue;
    }

    if (optional[param] !== undefined) {
      if (shownOptional >= SIGNATURE_OPTIONAL_LIMIT) {
        truncated = true;
        continue;
      }
      shownOptional += 1;
      parts.push(`$${param}: ${optional[param]}`);
      continue;
    }

    parts.push(`$${param}`);
  }

  if (truncated) parts.push('…');

  return parts.join(', ');
}

/**
 * Finds missing required parameters given the number of positional arguments and the set of keyword arguments.
 * Positional arguments are assumed to fill parameters from the front, in order.
 */
export function missingRequiredParams(
  entry: BuiltinFunction,
  positional: number,
  keywords: ReadonlySet<string>,
): string[] {
  const optional = entry.defaults ?? {};
  const rest = new Set(entry.rest ?? []);
  const missing: string[] = [];
  let filled = 0;

  for (const param of entry.params) {
    if (rest.has(param)) continue;

    if (filled < positional) {
      filled += 1;
      continue;
    }

    if (keywords.has(param)) continue;
    if (optional[param] !== undefined) continue;

    missing.push(param);
  }

  return missing;
}

export interface BuiltinVariable {
  /** Variable name without `$`. */
  name: string;
  description: string;
}

/** Public variables of built-in modules (e.g. `math.$pi`). Modules without variables have no entries. */
export const BUILTIN_VARIABLES: Readonly<Record<string, readonly BuiltinVariable[]>> = {
  math: [
    { name: 'e', description: 'The base of the natural logarithm, e (approximately 2.71828).' },
    { name: 'pi', description: 'The ratio of a circle to its diameter, π (approximately 3.14159).' },
    { name: 'epsilon', description: 'The smallest number distinguishable from 1 when added to it.' },
    { name: 'max-number', description: 'The largest representable number.' },
    { name: 'min-number', description: 'The smallest representable positive number.' },
    { name: 'max-safe-integer', description: 'The largest integer that can be represented exactly (2^53 - 1).' },
    { name: 'min-safe-integer', description: 'The smallest integer that can be represented exactly (-(2^53 - 1)).' },
  ],
};

/**
 * Builds a namespace → module id map from `@use 'sass:<module>' [as <alias>]` declarations in a file.
 * `as *` (global load) does not create a namespace, so it is not mapped.
 */
export function parseSassModuleNamespaces(text: string): Map<string, string> {
  const namespaces = new Map<string, string>();

  for (const statement of parseUseStatements(text)) {
    if (statement.global || !statement.namespace) continue;

    const moduleId = builtinModuleId(statement.url);

    if (moduleId) namespaces.set(statement.namespace, moduleId);
  }

  return namespaces;
}
