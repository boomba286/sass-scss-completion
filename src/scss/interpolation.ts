// Resolving `#{$name}` interpolation from the literal values a file fixes.
//
// A stylesheet can build a class name, an attribute value, or a custom property name out of a
// variable (`--font-size-#{$name}`, `.btn-#{$variant}`). A reader that scans text cannot know the
// result unless the file also fixes the value somewhere: a `$name: a, b` declaration, or the list
// an `@each` walks. This module collects those fixed values so every reader expands the same
// interpolation the same way, and a name nothing fixes is dropped rather than guessed.
//
// The same collection serves the selector scanner (`selectors.ts`) and the custom property reader
// (`../css/custom-properties.ts`), which keeps the two from drifting apart: a fix made for one is
// then shared by the other. Independent of the VS Code API (Node only).

import { skipInterpolation } from './scopes';

/** The most names one interpolated template may expand to. */
const MAX_EXPANSION = 64;

/** A `$name: value` declaration, up to the `;` / `{` / `}` that ends it. */
const VARIABLE_RE = /(?:^|[\n;{}])\s*\$([A-Za-z0-9_-]+)\s*:\s*([^;{}]*)/g;

/** The variables an `@each $a, $b in ...` header binds. */
const EACH_HEADER_RE = /@each\s+((?:\$[A-Za-z0-9_-]+\s*,?\s*)+)in\b/g;

/** An interpolation that is exactly one variable reference, `#{$name}`, which a value list can fill. */
const VARIABLE_INTERPOLATION_RE = /#\{\s*\$([A-Za-z0-9_-]+)\s*\}/g;

/** True when a value can take part in a class, id, attribute, or custom property name. */
const LIST_ITEM_RE = /^[-_A-Za-z0-9]+$/;

/** The fixed values a declaration holds, so interpolation may expand from them. */
interface ListInfo {
  /** True when the value is a map `(key: value, ...)` rather than a flat list. */
  isMap: boolean;
  /** A map's keys, when the value is a map; empty otherwise. */
  keys: string[];
  /** The items of a flat list, when the value is one; empty for a map. */
  values: string[];
}

/** True when the character can continue a class, id, attribute, or custom property name. */
function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

/** Reads the name after `.` / `#` / `&` / `--`, keeping `#{...}` interpolation and escapes, to the next break. */
export function readName(text: string, start: number): { template: string; end: number } {
  let i = start;

  while (i < text.length) {
    const ch = text[i];

    if (isNameChar(ch)) {
      i += 1;
      continue;
    }

    if (ch === '#' && text[i + 1] === '{') {
      i = skipInterpolation(text, i);
      continue;
    }

    if (ch === '\\') {
      i += 2;
      continue;
    }

    break;
  }

  return { template: text.slice(start, i), end: i };
}

/** Splits list/map text on the commas that are not nested in brackets or quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** The index of the `:` that separates a map key from its value, or -1 when there is none. */
function topLevelColon(text: string): number {
  let depth = 0;
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ':' && depth === 0) return i;
  }

  return -1;
}

/** The unquoted name of a single list item, or null when the text cannot build a name. */
function itemName(text: string): string | null {
  const name = text.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

  return LIST_ITEM_RE.test(name) ? name : null;
}

/** The items of a fixed list, or an empty list when the value is not one. */
function literalList(value: string): string[] {
  const trimmed = value.replace(/!\s*(?:default|global)\b/g, '').trim();

  if (trimmed === '' || trimmed.includes('$') || trimmed.includes('#{')) return [];

  // A Sass list is separated by commas or spaces (`$sizes: sm md`), and only a plain token can
  // build a name: `.item-#{$item}` over `1 2 3` is `item-1`, `item-2`, `item-3`, while a value such
  // as `fr.` yields nothing rather than the unusable `clr-fr.`.
  return trimmed
    .split(/[\s,]+/)
    .map((item) => itemName(item))
    .filter((item): item is string => item !== null);
}

/**
 * The keys of a map literal `(key: value, ...)`, or null when the value is a flat list rather than a
 * map. Only keys that can build a name are kept.
 */
function mapKeys(value: string): string[] | null {
  const trimmed = value.replace(/!\s*(?:default|global)\b/g, '').trim();

  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;

  const keys: string[] = [];

  for (const part of splitTopLevel(trimmed.slice(1, -1))) {
    const colon = topLevelColon(part);

    // A parenthesized flat list `(a, b)` has no top-level `:`, so it is not a map.
    if (colon === -1) return null;

    const name = itemName(part.slice(0, colon));

    if (name !== null) keys.push(name);
  }

  return keys;
}

/** The fixed list or map a value holds. */
function listInfo(value: string): ListInfo {
  const keys = mapKeys(value);

  if (keys !== null) return { isMap: true, keys, values: [] };

  return { isMap: false, keys: [], values: literalList(value) };
}

/**
 * The literal lists and maps the file fixes, so interpolation can expand: every `$name: ...`
 * declaration and every `@each $v in ...` header. A value that is not a fixed list or map is
 * skipped, and a map binds its keys to the first loop variable and its values to the second.
 */
export function interpolationValues(masked: string, original: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  const sources = new Map<string, ListInfo>();
  const add = (name: string, list: string[]): void => {
    if (list.length === 0) return;

    const existing = values.get(name) ?? [];

    for (const item of list) if (!existing.includes(item)) existing.push(item);

    values.set(name, existing);
  };

  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_RE.exec(masked)) !== null) {
    const start = match.index + match[0].length - match[2].length;
    const info = listInfo(original.slice(start, start + match[2].length));

    sources.set(match[1], info);

    // A map is not a flat value, so a direct `#{$map}` interpolation expands to nothing.
    if (!info.isMap) add(match[1], info.values);
  }

  EACH_HEADER_RE.lastIndex = 0;

  while ((match = EACH_HEADER_RE.exec(masked)) !== null) {
    const start = match.index + match[0].length;
    // The list runs to the `{` of the loop body; a fixed bound keeps the slice small on broken input.
    const header = original.slice(start, start + 512);
    const stop = header.search(/[;{}]/);
    const listText = (stop === -1 ? header : header.slice(0, stop)).trim();
    const reference = listText.match(/^\$([A-Za-z0-9_-]+)$/);
    const info = reference ? (sources.get(reference[1]) ?? listInfo('')) : listInfo(listText);

    const names: string[] = [];
    const variable = /\$([A-Za-z0-9_-]+)/g;
    let variableMatch: RegExpExecArray | null;

    while ((variableMatch = variable.exec(match[1])) !== null) names.push(variableMatch[1]);

    if (names.length === 0) continue;

    if (info.isMap) {
      add(names[0], info.keys);
      if (names.length > 1) add(names[1], info.values);
      continue;
    }

    for (const name of names) add(name, info.values);
  }

  return values;
}

/** Expands the `#{...}` interpolations of a template into the concrete names a variable can take. */
export function expand(template: string, values: ReadonlyMap<string, string[]>): string[] {
  if (!template.includes('#{')) return [template];

  const parts: (string | string[])[] = [];
  let last = 0;

  VARIABLE_INTERPOLATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_INTERPOLATION_RE.exec(template)) !== null) {
    const list = values.get(match[1]);

    // A name no declaration fixes cannot be completed, so the whole candidate is dropped.
    if (!list || list.length === 0) return [];

    parts.push(template.slice(last, match.index));
    parts.push(list);
    last = match.index + match[0].length;
  }

  parts.push(template.slice(last));

  // An interpolation that is not a plain variable reference is not a fixed name either.
  if (parts.some((part) => typeof part === 'string' && part.includes('#{'))) return [];

  let results = [''];

  for (const part of parts) {
    const options = Array.isArray(part) ? part : [part];
    const next: string[] = [];

    for (const prefix of results) {
      for (const option of options) {
        next.push(prefix + option);

        if (next.length >= MAX_EXPANSION) break;
      }

      if (next.length >= MAX_EXPANSION) break;
    }

    results = next;
  }

  return results;
}
