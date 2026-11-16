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
  type Signature,
  type SignatureKind,
} from './core';
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
} from './builtin-modules';
import { builtinModuleId, loadedNamespaces, moduleFileCandidates, parseUseStatements } from './modules';
import {
  findMissingRequiredArgs,
  findModuleIssues,
  findUndefinedVariables,
  maskNonCode,
  type ModuleMember,
  type ModuleMembers,
} from './diagnostics';

const GLOB = '**/*.{scss,sass}';
const CONFIG_SECTION = 'sass-scss-completion';
const LANGUAGES = [{ language: 'scss' }, { language: 'sass' }, { language: 'vue' }];

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

/** A single exclude glob combining the built-in list with the user setting (`exclude`). */
function excludeGlob(): string {
  const extra = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>('exclude', [])
    .filter((pattern) => pattern.trim().length > 0);

  return `**/{${[...EXCLUDED_DIRS, ...extra].join(',')}}/**`;
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

interface IndexedSignature extends Signature {
  file: string;
}

interface IndexedFile {
  functions: IndexedSignature[];
  variables: string[];
  /** True when the file re-exports other files with `@forward`, so its own member list is incomplete. */
  forwarded: boolean;
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

  async rebuild(): Promise<void> {
    const definitions = new Map<string, IndexedSignature>();
    const files = new Map<string, IndexedFile>();
    let uris: vscode.Uri[] = [];

    try {
      uris = await vscode.workspace.findFiles(GLOB, excludeGlob(), MAX_FILES);
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

      const signatures = extractSignatures(text);

      files.set(uri.fsPath, {
        functions: signatures.map((signature) => ({ ...signature, file: uri.fsPath })),
        variables: extractVariables(text),
        forwarded: /@forward\b/.test(maskNonCode(text)),
      });

      for (const signature of signatures) {
        if (!definitions.has(signature.name)) {
          definitions.set(signature.name, { ...signature, file: uri.fsPath });
        }
      }
    }

    this.definitions = definitions;
    this.files = files;
  }

  get(name: string): IndexedSignature | null {
    return this.definitions.get(name) ?? null;
  }

  /** Resolves a `@use` URL to the actual module file relative to the current file. */
  resolveModule(url: string, fromFile: string): { path: string; file: IndexedFile } | null {
    for (const candidate of moduleFileCandidates(url, fromFile)) {
      const file = this.files.get(candidate);

      if (file) return { path: candidate, file };
    }

    const base = moduleBase(url);

    for (const [fsPath, file] of this.files) {
      if (moduleBase(fsPath) === base) return { path: fsPath, file };
    }

    return null;
  }
}

/** The replacement range covering the `$prefix` token being typed before the cursor. */
function prefixRange(
  document: vscode.TextDocument,
  text: string,
  offset: number,
): vscode.Range {
  let start = offset;

  while (start > 0 && /[A-Za-z0-9_-]/.test(text[start - 1])) start -= 1;
  if (start > 0 && text[start - 1] === '$') start -= 1;

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
  if (context.variable) {
    return (BUILTIN_VARIABLES[moduleId] ?? []).map((variable) => {
      const item = new vscode.CompletionItem(`$${variable.name}`, vscode.CompletionItemKind.Variable);

      item.insertText = `$${variable.name}`;
      item.range = range;
      item.detail = `@variable · sass:${moduleId}`;
      item.documentation = new vscode.MarkdownString(
        `${variable.description}\n\n[Docs](${BUILTIN_MODULE_URLS[moduleId]})`,
      );

      return item;
    });
  }

  return listBuiltinMembers(moduleId).map((entry) => {
    const item = new vscode.CompletionItem(entry.name, itemKind(entry.kind));

    item.insertText = entry.name;
    item.range = range;
    item.detail = `${kindLabel(entry.kind)} · sass:${moduleId} ${moduleId}.${entry.name}(${formatSignature(entry)})`;
    item.documentation = builtinMemberDocs(entry);

    return item;
  });
}

/** Completion items for workspace module file members (functions, mixins, variables). */
function workspaceMemberItems(
  file: IndexedFile,
  filePath: string,
  context: MemberContext,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const label = path.basename(filePath);

  if (context.variable) {
    return file.variables.map((name) => {
      const item = new vscode.CompletionItem(`$${name}`, vscode.CompletionItemKind.Variable);

      item.insertText = `$${name}`;
      item.range = range;
      item.detail = `@variable · ${label}`;

      return item;
    });
  }

  return file.functions.map((definition) => {
    const item = new vscode.CompletionItem(definition.name, itemKind(definition.kind));

    item.insertText = definition.name;
    item.range = range;
    item.detail = `${kindLabel(definition.kind)} · ${label}(${signatureOf(definition.params)})`;

    return item;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const index = new SignatureIndex();
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection('sass-scss-completion');

  /** Variable names brought into global scope by `@use '...' as *` (built-in or workspace module). */
  const globalVariables = (text: string, document: vscode.TextDocument): Set<string> => {
    const names = new Set<string>();

    for (const use of parseUseStatements(text)) {
      if (!use.global) continue;

      const moduleId = builtinModuleId(use.url);

      if (moduleId) {
        for (const variable of BUILTIN_VARIABLES[moduleId] ?? []) names.add(variable.name);
        continue;
      }

      const resolved = index.resolveModule(use.url, document.uri.fsPath);

      if (resolved) for (const name of resolved.file.variables) names.add(name);
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

      const resolved = index.resolveModule(use.url, document.uri.fsPath);

      // A module that re-exports through `@forward` has members this index cannot see.
      if (!resolved || resolved.file.forwarded) continue;

      modules.set(use.namespace, {
        functions: memberIndex(resolved.file.functions, 'function'),
        mixins: memberIndex(resolved.file.functions, 'mixin'),
        variables: new Set(resolved.file.variables),
      });
    }

    return modules;
  };

  /** Shows document errors (missing required arguments, unknown members, undefined variables) as diagnostics. */
  const updateDiagnostics = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'scss' && document.languageId !== 'sass') return;

    const text = document.getText();
    const issues = [
      ...findMissingRequiredArgs(text),
      ...findModuleIssues(text, workspaceModules(text, document)),
      ...findUndefinedVariables(text, globalVariables(text, document)),
    ];
    const diagnostics = issues.map((issue) => {
      const range = new vscode.Range(
        document.positionAt(issue.start),
        document.positionAt(issue.end),
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        vscode.DiagnosticSeverity.Error,
      );

      diagnostic.source = 'sass-scss-completion';
      return diagnostic;
    });

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
        const resolved = index.resolveModule(statement.url, document.uri.fsPath);

        if (resolved) {
          items = workspaceMemberItems(resolved.file, resolved.path, memberContext, range);
        }
      }

      return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
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

      const resolved = index.resolveModule(statement.url, document.uri.fsPath);
      const definition = resolved?.file.functions.find((fn) => fn.name === token.name);

      if (!resolved || !definition) return undefined;

      const markdown = new vscode.MarkdownString(
        [
          `\`${kindLabel(definition.kind)}\` · ${path.basename(resolved.path)}`,
          '',
          '```scss',
          `${token.namespace}.${definition.name}(${signatureOf(definition.params)})`,
          '```',
        ].join('\n'),
      );

      return new vscode.Hover(markdown, range);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANGUAGES, paramProvider, '$', ',', '('),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, memberProvider, '.', '$'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, usePathProvider, "'", '"', ':'),
    vscode.languages.registerCompletionItemProvider(LANGUAGES, namespaceProvider),
    vscode.languages.registerHoverProvider(LANGUAGES, hoverProvider),
  );

  index.rebuild();

  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      index.rebuild();
    }, 300);
  };

  /** Watcher callback that ignores changes inside excluded directories. */
  const onWatchedFile = (uri: vscode.Uri): void => {
    if (isExcludedPath(uri.fsPath)) return;
    scheduleRebuild();
  };

  const watcher = vscode.workspace.createFileSystemWatcher(GLOB);

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(onWatchedFile),
    watcher.onDidCreate(onWatchedFile),
    watcher.onDidDelete(onWatchedFile),
    vscode.workspace.onDidSaveTextDocument((document) => {
      updateDiagnostics(document);
      if (/\.(scss|sass)$/i.test(document.uri.fsPath)) scheduleRebuild();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.exclude`)) scheduleRebuild();
    }),
    diagnosticCollection,
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnosticCollection.delete(document.uri)),
  );

  for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
}

export function deactivate(): void {}
