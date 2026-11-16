// Unit sets used when matching a value against a numeric CSS type. A dimension token carries a
// lower-cased unit, so the sets are lower case as well.

/** Units accepted by `<length>`. */
export const LENGTH_UNITS = new Set([
  // font-relative
  'em',
  'rem',
  'ex',
  'rex',
  'cap',
  'rcap',
  'ch',
  'rch',
  'ic',
  'ric',
  'lh',
  'rlh',
  // viewport-relative
  'vw',
  'vh',
  'vi',
  'vb',
  'vmin',
  'vmax',
  'svw',
  'svh',
  'svi',
  'svb',
  'svmin',
  'svmax',
  'lvw',
  'lvh',
  'lvi',
  'lvb',
  'lvmin',
  'lvmax',
  'dvw',
  'dvh',
  'dvi',
  'dvb',
  'dvmin',
  'dvmax',
  // container-relative
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
  // absolute
  'cm',
  'mm',
  'q',
  'in',
  'pc',
  'pt',
  'px',
]);

/** Units accepted by `<angle>`. */
export const ANGLE_UNITS = new Set(['deg', 'grad', 'rad', 'turn']);

/** Units accepted by `<time>`. */
export const TIME_UNITS = new Set(['s', 'ms']);

/** Units accepted by `<frequency>`. */
export const FREQUENCY_UNITS = new Set(['hz', 'khz']);

/** Units accepted by `<resolution>`. */
export const RESOLUTION_UNITS = new Set(['dpi', 'dpcm', 'dppx', 'x']);

/** Units accepted by `<flex>`. */
export const FLEX_UNITS = new Set(['fr']);

/** Every unit above, used to tell a dimension with a CSS unit from one with an unknown unit. */
export const ALL_UNITS = new Set([
  ...LENGTH_UNITS,
  ...ANGLE_UNITS,
  ...TIME_UNITS,
  ...FREQUENCY_UNITS,
  ...RESOLUTION_UNITS,
  ...FLEX_UNITS,
]);
