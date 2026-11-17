import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  findEnclosingCall,
  findModuleMemberContext,
  findModuleMemberToken,
  findNamespaceContext,
  extractSignatures,
  extractVariables,
  suggestParams,
  type CallSite,
  type MemberContext,
  type SignatureKind,
} from './scss/core';
import {
  findBuiltinFunction,
  parseSassModuleNamespaces,
  listBuiltinMembers,
  formatSignature,
  optionalParams,
  BUILTIN_MODULE_IDS,
  BUILTIN_MODULE_URLS,
  BUILTIN_MODULE_DESCRIPTIONS,
  BUILTIN_VARIABLES,
  type BuiltinFunction,
} from './scss/builtin-modules';
import {
  builtinModuleId,
  loadedNamespaces,
  moduleFileCandidates,
  parseForwardUrls,
  parseUseStatements,
} from './scss/modules';
import {
  collectModuleExports,
  type ModuleExports,
  type ModuleFile,
  type ModuleSignature,
} from './scss/members';
import {
  extractCustomProperties,
  findUndefinedCustomProperties,
} from './css/custom-properties';
import { declarationValueRanges, findUnknownPropertyValues } from './css/diagnostics';
import { knownCssFunctions } from './css/properties';
import { DYNAMIC_FUNCTIONS } from './css/values/tokenizer';
import { GLOBAL_FUNCTIONS } from './scss/global-functions';
import {
  findMissingRequiredArgs,
  findModuleIssues,
  findUndefinedFunctions,
  maskNonCode,
  type ModuleMember,
  type ModuleMembers,
  type StylesheetSyntax,
} from './scss/diagnostics';
import { findUndefinedVariables, visibleVariablesAt } from './scss/scopes';
import { extractAttributes, type AttributeCandidate } from './scss/selectors';
import { parseRuleSettings, resolveRuleState } from './rules';

/** The stylesheets whose selectors and custom properties are indexed. Plain CSS is included here
 * only: a `.css` file has no Sass signature to index and no `@use` module to resolve. */
const STYLESHEET_GLOB = '**/*.{scss,sass,css}';
const CONFIG_SECTION = 'sass-scss-completion';
const LANGUAGES = [{ language: 'scss' }, { language: 'sass' }, { language: 'vue' }];

/** Template languages whose attribute values and names the stylesheet selectors are completed into. */
const TEMPLATE_LANGUAGES = [
  { language: 'html' },
  { language: 'vue' },
  { language: 'svelte' },
  { language: 'astro' },
];

/** Dependency/build-output/cache directories to exclude from indexing. */
const EXCLUDED_DIRS = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'dist',
  'build',
  'out',
  '.output',
  '.data',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.angular',
  '.vercel',
  '.netlify',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vite',
  '.rollup.cache',
  'coverage',
  'tmp',
];

const MAX_FILES = 5000;

/** The custom property name being typed as the first argument of a `var(...)` call. */
const VAR_FIRST_ARG_RE = /(?:^|[^A-Za-z0-9_-])var\(\s*([A-Za-z0-9_-]*)$/;

/** A single exclude glob combining the built-in list with the user setting (`exclude`). */
function excludeGlob(): string {
  const extra = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>('exclude', [])
    .filter((pattern) => pattern.trim().length > 0);

  // Each entry is a full pattern: the built-in names become `**/<name>/**`, while a user entry is
  // used as written, so both a bare directory name (`legacy`) and a glob (`**/generated/**`) apply.
  const patterns = [...EXCLUDED_DIRS.map((dir) => `**/${dir}/**`), ...extra];

  return `{${patterns.join(',')}}`;
}

/** Plain directory names from the user setting (glob patterns are ignored), used for watcher filtering. */
function userExcludedDirs(): string[] {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>('exclude', [])
    .filter((pattern) => pattern.trim().length > 0 && !/[*?{}[\]]/.test(pattern))
    .map((pattern) => pattern.replace(/^\/+|\/+$/g, ''));
}

/** True when the path lies inside an excluded directory (built-in list or a plain-name user entry). */
function isExcludedPath(fsPath: string): boolean {
  const dirs = new Set([...EXCLUDED_DIRS, ...userExcludedDirs()]);

  return fsPath.split(/[\\/]/).some((segment) => dirs.has(segment));
}

/** The `sass-scss-completion.rules` setting, read on each call so a change takes effect at once. */
function ruleSettings() {
  return parseRuleSettings(
    vscode.workspace.getConfiguration(CONFIG_SECTION).get<Record<string, unknown>>('rules'),
  );
}

/** A signature together with the file it was declared in. */
type IndexedSignature = ModuleSignature;

/** The members one workspace file declares, plus the URLs it re-exports with `@forward`. */
type IndexedFile = ModuleFile;

/** A name brought into the global scope by `@use '...' as *`, and the module that exports it. */
interface GlobalMember {
  /** `variable` for a `$name`, otherwise the kind of callable member. */
  kind: SignatureKind | 'variable';
  name: string;
  /** Module the name came from, for the completion item detail. */
  source: string;
}

/** Module basename with the partial prefix/extension removed. */
function moduleBase(filePath: string): string {
  return path.basename(filePath).replace(/^_/, '').replace(/\.(scss|sass|css)$/i, '');
}

/** Indexes the signatures of one kind by name, keeping the parameter and required-parameter lists. */
function memberIndex(signatures: IndexedSignature[], kind: SignatureKind): Map<string, ModuleMember> {
  const members = new Map<string, ModuleMember>();

  for (const signature of signatures) {
    if (signature.kind !== kind) continue;

    members.set(signature.name, {
      params: signature.params,
      required: new Set(signature.required),
    });
  }

  return members;
}

/** Collects @function / @mixin signatures and variables from the workspace, indexed by name/file. */
class SignatureIndex {
  private definitions = new Map<string, IndexedSignature>();
  private files = new Map<string, IndexedFile>();
  private customProperties = new Set<string>();
  private selectors = new Map<string, AttributeCandidate[]>();

  async rebuild(): Promise<void> {
    const definitions = new Map<string, IndexedSignature>();
    const files = new Map<string, IndexedFile>();
    const customProperties = new Set<string>();
    const selectors = new Map<string, AttributeCandidate[]>();
    let uris: vscode.Uri[] = [];

    try {
      uris = await vscode.workspace.findFiles(STYLESHEET_GLOB, excludeGlob(), MAX_FILES);
    } catch {
      uris = [];
    }

    for (const uri of uris) {
      let text: string;

      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      } catch {
        continue;
      }

      const syntax: StylesheetSyntax = uri.fsPath.toLowerCase().endsWith('.css') ? 'css' : 'scss';

      selectors.set(uri.fsPath, extractAttributes(text, syntax));

      for (const name of extractCustomProperties(text, syntax)) customProperties.add(name);

      // A `.css` file takes part in the selector and custom-property indexes only. `@use` never
      // loads a plain `.css` file, so a `.css` path in the module index would make a `@use 'foo'`
      // that has no Sass target resolve to `foo.css` and report its (empty) members as unknown.
      if (syntax === 'css') continue;

      const signatures = extractSignatures(text);

      files.set(uri.fsPath, {
        functions: signatures.map((signature) => ({ ...signature, file: uri.fsPath })),
        variables: extractVariables(text),
        forwards: parseForwardUrls(text),
      });

      for (const signature of signatures) {
        if (!definitions.has(signature.name)) {
          definitions.set(signature.name, { ...signature, file: uri.fsPath });
        }
      }
    }

    this.definitions = definitions;
    this.files = files;
    this.customProperties = customProperties;
    this.selectors = selectors;
  }

  get(name: string): IndexedSignature | null {
    return this.definitions.get(name) ?? null;
  }

  /** The custom property names declared anywhere in the workspace. */
  customPropertyNames(): ReadonlySet<string> {
    return this.customProperties;
  }

  /** The attributes one stylesheet's selectors name. */
  selectorsOf(filePath: string): AttributeCandidate[] {
    return this.selectors.get(filePath) ?? [];
  }

  /** The stylesheets whose selectors were indexed. */
  selectorFiles(): string[] {
    return [...this.selectors.keys()];
  }

  /** Resolves a `@use`/`@forward` URL to the actual module file relative to `fromFile`. */
  resolveModulePath(url: string, fromFile: string): string | null {
    for (const candidate of moduleFileCandidates(url, fromFile)) {
      if (this.files.has(candidate)) return candidate;
    }

    const base = moduleBase(url);

    for (const fsPath of this.files.keys()) {
      if (moduleBase(fsPath) === base) return fsPath;
    }

    return null;
  }

  /** The members a module exports, following the files it re-exports with `@forward`. */
  exportsOf(filePath: string): ModuleExports {
    return collectModuleExports(filePath, this.files, (url, fromFile) =>
      this.resolveModulePath(url, fromFile),
    );
  }
}

/** One entry of the `groups` setting: the stylesheets and the templates they apply to. */
interface GroupSetting {
  styles?: string[];
  targets?: string[];
  label?: string;
}

/** One stylesheet that defines a suggestion, with the text shown beside the suggestion. */
interface Origin {
  /** The folder and file name of the stylesheet, shown at the top of the documentation panel. */
  path: string;
  /** The group label, or an empty string when the group names no label. */
  label: string;
  /** The comment written above the selector, or null when it has none. */
  comment: string | null;
}

/** The completion data one group contributes: the values and names, each with its origins. */
interface CompletionGroup {
  /** Glob patterns for the templates the group applies to; an empty list applies it to every template. */
  targets: string[];
  /** Attribute name → value → the stylesheets that define it. */
  values: Map<string, Map<string, Origin[]>>;
  /** Attribute name → the stylesheets that define it. */
  names: Map<string, Origin[]>;
}

/**
 * The folder and file name of a stylesheet, with forward slashes, shown beside a suggestion in place
 * of a group label. Only the last directory is kept, so a deep path does not crowd the row, and a
 * file at the workspace root shows its name alone.
 */
function shortPath(fsPath: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath));
  const segments = folder
    ? path.relative(folder.uri.fsPath, fsPath).split(path.sep)
    : [path.basename(fsPath)];

  return segments.filter((segment) => segment !== '').slice(-2).join('/');
}

/** The indexed stylesheets the glob patterns match; an empty pattern list selects every indexed file. */
async function selectFiles(
  patterns: string[],
  indexed: ReadonlySet<string>,
): Promise<Set<string>> {
  if (patterns.length === 0) return new Set(indexed);

  const found = new Set<string>();

  for (const pattern of patterns) {
    let uris: vscode.Uri[] = [];

    try {
      uris = await vscode.workspace.findFiles(pattern, excludeGlob(), MAX_FILES);
    } catch {
      uris = [];
    }

    for (const uri of uris) if (indexed.has(uri.fsPath)) found.add(uri.fsPath);
  }

  return found;
}

/** Adds `origin` to the list stored under `key`, ignoring one already recorded. */
function addOrigin(map: Map<string, Origin[]>, key: string, origin: Origin): void {
  const list = map.get(key) ?? [];

  const known = list.some(
    (other) => other.path === origin.path && other.label === origin.label && other.comment === origin.comment,
  );

  if (!known) list.push(origin);

  map.set(key, list);
}

/** The value and name maps a set of stylesheets contributes, each entry keeping its origins. */
function aggregate(
  index: SignatureIndex,
  files: Map<string, string>,
): Pick<CompletionGroup, 'values' | 'names'> {
  const values = new Map<string, Map<string, Origin[]>>();
  const names = new Map<string, Origin[]>();

  for (const [file, label] of files) {
    const originPath = shortPath(file);

    for (const candidate of index.selectorsOf(file)) {
      // Attribute names are matched without case, the way HTML matches them.
      const attribute = candidate.name.toLowerCase();
      const origin: Origin = { path: originPath, label, comment: candidate.comment };

      addOrigin(names, attribute, origin);

      if (candidate.value === null) continue;

      const byValue = values.get(attribute) ?? new Map<string, Origin[]>();

      addOrigin(byValue, candidate.value, origin);
      values.set(attribute, byValue);
    }
  }

  return { values, names };
}

/**
 * Builds the completion groups. With no `groups` setting, one group covers the whole workspace and
 * its suggestions carry no label, so the path of the stylesheet fills the row in its place.
 */
async function buildGroups(index: SignatureIndex): Promise<CompletionGroup[]> {
  const configured = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<GroupSetting[]>('groups', []);

  if (configured.length === 0) {
    const files = new Map<string, string>();

    for (const file of index.selectorFiles()) files.set(file, '');

    return [{ targets: [], ...aggregate(index, files) }];
  }

  const indexed = new Set(index.selectorFiles());
  const groups: CompletionGroup[] = [];

  for (const entry of configured) {
    const label = entry.label?.trim() ?? '';
    const files = new Map<string, string>();

    for (const file of await selectFiles(entry.styles ?? [], indexed)) files.set(file, label);

    groups.push({ targets: entry.targets ?? [], ...aggregate(index, files) });
  }

  return groups;
}

/** The attribute name and value being typed at an offset in a template. */
interface AttributeContext {
  /** The attribute whose value is being typed, or null at an attribute-name position. */
  attribute: string | null;
  /** The text already typed for the current token. */
  prefix: string;
  /** Offset where the current token starts. */
  start: number;
}

/** `<div class="btn` — an attribute assignment whose value is still open. */
const ATTR_VALUE_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])([^"']*)$/;

/** `<div cl` — a partial attribute name, after the tag name. */
const ATTR_NAME_RE = /\s([-A-Za-z0-9_:.]*)$/;

/** The attribute name and value context at `offset`, or null when the cursor is not inside a tag. */
function attributeContext(text: string, offset: number): AttributeContext | null {
  const before = text.slice(0, offset);
  const open = before.lastIndexOf('<');

  if (open === -1) return null;
  if (before.lastIndexOf('>') > open) return null;

  const tag = before.slice(open);

  if (tag.startsWith('<!')) return null;

  const value = tag.match(ATTR_VALUE_RE);

  if (value) {
    const typed = value[3];
    const space = typed.search(/\s[^\s]*$/);
    const prefix = space === -1 ? typed : typed.slice(space + 1);

    return { attribute: value[1].toLowerCase(), prefix, start: offset - prefix.length };
  }

  const name = tag.match(ATTR_NAME_RE);

  if (!name) return null;

  return { attribute: null, prefix: name[1], start: offset - name[1].length };
}

/**
 * True when a target pattern covers the document. A document filter matches the pattern against the
 * full path, so a workspace-relative pattern such as `src/` + `**` + `/*.vue` also needs the leading
 * `**` + `/` that a `findFiles` glob gets for free. Both forms are tried, so a target works as
 * written, just like a `styles` glob.
 */
function matchesTarget(pattern: string, document: vscode.TextDocument): boolean {
  const candidates = /^(\*\*\/|\/)/.test(pattern) ? [pattern] : [`**/${pattern}`, pattern];

  return candidates.some((candidate) => {
    try {
      return vscode.languages.match({ pattern: candidate }, document) > 0;
    } catch {
      return false;
    }
  });
}

/** True when a group's targets cover the document. */
function appliesTo(group: CompletionGroup, document: vscode.TextDocument): boolean {
  if (group.targets.length === 0) return true;

  return group.targets.some((pattern) => matchesTarget(pattern, document));
}

/** True when a comment is worth showing. */
function hasComment(comment: string | null): comment is string {
  return comment !== null && comment !== '';
}

/** The source paths a suggestion came from, sorted. */
function sourcePaths(origins: readonly Origin[]): string {
  return [...new Set(origins.map((origin) => origin.path))].sort().join(', ');
}

/** The group labels a suggestion came from, sorted; empty when no group names one. */
function groupLabels(origins: readonly Origin[]): string {
  return [...new Set(origins.map((origin) => origin.label))]
    .filter((label) => label !== '')
    .sort()
    .join(', ');
}

/** The comments written above the selectors a suggestion came from, in source order. */
function originComments(origins: readonly Origin[]): string[] {
  return [...new Set(origins.map((origin) => origin.comment).filter(hasComment))];
}

/** The text shown to the right of the name: the group label, or the source path when it has none. */
function rowDescription(origins: readonly Origin[]): string {
  const labels = groupLabels(origins);

  return labels !== '' ? labels : sourcePaths(origins);
}

/**
 * The documentation panel: the source path on top of the comments written above the selectors. The
 * path is left out when the row already shows it in place of a label, so it only appears once.
 */
function originDocumentation(origins: readonly Origin[]): vscode.MarkdownString | null {
  const parts = groupLabels(origins) !== '' ? [sourcePaths(origins)] : [];

  parts.push(...originComments(origins));

  return parts.length > 0 ? new vscode.MarkdownString(parts.join('\n\n')) : null;
}

/** The value suggestions for the attribute being typed, with the label, path, and comment of each. */
function attributeValueItems(
  attribute: string,
  context: AttributeContext,
  document: vscode.TextDocument,
  groups: readonly CompletionGroup[],
): vscode.CompletionItem[] {
  const merged = new Map<string, Origin[]>();

  for (const group of groups) {
    if (!appliesTo(group, document)) continue;

    for (const [value, origins] of group.values.get(attribute) ?? []) {
      for (const origin of origins) addOrigin(merged, value, origin);
    }
  }

  const range = new vscode.Range(
    document.positionAt(context.start),
    document.positionAt(context.start + context.prefix.length),
  );

  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, origins]) => {
      const item = new vscode.CompletionItem(
        { label: value, description: rowDescription(origins) },
        vscode.CompletionItemKind.Value,
      );

      const documentation = originDocumentation(origins);

      if (documentation) item.documentation = documentation;
      item.insertText = value;
      item.range = range;
      item.filterText = value;
      item.sortText = value;

      return item;
    });
}

/** The attribute-name suggestions, with the label, path, and comment of each. */
function attributeNameItems(
  context: AttributeContext,
  document: vscode.TextDocument,
  groups: readonly CompletionGroup[],
): vscode.CompletionItem[] {
  const merged = new Map<string, Origin[]>();

  for (const group of groups) {
    if (!appliesTo(group, document)) continue;

    for (const [name, origins] of group.names) {
      for (const origin of origins) addOrigin(merged, name, origin);
    }
  }

  const range = new vscode.Range(
    document.positionAt(context.start),
    document.positionAt(context.start + context.prefix.length),
  );

  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, origins]) => {
      const item = new vscode.CompletionItem(
        { label: name, description: rowDescription(origins) },
        vscode.CompletionItemKind.Property,
      );

      const documentation = originDocumentation(origins);

      if (documentation) item.documentation = documentation;
      item.insertText = name;
      item.range = range;
      item.filterText = name;
      item.sortText = name;

      return item;
    });
}

/** The `$variable` or name token directly before the cursor, with the offset it starts at. */
function typedToken(text: string, offset: number): { token: string; start: number } {
  let start = offset;

  while (start > 0 && /[A-Za-z0-9_-]/.test(text[start - 1])) start -= 1;
  if (start > 0 && text[start - 1] === '$') start -= 1;

  return { token: text.slice(start, offset), start };
}

/** The replacement range covering the `$prefix` token being typed before the cursor. */
function prefixRange(
  document: vscode.TextDocument,
  text: string,
  offset: number,
): vscode.Range {
  const { start } = typedToken(text, offset);

  return new vscode.Range(document.positionAt(start), document.positionAt(offset));
}

interface ResolvedDefinition {
  params: string[];
  detail: string;
  description?: string;
  paramDocs?: Record<string, string>;
  url?: string;
  /** Names of rest (variadic) parameters excluded from suggestions since they cannot be passed as keyword arguments. */
  rest?: Set<string>;
  /** True when this is a built-in module definition. Provides required/optional, default, and example info. */
  builtin?: boolean;
  /** Optional parameters (with defaults) and their default values. Only populated for built-in modules. */
  defaults?: Record<string, string>;
  /** A practical usage example (SCSS). Only populated for built-in modules. */
  example?: string;
}

/**
 * Resolves the call's namespace as a built-in module first; otherwise uses the workspace index.
 * If the namespace is a built-in module but the function does not exist, it does not fall back to the workspace.
 */
function resolveDefinition(
  text: string,
  call: CallSite,
  index: SignatureIndex,
): ResolvedDefinition | null {
  if (call.namespace) {
    const moduleId = parseSassModuleNamespaces(text).get(call.namespace);

    if (moduleId) {
      const builtin = findBuiltinFunction(moduleId, call.name);

      if (!builtin) return null;

      const kindLabel = builtin.kind === 'mixin' ? '@mixin' : '@function';
      const callable = `${builtin.module}.${builtin.name}`;

      return {
        params: builtin.params,
        detail: `${kindLabel} · sass:${builtin.module} ${callable}(${formatSignature(builtin)})`,
        description: builtin.description,
        paramDocs: builtin.paramDocs,
        url: builtin.url,
        rest: new Set(builtin.rest ?? []),
        builtin: true,
        defaults: builtin.defaults ?? {},
        example: builtin.example,
      };
    }
  }

  const definition = index.get(call.name);

  if (!definition) return null;

  return {
    params: definition.params,
    detail: `${definition.kind === 'mixin' ? '@mixin' : '@function'} · ${path.basename(
      definition.file,
    )}`,
  };
}

/** The replacement range covering the member prefix (includes `$` for variables). */
function memberRange(
  document: vscode.TextDocument,
  offset: number,
  prefix: string,
): vscode.Range {
  return new vscode.Range(document.positionAt(offset - prefix.length), document.positionAt(offset));
}

function kindLabel(kind: string): string {
  return kind === 'mixin' ? '@mixin' : '@function';
}

function itemKind(kind: string): vscode.CompletionItemKind {
  return kind === 'mixin' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Function;
}

function signatureOf(params: string[], rest?: string[]): string {
  const restNames = new Set(rest ?? []);

  return params.map((name) => (restNames.has(name) ? `$${name}...` : `$${name}`)).join(', ');
}

/** Documentation for a built-in module function/mixin (description + required/optional + example + link). */
function builtinMemberDocs(entry: BuiltinFunction): vscode.MarkdownString {
  const optional = new Set(optionalParams(entry));
  const rest = new Set(entry.rest ?? []);
  const lines: string[] = [entry.description, '', '**Parameters**'];

  for (const param of entry.params) {
    const doc = entry.paramDocs[param];
    let tag: string;

    if (rest.has(param)) tag = 'rest';
    else if (optional.has(param)) tag = `optional (default \`${entry.defaults?.[param]}\`)`;
    else tag = 'required';

    lines.push(`- \`$${param}\` — ${tag}${doc ? ` · ${doc}` : ''}`);
  }

  lines.push('', '**Example**', '```scss', entry.example, '```', `[Docs](${entry.url})`);

  return new vscode.MarkdownString(lines.join('\n'));
}

/** Completion items for built-in module members (functions, mixins, variables). */
function builtinMemberItems(
  moduleId: string,
  context: MemberContext,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];

  // `ns.$` lists variables only; `ns.` lists variables together with the callables.
  if (context.variable || context.prefix === '') {
    for (const variable of BUILTIN_VARIABLES[moduleId] ?? []) {
      const item = new vscode.CompletionItem(`$${variable.name}`, vscode.CompletionItemKind.Variable);

      item.insertText = `$${variable.name}`;
      item.range = range;
      item.detail = `@variable · sass:${moduleId}`;
      item.documentation = new vscode.MarkdownString(
        `${variable.description}\n\n[Docs](${BUILTIN_MODULE_URLS[moduleId]})`,
      );

      items.push(item);
    }
  }

  // A `$` means the user is naming a variable, so callables are left out.
  if (!context.variable) {
    for (const entry of listBuiltinMembers(moduleId)) {
      const item = new vscode.CompletionItem(entry.name, itemKind(entry.kind));

      item.insertText = entry.name;
      item.range = range;
      item.detail = `${kindLabel(entry.kind)} · sass:${moduleId} ${moduleId}.${entry.name}(${formatSignature(entry)})`;
      item.documentation = builtinMemberDocs(entry);

      items.push(item);
    }
  }

  return items;
}

/** Completion items for workspace module members (functions, mixins, variables). */
function workspaceMemberItems(
  exports: ModuleExports,
  filePath: string,
  context: MemberContext,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const label = path.basename(filePath);
  const items: vscode.CompletionItem[] = [];

  // `ns.$` lists variables only; `ns.` lists variables together with the callables.
  if (context.variable || context.prefix === '') {
    for (const name of exports.variables) {
      const item = new vscode.CompletionItem(`$${name}`, vscode.CompletionItemKind.Variable);

      item.insertText = `$${name}`;
      item.range = range;
      item.detail = `@variable · ${label}`;

      items.push(item);
    }
  }

  // A `$` means the user is naming a variable, so callables are left out.
  if (!context.variable) {
    for (const definition of exports.functions) {
      const item = new vscode.CompletionItem(definition.name, itemKind(definition.kind));

      item.insertText = definition.name;
      item.range = range;
      item.detail = `${kindLabel(definition.kind)} · ${label}(${signatureOf(definition.params)})`;

      items.push(item);
    }
  }

  return items;
}

export function activate(context: vscode.ExtensionContext): void {
  const index = new SignatureIndex();
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection('sass-scss-completion');

  /**
   * Names used without a namespace because of `@use '...' as *`, deduplicated: the members of the
   * workspace or built-in module the statement loads, with its `@forward` re-exports followed.
   */
  const globalMembers = (text: string, document: vscode.TextDocument): GlobalMember[] => {
    const members = new Map<string, GlobalMember>();
    const add = (kind: GlobalMember['kind'], name: string, source: string): void => {
      const key = `${kind}:${name}`;

      if (!members.has(key)) members.set(key, { kind, name, source });
    };

    for (const use of parseUseStatements(text)) {
      if (!use.global) continue;

      const moduleId = builtinModuleId(use.url);

      if (moduleId) {
        const source = `sass:${moduleId}`;

        for (const variable of BUILTIN_VARIABLES[moduleId] ?? []) {
          add('variable', variable.name, source);
        }

        for (const entry of listBuiltinMembers(moduleId)) add(entry.kind, entry.name, source);

        continue;
      }

      const resolved = index.resolveModulePath(use.url, document.uri.fsPath);

      if (resolved === null) continue;

      const source = path.basename(resolved);
      const exports = index.exportsOf(resolved);

      for (const name of exports.variables) add('variable', name, source);

      for (const signature of exports.functions) add(signature.kind, signature.name, source);
    }

    return [...members.values()];
  };

  const globalVariableNames = (members: readonly GlobalMember[]): Set<string> =>
    new Set(
      members.filter((member) => member.kind === 'variable').map((member) => member.name),
    );

  /**
   * Function names that can be called without a namespace, and so must never be reported as a
   * typo: the Sass global functions, the plain CSS functions Sass passes through, the functions
   * the document declares, and the functions brought in by `@use '...' as *`.
   */
  const callableFunctions = (text: string, members: readonly GlobalMember[]): Set<string> => {
    const names = new Set<string>([...GLOBAL_FUNCTIONS, ...DYNAMIC_FUNCTIONS, ...knownCssFunctions()]);

    for (const signature of extractSignatures(text)) {
      if (signature.kind === 'function') names.add(signature.name);
    }

    for (const member of members) {
      if (member.kind === 'function') names.add(member.name);
    }

    return names;
  };

  /** Members of the workspace modules loaded with `@use`, keyed by namespace. */
  const workspaceModules = (
    text: string,
    document: vscode.TextDocument,
  ): Map<string, ModuleMembers> => {
    const modules = new Map<string, ModuleMembers>();

    for (const use of parseUseStatements(text)) {
      if (use.global || !use.namespace) continue;
      if (builtinModuleId(use.url)) continue;

      const resolved = index.resolveModulePath(use.url, document.uri.fsPath);

      if (resolved === null) continue;

      const exports = index.exportsOf(resolved);

      // A re-export the index cannot resolve leaves members unaccounted for, so the module is
      // not judged: reporting them would flag valid code as unknown.
      if (!exports.complete) continue;

      modules.set(use.namespace, {
        functions: memberIndex(exports.functions, 'function'),
        mixins: memberIndex(exports.functions, 'mixin'),
        variables: new Set(exports.variables),
      });
    }

    return modules;
  };

  /** Shows document errors (missing required arguments, unknown members, undefined variables) as diagnostics. */
  const updateDiagnostics = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'scss' && document.languageId !== 'sass') return;

    const text = document.getText();
    const members = globalMembers(text, document);
    // The CSS parser understands SCSS syntax only, so indented Sass is left out of the value checks.
    const scssSyntax = document.languageId === 'scss';
    const functions = scssSyntax ? callableFunctions(text, members) : new Set<string>();
    // Custom properties declared in the workspace index plus the ones this document declares,
    // which the index may not have seen yet.
    const customProperties = new Set([
      ...index.customPropertyNames(),
      ...extractCustomProperties(text),
    ]);
    const issues = [
      ...findMissingRequiredArgs(text),
      ...findModuleIssues(text, workspaceModules(text, document)),
      ...findUndefinedVariables(text, globalVariableNames(members)),
      ...findUndefinedCustomProperties(text, customProperties),
      ...(scssSyntax
        ? [
            ...findUnknownPropertyValues(text, functions),
            ...findUndefinedFunctions(text, functions, declarationValueRanges(text)),
          ]
        : []),
    ];
    const settings = ruleSettings();
    const diagnostics: vscode.Diagnostic[] = [];

    for (const issue of issues) {
      // A rule the project turned off is dropped, `warn` and `error` override the severity the
      // check gives its issues, and a rule the setting names nowhere keeps that severity.
      const state = resolveRuleState(issue.rule, settings, issue.severity ?? 'error');

      if (state === 'off') continue;

      const range = new vscode.Range(
        document.positionAt(issue.start),
        document.positionAt(issue.end),
      );
      const severity =
        state === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, issue.message, severity);

      diagnostic.source = 'sass-scss-completion';
      diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
  };

  const paramProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const masked = maskNonCode(text);
      const offset = document.offsetAt(position);
      const call = findEnclosingCall(masked, offset);

      if (!call) return undefined;

      const resolved = resolveDefinition(text, call, index);

      if (!resolved) return undefined;

      const suggestions = suggestParams(masked, offset, resolved.params)?.filter(
        (name) => !resolved.rest?.has(name),
      );

      if (!suggestions || suggestions.length === 0) return undefined;

      const range = prefixRange(document, text, offset);
      const items = suggestions.map((name) => {
        const item = new vscode.CompletionItem(
          `$${name}`,
          vscode.CompletionItemKind.Variable,
        );

        item.insertText = `$${name}`;
        item.range = range;
        item.detail = resolved.detail;

        const docs: string[] = [];

        if (resolved.description) docs.push(resolved.description);

        if (resolved.builtin) {
          const defaultValue = resolved.defaults?.[name];
          const tag = defaultValue !== undefined ? `optional (default \`${defaultValue}\`)` : 'required';
          const paramDoc = resolved.paramDocs?.[name];

          docs.push(`\`$${name}\` — ${tag}${paramDoc ? ` · ${paramDoc}` : ''}`);
        } else if (resolved.paramDocs?.[name]) {
          docs.push(resolved.paramDocs[name]);
        }

        if (resolved.example) docs.push(`**Example**\n\`\`\`scss\n${resolved.example}\n\`\`\``);
        if (resolved.url) docs.push(`[Docs](${resolved.url})`);

        if (docs.length > 0) {
          item.documentation = new vscode.MarkdownString(docs.join('\n\n'));
        }

        return item;
      });

      return new vscode.CompletionList(items, false);
    },
  };

  const memberProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const memberContext = findModuleMemberContext(text, offset);

      if (!memberContext) return undefined;

      const statement = parseUseStatements(text).find(
        (use) => use.namespace === memberContext.namespace,
      );

      if (!statement) return undefined;

      const range = memberRange(document, offset, memberContext.prefix);
      const moduleId = builtinModuleId(statement.url);
      let items: vscode.CompletionItem[] = [];

      if (moduleId) {
        items = builtinMemberItems(moduleId, memberContext, range);
      } else {
        const resolved = index.resolveModulePath(statement.url, document.uri.fsPath);

        if (resolved !== null) {
          items = workspaceMemberItems(index.exportsOf(resolved), resolved, memberContext, range);
        }
      }

      return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
    },
  };

  /**
   * The `$` trigger. A `$` offers the variables in scope at the cursor: the file's own
   * declarations, parameters, and loop variables, together with the `@use '...' as *` members.
   * A bare name offers the functions and mixins brought in by `@use '...' as *`.
   */
  const globalMemberProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const masked = maskNonCode(text);
      const offset = document.offsetAt(position);

      // Nothing is completed inside a string or a comment.
      if (masked[offset - 1] !== text[offset - 1]) return undefined;

      const { token, start } = typedToken(text, offset);
      const previous = masked.slice(0, start).trimEnd().slice(-1);

      // `ns.member` and `ns.$member` belong to the module member provider.
      if (previous === '.' || previous === '$') return undefined;

      const members = globalMembers(text, document);
      const range = new vscode.Range(document.positionAt(start), document.positionAt(offset));

      if (token.startsWith('$')) {
        const local = new Set(visibleVariablesAt(text, start));
        const items: vscode.CompletionItem[] = [...local].sort().map((name) => {
          const item = new vscode.CompletionItem(`$${name}`, vscode.CompletionItemKind.Variable);

          item.insertText = `$${name}`;
          item.range = range;
          item.detail = 'SCSS variable';

          return item;
        });

        for (const member of members) {
          if (member.kind !== 'variable' || local.has(member.name)) continue;

          const item = new vscode.CompletionItem(
            `$${member.name}`,
            vscode.CompletionItemKind.Variable,
          );

          item.insertText = `$${member.name}`;
          item.range = range;
          item.detail = `@variable · ${member.source} (as *)`;

          items.push(item);
        }

        return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
      }

      const callables = members.filter((member) => member.kind !== 'variable');

      if (callables.length === 0) return undefined;

      const items = callables.map((member) => {
        const item = new vscode.CompletionItem(member.name, itemKind(member.kind));

        item.insertText = member.name;
        item.range = range;
        item.detail = `${kindLabel(member.kind)} · ${member.source} (as *)`;

        return item;
      });

      return new vscode.CompletionList(items, false);
    },
  };

  /**
   * Custom property names, offered inside the first argument of a `var(...)` call. The names come
   * from the workspace index and from the document being edited, which the index may not have seen
   * yet.
   */
  const customPropertyProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const masked = maskNonCode(text);
      const offset = document.offsetAt(position);
      const match = masked.slice(0, offset).match(VAR_FIRST_ARG_RE);

      if (!match) return undefined;

      const typed = match[1];

      // The first argument of `var()` is always a custom property name, so nothing else is offered.
      if (typed !== '' && !typed.startsWith('-')) return undefined;

      const names = new Set([...index.customPropertyNames(), ...extractCustomProperties(text)]);

      if (names.size === 0) return undefined;

      const start = offset - typed.length;
      const range = new vscode.Range(document.positionAt(start), document.positionAt(offset));
      const items = [...names].sort().map((name) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);

        item.insertText = name;
        item.range = range;
        item.detail = 'CSS custom property';

        return item;
      });

      return new vscode.CompletionList(items, false);
    },
  };

  const namespaceProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const context = findNamespaceContext(text, offset);

      if (!context) return undefined;

      // While typing a module path such as `@use 'sass:col`, usePathProvider handles it.
      if (/@use\s+['"][^'"]*$/.test(text.slice(0, offset))) return undefined;

      // Namespaces are not used inside function call arguments.
      if (findEnclosingCall(text, offset)) return undefined;

      const namespaces = loadedNamespaces(text).filter((entry) =>
        entry.namespace.startsWith(context.prefix),
      );

      if (namespaces.length === 0) return undefined;

      const range = new vscode.Range(
        document.positionAt(context.start),
        document.positionAt(offset),
      );
      const items = namespaces.map((entry) => {
        const item = new vscode.CompletionItem(entry.namespace, vscode.CompletionItemKind.Module);

        item.insertText = entry.namespace;
        item.range = range;
        item.detail = `@use · ${entry.url}`;

        return item;
      });

      return new vscode.CompletionList(items, false);
    },
  };

  const usePathProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const match = text.slice(0, offset).match(/@use\s+['"]([^'"]*)$/);

      if (!match) return undefined;

      const partial = match[1];

      if (!/^sass:?[A-Za-z0-9_-]*$/.test(partial)) return undefined;

      const range = new vscode.Range(
        document.positionAt(offset - partial.length),
        document.positionAt(offset),
      );
      const items = BUILTIN_MODULE_IDS.map((id) => `sass:${id}`)
        .filter((url) => url.startsWith(partial))
        .map((url) => {
          const moduleId = url.slice('sass:'.length);
          const item = new vscode.CompletionItem(url, vscode.CompletionItemKind.Module);

          item.insertText = url;
          item.range = range;
          item.detail = `@use · Sass built-in module`;
          item.documentation = new vscode.MarkdownString(
            `${BUILTIN_MODULE_DESCRIPTIONS[moduleId]}\n\n[Docs](${BUILTIN_MODULE_URLS[moduleId]})`,
          );

          return item;
        });

      return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const token = findModuleMemberToken(maskNonCode(text), offset);

      if (!token) return undefined;

      const statement = parseUseStatements(text).find(
        (use) => use.namespace === token.namespace,
      );

      if (!statement) return undefined;

      const range = new vscode.Range(
        document.positionAt(token.start),
        document.positionAt(token.end),
      );
      const moduleId = builtinModuleId(statement.url);

      if (token.variable) {
        if (!moduleId) return undefined;

        const variable = (BUILTIN_VARIABLES[moduleId] ?? []).find(
          (entry) => entry.name === token.name,
        );

        if (!variable) return undefined;

        return new vscode.Hover(
          new vscode.MarkdownString(
            `${variable.description}\n\n[Docs](${BUILTIN_MODULE_URLS[moduleId]})`,
          ),
          range,
        );
      }

      if (moduleId) {
        const entry = findBuiltinFunction(moduleId, token.name);

        return entry ? new vscode.Hover(builtinMemberDocs(entry), range) : undefined;
      }

      const resolved = index.resolveModulePath(statement.url, document.uri.fsPath);

      if (resolved === null) return undefined;

      const definition = index.exportsOf(resolved).functions.find((fn) => fn.name === token.name);

      if (!definition) return undefined;

      const markdown = new vscode.MarkdownString(
        [
          `\`${kindLabel(definition.kind)}\` · ${path.basename(definition.file)}`,
          '',
          '```scss',
          `${token.namespace}.${definition.name}(${signatureOf(definition.params)})`,
          '```',
        ].join('\n'),
      );

      return new vscode.Hover(markdown, range);
    },
  };

  /** The completion groups, derived from the `groups` setting and the current index. */
  let groups: CompletionGroup[] = [];

  /** Recomputes the completion groups from the setting and the freshly built index. */
  const refreshGroups = async (): Promise<void> => {
    groups = await buildGroups(index);
  };

  /** Rebuilds the index, then the groups that are derived from it. */
  const rebuildAll = async (): Promise<void> => {
    await index.rebuild();
    await refreshGroups();
  };

  /**
   * The class/id/attribute selectors a stylesheet defines, offered inside the matching attribute of
   * a template. Which stylesheets apply to which templates is resolved by the `groups` setting.
   */
  const templateProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const context = attributeContext(text, offset);

      if (!context) return undefined;

      const items =
        context.attribute === null
          ? attributeNameItems(context, document, groups)
          : attributeValueItems(context.attribute, context, document, groups);

      return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANGUAGES, paramProvider, '$', ',', '('),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, memberProvider, '.', '$'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, globalMemberProvider, '$'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, customPropertyProvider, '-'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, usePathProvider, "'", '"', ':'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, namespaceProvider),
    vscode.languages.registerHoverProvider(LANGUAGES, hoverProvider),
    vscode.languages.registerCompletionItemProvider(
      TEMPLATE_LANGUAGES,
      templateProvider,
      '"',
      "'",
      '=',
    ),
  );

  rebuildAll();

  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      rebuildAll();
    }, 300);
  };

  /** Watcher callback that ignores changes inside excluded directories. */
  const onWatchedFile = (uri: vscode.Uri): void => {
    if (isExcludedPath(uri.fsPath)) return;
    scheduleRebuild();
  };

  const watcher = vscode.workspace.createFileSystemWatcher(STYLESHEET_GLOB);

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(onWatchedFile),
    watcher.onDidCreate(onWatchedFile),
    watcher.onDidDelete(onWatchedFile),
    vscode.workspace.onDidSaveTextDocument((document) => {
      updateDiagnostics(document);
      if (/\.(scss|sass|css)$/i.test(document.uri.fsPath)) scheduleRebuild();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.rules`)) {
        for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
      }

      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.exclude`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.groups`)
      ) {
        scheduleRebuild();
      }
    }),
    diagnosticCollection,
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnosticCollection.delete(document.uri)),
  );

  for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
}

export function deactivate(): void {}
