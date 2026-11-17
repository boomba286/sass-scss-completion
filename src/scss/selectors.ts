// The class, id, and attribute selectors a stylesheet defines, so a template can complete them
// inside `class="..."`, `id="..."`, and other attributes. Independent of the VS Code API (Node only).
//
// A selector is read from the text that opens a `{ ... }` block and does not start with `@`. The
// reader scans the text rather than using the CSS parser: parsing a whole workspace costs about
// 1.3 ms per file, which is too much for thousands of files, and the scanner costs a fraction of
// that. A name built with interpolation is expanded from the literal values the file fixes
// (`$name: a, b`) and the lists an `@each` enumerates, and `&__element` resolves against the class
// names of the enclosing block, so BEM selectors are covered. A name nothing fixes is left out, so
// the completion never offers a value it cannot stand behind.

import { maskNonCode, type StylesheetSyntax } from './diagnostics';
import { skipInterpolation } from './scopes';

/** One class, id, or attribute name a stylesheet defines, with the text that describes it. */
export interface AttributeCandidate {
  /** The attribute the name belongs to: `class`, `id`, or the attribute's own name. */
  name: string;
  /** The attribute value, or null when the selector names the attribute only. */
  value: string | null;
  /** The comment written directly above the selector, or null when it has none. */
  comment: string | null;
}

/** The most names one interpolated selector may expand to. */
const MAX_EXPANSION = 64;

/** The most candidates collected from one file. */
const MAX_CANDIDATES = 2000;

/** A `$name: value` declaration, up to the `;` / `{` / `}` that ends it. */
const VARIABLE_RE = /(?:^|[\n;{}])\s*\$([A-Za-z0-9_-]+)\s*:\s*([^;{}]*)/g;

/** The variables an `@each $a, $b in ...` header binds. */
const EACH_HEADER_RE = /@each\s+((?:\$[A-Za-z0-9_-]+\s*,?\s*)+)in\b/g;

/** An attribute selector: `[name]`, `[name=value]`, `[name~=value]`, `[name^=value]`, ... */
const ATTRIBUTE_RE = /^\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:([~|^$*]?=)\s*([\s\S]*?))?$/;

/** An interpolation that is exactly one variable reference, `#{$name}`, which a value list can fill. */
const VARIABLE_INTERPOLATION_RE = /#\{\s*\$([A-Za-z0-9_-]+)\s*\}/g;

/** True when the character can continue a class, id, or attribute name. */
function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

/** Reads the name after `.` / `#` / `&`, keeping `#{...}` interpolation and escapes, to the next break. */
function readName(text: string, start: number): { template: string; end: number } {
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

/** True when a value can take part in a class or id name, so an interpolated name may use it. */
const LIST_ITEM_RE = /^[-_A-Za-z0-9]+$/;

/** The items of a fixed list, or an empty list when the value is not one. */
function literalList(value: string): string[] {
  const trimmed = value.replace(/!\s*(?:default|global)\b/g, '').trim();

  if (trimmed === '' || trimmed.includes('$') || trimmed.includes('#{')) return [];

  // A Sass list is separated by commas or spaces (`$sizes: sm md`), and only a plain token can
  // build a name: `.item-#{$item}` over `1 2 3` is `item-1`, `item-2`, `item-3`, while a value such
  // as `fr.` yields nothing rather than the unusable `clr-fr.`.
  return trimmed
    .split(/[\s,]+/)
    .map((item) => item.replace(/^(['"])([\s\S]*)\1$/, '$2'))
    .filter((item) => LIST_ITEM_RE.test(item));
}

/**
 * The literal lists the file fixes, so interpolation can expand: every `$name: a, b` declaration and
 * every `@each $v in ...` header. A value that is not a fixed list is skipped.
 */
function interpolationValues(masked: string, original: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  const add = (name: string, list: string[]): void => {
    const existing = values.get(name) ?? [];

    for (const item of list) if (!existing.includes(item)) existing.push(item);

    values.set(name, existing);
  };

  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_RE.exec(masked)) !== null) {
    const start = match.index + match[0].length - match[2].length;

    add(match[1], literalList(original.slice(start, start + match[2].length)));
  }

  EACH_HEADER_RE.lastIndex = 0;

  while ((match = EACH_HEADER_RE.exec(masked)) !== null) {
    const start = match.index + match[0].length;
    // The list runs to the `{` of the loop body; a fixed bound keeps the slice small on broken input.
    const header = original.slice(start, start + 512);
    const stop = header.search(/[;{}]/);
    const listText = (stop === -1 ? header : header.slice(0, stop)).trim();
    const reference = listText.match(/^\$([A-Za-z0-9_-]+)$/);
    const list = reference ? (values.get(reference[1]) ?? []) : literalList(listText);

    if (list.length === 0) continue;

    const variable = /\$([A-Za-z0-9_-]+)/g;
    let variableMatch: RegExpExecArray | null;

    while ((variableMatch = variable.exec(match[1])) !== null) add(variableMatch[1], list);
  }

  return values;
}

/** Expands the `#{...}` interpolations of a template into the concrete names a variable can take. */
function expand(template: string, values: ReadonlyMap<string, string[]>): string[] {
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

/**
 * The text of the comment directly above the selector that ends at `to`, or null when there is none.
 * A blank line detaches a comment, so a file header stays a file header, while consecutive comment
 * lines join into one line. A plain CSS file has no `//` comment, so `lineComments` is false for it.
 */
function leadingComment(
  text: string,
  from: number,
  to: number,
  lineComments: boolean,
): string | null {
  const region = text.slice(from, to);
  const parts: string[] = [];
  let i = 0;

  // The whitespace before the first comment only separates this statement from the previous one.
  while (i < region.length && /\s/.test(region[i])) i += 1;

  while (i < region.length) {
    if (lineComments && region[i] === '/' && region[i + 1] === '/') {
      const stop = region.indexOf('\n', i);

      parts.push(region.slice(i + 2, stop === -1 ? region.length : stop).replace(/^\/+/, '').trim());
      i = stop === -1 ? region.length : stop;
    } else if (region[i] === '/' && region[i + 1] === '*') {
      const stop = region.indexOf('*/', i + 2);
      const body = region.slice(i + 2, stop === -1 ? region.length : stop);

      parts.push(body.replace(/^[ \t]*\*[ \t]?/gm, ' ').replace(/\s+/g, ' ').trim());
      i = stop === -1 ? region.length : stop + 2;
    } else {
      break;
    }

    // A blank line between the comment and the selector ends the block; earlier lines are detached.
    let breaks = 0;

    while (i < region.length && /[ \t\r]/.test(region[i])) i += 1;

    while (i < region.length && region[i] === '\n') {
      breaks += 1;
      i += 1;

      while (i < region.length && /[ \t\r]/.test(region[i])) i += 1;
    }

    if (breaks >= 2) parts.length = 0;
  }

  const joined = parts.filter((part) => part !== '').join(' ');

  return joined === '' ? null : joined;
}

/**
 * The `[name=value]` attribute selector starting at `open`, with its value resolved when it is fixed.
 */
function attributeCandidates(
  inner: string,
  out: AttributeCandidate[],
  values: ReadonlyMap<string, string[]>,
  comment: string | null,
): void {
  const match = inner.match(ATTRIBUTE_RE);

  if (!match) return;

  for (const name of expand(match[1], values)) {
    if (match[3] === undefined) {
      out.push({ name, value: null, comment });
      continue;
    }

    const raw = match[3].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    const list = expand(raw, values);

    // A value nothing fixes is dropped, but the attribute name is still worth offering.
    if (list.length === 0) out.push({ name, value: null, comment });
    else for (const value of list) out.push({ name, value, comment });
  }
}

/**
 * The attributes a selector header names. `parents` holds the class names of the enclosing block, so
 * `&__title` inside `.card` yields `card__title`.
 */
function headerCandidates(
  header: string,
  start: number,
  original: string,
  values: ReadonlyMap<string, string[]>,
  parents: readonly string[],
  comment: string | null,
): AttributeCandidate[] {
  const out: AttributeCandidate[] = [];
  let i = 0;

  while (i < header.length) {
    const ch = header[i];

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '#' && header[i + 1] === '{') {
      i = skipInterpolation(header, i);
      continue;
    }

    if (ch === '&') {
      const { template, end } = readName(header, i + 1);

      if (/^[-A-Za-z0-9_]/.test(template) || template.startsWith('#{')) {
        for (const suffix of expand(template, values)) {
          for (const parent of parents) out.push({ name: 'class', value: parent + suffix, comment });
        }
      }

      i = end > i + 1 ? end : i + 1;
      continue;
    }

    if (ch === '.' || ch === '#') {
      const { template, end } = readName(header, i + 1);

      if (template !== '' && !/^[0-9]/.test(template)) {
        for (const name of expand(template, values)) {
          out.push({ name: ch === '.' ? 'class' : 'id', value: name, comment });
        }
      }

      i = end > i + 1 ? end : i + 1;
      continue;
    }

    if (ch === '[') {
      const close = header.indexOf(']', i + 1);

      if (close === -1) {
        i += 1;
        continue;
      }

      // Values may be quoted, which the mask blanks out, so read them from the original text.
      attributeCandidates(original.slice(start + i + 1, start + close), out, values, comment);
      i = close + 1;
      continue;
    }

    i += 1;
  }

  return out;
}

/**
 * The attributes a stylesheet's selectors name: `class` for every `.name`, `id` for every `#name`,
 * and the name and value of every attribute selector. Interpolated names are expanded from the
 * literal lists the file fixes, and `&__element` resolves against the enclosing block's class names.
 */
export function extractAttributes(
  text: string,
  syntax: StylesheetSyntax = 'scss',
): AttributeCandidate[] {
  const masked = maskNonCode(text, { lineComments: syntax === 'scss' });
  const values = interpolationValues(masked, text);
  const seen = new Set<string>();
  const out: AttributeCandidate[] = [];
  // The class names of the enclosing selector, restored when a block closes.
  const stack: string[][] = [];
  let parents: string[] = [];
  let statementStart = 0;
  let i = 0;

  const push = (name: string, value: string | null, comment: string | null): void => {
    const key = `${name}\u0000${value ?? ''}`;

    if (seen.has(key)) return;

    seen.add(key);
    out.push({ name, value, comment });
  };

  while (i < masked.length && out.length < MAX_CANDIDATES) {
    const ch = masked[i];

    if (ch === '#' && masked[i + 1] === '{') {
      i = skipInterpolation(masked, i);
      continue;
    }

    if (ch === '{') {
      const header = masked.slice(statementStart, i);

      // An at-rule does not change the parent selector; a selector list does.
      if (/^\s*@/.test(header)) {
        stack.push(parents);
      } else {
        const comment = leadingComment(text, statementStart, i, syntax === 'scss');
        const candidates = headerCandidates(header, statementStart, text, values, parents, comment);

        for (const candidate of candidates) push(candidate.name, candidate.value, comment);

        const classes = candidates
          .filter((candidate) => candidate.name === 'class' && candidate.value !== null)
          .map((candidate) => candidate.value as string);

        stack.push(parents);

        if (classes.length > 0) parents = classes;
      }

      statementStart = i + 1;
      i += 1;
      continue;
    }

    if (ch === '}') {
      parents = stack.pop() ?? [];
      statementStart = i + 1;
      i += 1;
      continue;
    }

    if (ch === ';') statementStart = i + 1;

    i += 1;
  }

  return out;
}
