// The class, id, and attribute selectors a stylesheet defines, so a template can complete them
// inside `class="..."`, `id="..."`, and other attributes. Independent of the VS Code API (Node only).
//
// A selector is read from the text that opens a `{ ... }` block and does not start with `@`. The
// reader scans the text rather than using the CSS parser: parsing a whole workspace costs about
// 1.3 ms per file, which is too much for thousands of files, and the scanner costs a fraction of
// that. A name built with interpolation is expanded, through `interpolation.ts`, from the literal
// values the file fixes (`$name: a, b`, an `@each` list, or a map's keys), and `&__element`
// resolves against the class names of the enclosing block, so BEM selectors are covered. A name
// nothing fixes is left out, so the completion never offers a value it cannot stand behind.

import { maskNonCode, type StylesheetSyntax } from './diagnostics';
import { expand, interpolationValues, readName } from './interpolation';
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

/** The most candidates collected from one file. */
const MAX_CANDIDATES = 2000;

/** An attribute selector: `[name]`, `[name=value]`, `[name~=value]`, `[name^=value]`, ... */
const ATTRIBUTE_RE = /^\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:([~|^$*]?=)\s*([\s\S]*?))?$/;

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
