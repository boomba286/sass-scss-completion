// Abstract syntax tree for the CSS value definition syntax (VDS) that describes what a property
// accepts. Only the parts of VDS that appear in the CSS data shipped with
// vscode-css-languageservice are modelled; see `parser.ts` for the grammar.

/** A numeric range written next to a type, for example `<length-percentage [0,∞]>`. */
export interface NumericRange {
  /** Lower bound, `-Infinity` when the grammar leaves it open. */
  min: number;
  /** Upper bound, `Infinity` when the grammar leaves it open. */
  max: number;
}

/** A literal such as `auto`, `none`, or a function notation such as `fit-content(...)`. */
export interface KeywordNode {
  kind: 'keyword';
  /** Lower-cased keyword text. */
  value: string;
  /** True for the `name( ... )` function notation. */
  function: boolean;
  /** Argument of the function notation, when it has one. */
  argument?: SyntaxNode;
}

/** A separator that belongs to the value itself, such as the comma in `<x> , <y>`. */
export interface SeparatorNode {
  kind: 'separator';
  value: ',' | '/';
}

/** A `<type>` reference such as `<color>`, `<length>`, or the `<calc-size()>` notation. */
export interface TypeNode {
  kind: 'type';
  /** Lower-cased type name with any `()` notation suffix removed. */
  name: string;
  /** True for the `name()` notation, which only a function call can satisfy. */
  function: boolean;
  /** Bounds written next to the type, when present. */
  range?: NumericRange;
}

/** A `<'property-name'>` reference, meaning "whatever that property accepts". */
export interface PropertyRefNode {
  kind: 'property-ref';
  /** Lower-cased name of the referenced property. */
  name: string;
}

/** A `[ ... ]` group, used to give a quantifier more than one component. */
export interface GroupNode {
  kind: 'group';
  child: SyntaxNode;
}

/** `a | b | c` - exactly one of the options. */
export interface AlternationNode {
  kind: 'alternation';
  options: SyntaxNode[];
}

/** `a || b` - one or more of them, in any order. */
export interface AnyOrderNode {
  kind: 'any-order';
  operands: SyntaxNode[];
}

/** `a && b` - all of them, in any order. */
export interface AllNode {
  kind: 'all';
  operands: SyntaxNode[];
}

/** `a b c` - all of them, in this order. */
export interface SequenceNode {
  kind: 'sequence';
  operands: SyntaxNode[];
}

/** A postfix repetition: `?`, `*`, `+`, `#`, `{n}`, or `{n,m}`. */
export interface RepeatNode {
  kind: 'repeat';
  /** Smallest number of repetitions. */
  min: number;
  /** Largest number of repetitions, or `null` when unbounded. */
  max: number | null;
  /** `,` when the repetitions are comma separated (the `#` multiplier), otherwise `null`. */
  separator: ',' | null;
  child: SyntaxNode;
}

export type SyntaxNode =
  | KeywordNode
  | SeparatorNode
  | TypeNode
  | PropertyRefNode
  | GroupNode
  | AlternationNode
  | AnyOrderNode
  | AllNode
  | SequenceNode
  | RepeatNode;
