// VS Code API 에 의존하지 않는 순수 로직. Node 에서 그대로 검증할 수 있다.

const IDENT_RE = /[A-Za-z0-9_-]/;

export interface CallSite {
  name: string;
  namespace: string | null;
  openParen: number;
  closeParen: number;
}

export type SignatureKind = 'function' | 'mixin';

export interface Signature {
  kind: SignatureKind;
  name: string;
  params: string[];
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_RE.test(ch);
}

/**
 * offset 을 감싸는 가장 안쪽 함수/믹스인 호출을 찾는다.
 */
export function findEnclosingCall(text: string, offset: number): CallSite | null {
  let depth = 0;
  let open = -1;

  for (let i = offset - 1; i >= 0; i -= 1) {
    const ch = text[i];

    if (ch === ')') {
      depth += 1;
    } else if (ch === '(') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }

  if (open === -1) return null;

  let j = open - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  const nameEnd = j + 1;
  while (j >= 0 && isIdentChar(text[j])) j -= 1;
  const name = text.slice(j + 1, nameEnd);

  if (!name) return null;

  let namespace: string | null = null;
  let k = j;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;

  if (k >= 0 && text[k] === '.') {
    let m = k - 1;
    while (m >= 0 && /\s/.test(text[m])) m -= 1;
    const nsEnd = m + 1;
    while (m >= 0 && isIdentChar(text[m])) m -= 1;
    const candidate = text.slice(m + 1, nsEnd);
    if (candidate) namespace = candidate;
  }

  let d = 0;
  let close = -1;

  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '(') {
      d += 1;
    } else if (ch === ')') {
      d -= 1;
      if (d === 0) {
        close = i;
        break;
      }
    }
  }

  return { name, namespace, openParen: open, closeParen: close };
}

/** 최상위(괄호/대괄호/중괄호/문자열 밖) 기준으로 콤마를 나눈다. */
export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

/** 시그니처 문자열("$value, $base: 16")에서 파라미터 이름만 뽑는다. */
export function parseParams(signature: string): string[] {
  const params: string[] = [];

  for (const part of splitTopLevel(signature)) {
    const match = part.match(/\$([A-Za-z0-9_-]+)/);
    if (match) params.push(match[1]);
  }

  return params;
}

/** 파일 텍스트에서 @function / @mixin 시그니처를 모두 수집한다. */
export function extractSignatures(text: string): Signature[] {
  const found: Signature[] = [];
  const opener = /@(function|mixin)\s+([A-Za-z0-9_-]+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(text)) !== null) {
    const openParen = match.index + match[0].length - 1;
    let depth = 0;
    let closeParen = -1;

    for (let i = openParen; i < text.length; i += 1) {
      const ch = text[i];

      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParen = i;
          break;
        }
      }
    }

    if (closeParen === -1) continue;

    const signature = text.slice(openParen + 1, closeParen);
    found.push({
      kind: match[1] as SignatureKind,
      name: match[2],
      params: parseParams(signature),
    });
  }

  return found;
}

/** 인자 영역에서 이미 '이름'으로 쓰인 파라미터를 모은다. 커서 아래 토큰은 제외. */
export function usedParamNames(
  argText: string,
  argStart: number,
  cursorOffset: number,
): Set<string> {
  const used = new Set<string>();
  const re = /\$[A-Za-z0-9_-]+/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(argText)) !== null) {
    const start = argStart + match.index;
    const end = start + match[0].length;

    if (cursorOffset >= start && cursorOffset <= end) continue;

    used.add(match[0].slice(1));
  }

  return used;
}

/** 커서 앞까지 '완료된' 인자 중 위치(positional) 인자 개수를 센다. */
export function countPositionalArgs(prefix: string): number {
  const segments = splitTopLevel(prefix).slice(0, -1);
  let count = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (!trimmed) continue;
    if (/^\$[A-Za-z0-9_-]+\s*:/.test(trimmed)) continue; // 키워드 인자
    count += 1;
  }

  return count;
}

/**
 * 지금 위치에서 제안할 파라미터 이름 목록을 계산한다.
 * - 이미 이름으로 쓴 파라미터는 제외한다(중복 방지).
 * - 위치 인자로 이미 채운 만큼은 앞에서부터 제외한다.
 */
export function suggestParams(
  text: string,
  offset: number,
  params: string[],
): string[] | null {
  const call = findEnclosingCall(text, offset);

  if (!call) return null;

  const argStart = call.openParen + 1;
  const regionEnd = call.closeParen === -1 ? text.length : call.closeParen;
  const argText = text.slice(argStart, regionEnd);
  const prefix = argText.slice(0, Math.max(offset - argStart, 0));
  const used = usedParamNames(argText, argStart, offset);
  const positional = countPositionalArgs(prefix);

  return params.filter((name, index) => !used.has(name) && index >= positional);
}
