import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  findEnclosingCall,
  extractSignatures,
  suggestParams,
  type Signature,
} from './core';

const GLOB = '**/*.{scss,sass}';
const CONFIG_SECTION = 'sass-scss-completion';

/** 인덱싱에서 제외할 의존성/빌드 산출물/캐시 디렉터리. */
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

/** 내장 제외 목록에 사용자 설정(`exclude`)을 합친 단일 제외 glob. */
function excludeGlob(): string {
  const extra = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>('exclude', [])
    .filter((pattern) => pattern.trim().length > 0);

  return `**/{${[...EXCLUDED_DIRS, ...extra].join(',')}}/**`;
}

interface IndexedSignature extends Signature {
  file: string;
}

/** 워크스페이스의 @function / @mixin 시그니처를 모아 이름으로 찾을 수 있게 한다. */
class SignatureIndex {
  private definitions = new Map<string, IndexedSignature>();

  async rebuild(): Promise<void> {
    const definitions = new Map<string, IndexedSignature>();
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

      for (const signature of extractSignatures(text)) {
        if (!definitions.has(signature.name)) {
          definitions.set(signature.name, { ...signature, file: uri.fsPath });
        }
      }
    }

    this.definitions = definitions;
  }

  get(name: string): IndexedSignature | null {
    return this.definitions.get(name) ?? null;
  }
}

/** 커서 앞에 입력 중인 `$prefix` 토큰을 덮는 교체 범위. */
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

export function activate(context: vscode.ExtensionContext): void {
  const index = new SignatureIndex();

  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (document.uri.scheme !== 'file') return undefined;

      const text = document.getText();
      const offset = document.offsetAt(position);
      const call = findEnclosingCall(text, offset);

      if (!call) return undefined;

      const definition = index.get(call.name);

      if (!definition) return undefined;

      const suggestions = suggestParams(text, offset, definition.params);

      if (!suggestions || suggestions.length === 0) return undefined;

      const range = prefixRange(document, text, offset);
      const items = suggestions.map((name) => {
        const item = new vscode.CompletionItem(
          `$${name}`,
          vscode.CompletionItemKind.Variable,
        );

        item.insertText = `$${name}`;
        item.range = range;
        item.detail = `${
          definition.kind === 'mixin' ? '@mixin' : '@function'
        } · ${path.basename(definition.file)}`;

        return item;
      });

      return new vscode.CompletionList(items, false);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'scss' }, { language: 'sass' }, { language: 'vue' }],
      provider,
      '$',
      ',',
      '(',
    ),
  );

  index.rebuild();

  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      index.rebuild();
    }, 300);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(GLOB);

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(scheduleRebuild),
    watcher.onDidCreate(scheduleRebuild),
    watcher.onDidDelete(scheduleRebuild),
    vscode.workspace.onDidSaveTextDocument(scheduleRebuild),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.exclude`)) scheduleRebuild();
    }),
  );
}

export function deactivate(): void {}
