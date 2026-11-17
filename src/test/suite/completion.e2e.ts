import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const OUR_DETAIL = /@(function|mixin) ·/;
const NAMESPACE_DETAIL = /@use ·/;
const GLOBAL_DETAIL = /\(as \*\)/;
const MEMBER_VARIABLE_DETAIL = /@variable ·/;
const CUSTOM_PROPERTY_DETAIL = /CSS custom property/;
const SCOPE_VARIABLE_DETAIL = /SCSS variable/;

function workspaceUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) throw new Error('no workspace folder opened');
  return folder.uri;
}

function fileUri(name: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceUri(), name);
}

/** Collect only the labels of completion items created by this extension (identified by detail). */
async function suggestLabelsAt(
  name: string,
  line: number,
  character: number,
  trigger = '$',
  detail: RegExp = OUR_DETAIL,
): Promise<string[]> {
  const uri = fileUri(name);
  await vscode.workspace.openTextDocument(uri);

  const result = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >('vscode.executeCompletionItemProvider', uri, new vscode.Position(line, character), trigger);

  const items = Array.isArray(result) ? result : (result?.items ?? []);

  return items
    .filter((item) => typeof item.detail === 'string' && detail.test(item.detail))
    .map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
}

/** What a selector suggestion shows: the name, the text to its right, and the documentation panel. */
interface TemplateSuggestion {
  label: string;
  description: string;
  documentation: string;
}

/** The text of a completion item's documentation, whether it is plain text or markdown. */
function documentationText(documentation: vscode.CompletionItem['documentation']): string {
  if (typeof documentation === 'string') return documentation;

  return documentation?.value ?? '';
}

/**
 * Only the suggestions of this extension: the selector items carry their source in
 * `label.description`, while the other providers of the editor (the built-in HTML support among
 * them) use a plain string label.
 */
function templateSuggestions(items: readonly vscode.CompletionItem[]): TemplateSuggestion[] {
  const suggestions: TemplateSuggestion[] = [];

  for (const item of items) {
    if (typeof item.label === 'string') continue;
    if (typeof item.label.description !== 'string') continue;

    suggestions.push({
      label: item.label.label,
      description: item.label.description,
      documentation: documentationText(item.documentation),
    });
  }

  return suggestions;
}

/**
 * The selector suggestions offered at a position inside a template attribute. `language` forces the
 * document language, so a test does not depend on the language extension being installed.
 */
async function selectorSuggestionsAt(
  name: string,
  line: number,
  character: number,
  trigger: string,
  language?: string,
): Promise<TemplateSuggestion[]> {
  const uri = fileUri(name);
  const document = await vscode.workspace.openTextDocument(uri);

  if (language && document.languageId !== language) {
    await vscode.languages.setTextDocumentLanguage(document, language);
  }

  const result = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >('vscode.executeCompletionItemProvider', uri, new vscode.Position(line, character), trigger);

  return templateSuggestions(Array.isArray(result) ? result : (result?.items ?? []));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeout = 20000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('timed out waiting for the completion index');
}

/** Only the diagnostics this extension produced for a file. */
function ourDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === 'sass-scss-completion');
}

/** Filter to only the diagnostics created by this extension and wait until at least `minimum` appear. */
async function waitForDiagnostics(
  name: string,
  minimum: number,
): Promise<vscode.Diagnostic[]> {
  const uri = fileUri(name);
  await vscode.workspace.openTextDocument(uri);

  let diagnostics: vscode.Diagnostic[] = [];

  await waitFor(async () => {
    diagnostics = ourDiagnostics(uri);

    return diagnostics.length >= minimum;
  });

  return diagnostics;
}

// The expectation shared with the stylelint plugin's parity suite. Both hosts read this file, so the
// editor and the plugin are held to the same result for every fixture they can both parse.
const PARITY_GOLDEN = path.join(__dirname, '../../../test-fixtures/parity.json');

/** One recorded diagnostic, as the parity file writes it. */
interface ParityIssue {
  line: number;
  character: number;
  severity: string;
  message: string;
}

function severityName(severity: vscode.DiagnosticSeverity): string {
  if (severity === vscode.DiagnosticSeverity.Error) return 'error';
  if (severity === vscode.DiagnosticSeverity.Warning) return 'warning';

  return String(severity);
}

/** A stable order so the editor and the recorded expectation can be compared directly. */
function sortIssues(issues: readonly ParityIssue[]): ParityIssue[] {
  return [...issues].sort(
    (a, b) => a.line - b.line || a.character - b.character || a.message.localeCompare(b.message),
  );
}

suite('Sass/SCSS parameter completion (E2E)', () => {
  suiteSetup(async () => {
    // Wait for extension activation and completion of workspace signature indexing.
    await waitFor(async () => (await suggestLabelsAt('usage.scss', 1, 18)).includes('$base'));
    // The selector index and the completion groups are built from the index, so wait for them too.
    await waitFor(async () =>
      (await selectorSuggestionsAt('template.html', 0, 12, '"')).some(
        (suggestion) => suggestion.label === 'btn',
      ),
    );
  });

  test('suggests $base after a positional argument in SCSS', async () => {
    const labels = await suggestLabelsAt('usage.scss', 1, 18);
    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
  });

  test('does not re-suggest a named parameter already used', async () => {
    const labels = await suggestLabelsAt('usage-dup.scss', 1, 29);
    assert.ok(!labels.includes('$base'), `did not expect $base, got [${labels.join(', ')}]`);
  });

  test('suggests $height for a mixin after a positional argument', async () => {
    const labels = await suggestLabelsAt('usage-mixin.scss', 1, 20);
    assert.ok(labels.includes('$height'), `expected $height, got [${labels.join(', ')}]`);
  });

  test('works in indented Sass syntax', async () => {
    const labels = await suggestLabelsAt('usage.sass', 1, 18);
    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
  });

  test('suggests a built-in module parameter resolved through @use', async () => {
    const labels = await suggestLabelsAt('usage-builtin.scss', 4, 23);
    assert.ok(labels.includes('$number2'), `expected $number2, got [${labels.join(', ')}]`);
  });

  test('lists built-in module members after a namespace dot', async () => {
    const labels = await suggestLabelsAt('usage-member.scss', 3, 22, '.');
    assert.ok(labels.includes('adjust'), `expected adjust, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('mix'), `expected mix, got [${labels.join(', ')}]`);
  });

  test('lists workspace module members resolved from @use', async () => {
    const labels = await suggestLabelsAt('usage-module.scss', 4, 17, '.');
    assert.ok(labels.includes('scale'), `expected scale, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('flex-center'), `expected flex-center, got [${labels.join(', ')}]`);
  });

  test('lists the members a module re-exports with @forward after a namespace dot', async () => {
    // `users-missing-variables.scss` uses `./forward`, which only re-exports other files.
    const labels = await suggestLabelsAt('users-missing-variables.scss', 3, 31, '.');
    assert.ok(labels.includes('scale'), `expected scale, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('flex-center'), `expected flex-center, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('rem'), `expected rem, got [${labels.join(', ')}]`);
  });

  test('lists the variables a module re-exports with @forward after a namespace dot', async () => {
    const labels = await suggestLabelsAt(
      'users-missing-variables.scss',
      3,
      31,
      '.',
      MEMBER_VARIABLE_DETAIL,
    );
    assert.ok(labels.includes('$spacing'), `expected $spacing, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('$colors'), `expected $colors, got [${labels.join(', ')}]`);
  });

  test('lists the variables of a built-in module after a namespace dot', async () => {
    const labels = await suggestLabelsAt('usage-builtin.scss', 4, 14, '.', MEMBER_VARIABLE_DETAIL);
    assert.ok(labels.includes('$pi'), `expected $pi, got [${labels.join(', ')}]`);
  });

  test('lists the variables a module loads with @use ... as *', async () => {
    const labels = await suggestLabelsAt(
      'users-missing-variables.scss',
      3,
      7,
      '$',
      GLOBAL_DETAIL,
    );
    assert.ok(labels.includes('$colors'), `expected $colors, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('$spacing'), `expected $spacing, got [${labels.join(', ')}]`);
  });

  test('suggests a loaded namespace by its prefix', async () => {
    const labels = await suggestLabelsAt('usage-namespace.scss', 4, 11, '$', NAMESPACE_DETAIL);
    assert.ok(labels.includes('color'), `expected color, got [${labels.join(', ')}]`);
  });

  test('reports an error when a required built-in argument is missing', async () => {
    const diagnostics = await waitForDiagnostics('usage-diagnostic.scss', 1);

    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
    assert.ok(
      diagnostics[0].message.includes('$number2'),
      `expected $number2 in "${diagnostics[0].message}"`,
    );
  });

  test('reports an undefined variable as an error', async () => {
    const diagnostics = await waitForDiagnostics('usage-builtin.scss', 1);
    const undefinedIssue = diagnostics.find((diagnostic) => diagnostic.message.includes('$ss'));

    assert.ok(
      undefinedIssue,
      `expected a $ss diagnostic, got [${diagnostics.map((d) => d.message).join(', ')}]`,
    );
    assert.strictEqual(undefinedIssue.severity, vscode.DiagnosticSeverity.Error);
  });

  test('reports members a workspace module does not export', async () => {
    const diagnostics = await waitForDiagnostics('usage-unknown-member.scss', 3);
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    assert.ok(
      messages.includes('Undefined function d.rem2.'),
      `expected the unknown function, got [${messages.join(', ')}]`,
    );
    assert.ok(
      messages.includes('Undefined mixin d.box2.'),
      `expected the unknown mixin, got [${messages.join(', ')}]`,
    );
    assert.ok(
      messages.includes('Undefined variable d.$missing.'),
      `expected the unknown variable, got [${messages.join(', ')}]`,
    );
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('reports a call that omits a required argument of a workspace module', async () => {
    const diagnostics = await waitForDiagnostics('usage-missing-arg.scss', 2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    assert.deepStrictEqual(messages.sort(), [
      'Missing required argument(s) $value in the call to d.rem.',
      'Missing required argument(s) $width in the call to d.box.',
    ]);
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('reports an unknown CSS property value and accepts keywords, functions, and lengths', async () => {
    const diagnostics = await waitForDiagnostics('usage-missing-properties.scss', 6);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, [
      "Unknown value 'abc' for property 'width'.",
      "Unknown value 'casins()' for property 'text-transform'.",
      "Unknown value 'casinsss()' for property 'text-transform'.",
      "Unknown value 'flexx' for property 'display'.",
      "Unknown value 'notacolor' for property 'color'.",
      "Unknown value 'uppercases' for property 'text-transform'.",
    ]);
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('suggests the custom properties declared in the workspace inside var()', async () => {
    const labels = await suggestLabelsAt(
      'usage-custom-properties.scss',
      8,
      15,
      '-',
      CUSTOM_PROPERTY_DETAIL,
    );

    assert.ok(labels.includes('--main-color'), `expected --main-color, got [${labels.join(', ')}]`);
    assert.ok(
      labels.includes('--basic-padding'),
      `expected --basic-padding, got [${labels.join(', ')}]`,
    );
  });

  test('warns about a var() use of a custom property nothing declares', async () => {
    const diagnostics = await waitForDiagnostics('usage-custom-properties.scss', 1);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, ['Unknown custom property --missing.']);
    assert.ok(
      diagnostics.every(
        (diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning,
      ),
      'expected every diagnostic to be a warning',
    );
  });

  test('suggests the root and loop variables in scope where a `$` is typed', async () => {
    const labels = await suggestLabelsAt(
      'usage-variable-scope.scss',
      12,
      14,
      '$',
      SCOPE_VARIABLE_DETAIL,
    );

    assert.ok(labels.includes('$base'), `expected $base, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('$size'), `expected $size, got [${labels.join(', ')}]`);
    assert.ok(!labels.includes('$item'), `did not expect $item, got [${labels.join(', ')}]`);
  });

  test('reports out-of-scope and out-of-order variable uses', async () => {
    const diagnostics = await waitForDiagnostics('usage-variable-scope.scss', 2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).sort();

    assert.deepStrictEqual(messages, [
      'Used undefined variable $item.',
      'Used undefined variable $later.',
    ]);
    assert.ok(
      diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      'expected every diagnostic to be an error',
    );
  });

  test('shows built-in function documentation on hover', async () => {
    const uri = fileUri('usage-builtin.scss');
    await vscode.workspace.openTextDocument(uri);

    let text = '';

    await waitFor(async () => {
      const hovers =
        (await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          new vscode.Position(4, 12),
        )) ?? [];

      text = hovers
        .flatMap((hover) => hover.contents)
        .map((content) => (typeof content === 'string' ? content : content.value))
        .join('\n');

      return text.includes('math.div');
    });

    assert.ok(text.includes('math.div'), `expected math.div docs, got "${text}"`);
  });

  test('suggests the class selectors a stylesheet defines inside class=""', async () => {
    const suggestions = await selectorSuggestionsAt('template.html', 0, 12, '"');
    const labels = suggestions.map((suggestion) => suggestion.label);

    assert.ok(labels.includes('btn'), `expected btn, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('btn__label'), `expected btn__label, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('badge-primary'), `expected badge-primary, got [${labels.join(', ')}]`);
    assert.ok(!labels.includes('app'), `did not expect app, got [${labels.join(', ')}]`);
  });

  test('offers one name per item of a space-separated @each list', async () => {
    const labels = (await selectorSuggestionsAt('template.html', 0, 12, '"')).map(
      (suggestion) => suggestion.label,
    );

    // `usage-variable-scope.scss` builds `.item-#{$item}` over `@each $item in 1 2 3`, so each item
    // is one name, and `users-missing-variables.scss` runs `@each` over `fr.`, a namespace that names
    // no value, so no `clr-...` or `bg-...` name is offered.
    assert.ok(labels.includes('item-1'), `expected item-1, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('item-2'), `expected item-2, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('item-3'), `expected item-3, got [${labels.join(', ')}]`);
    assert.ok(
      !labels.includes('item-1 2 3'),
      `did not expect "item-1 2 3", got [${labels.join(', ')}]`,
    );
    assert.ok(
      !labels.some((label) => label.startsWith('clr-') || label.startsWith('bg-')),
      `did not expect a clr- or bg- name, got [${labels.join(', ')}]`,
    );
  });

  test('leaves out the directories the exclude setting names', async () => {
    const labels = (await selectorSuggestionsAt('template.html', 0, 12, '"')).map(
      (suggestion) => suggestion.label,
    );

    // The other fixtures are still indexed, so an omission below is due to the setting.
    assert.ok(labels.includes('btn'), `expected btn, got [${labels.join(', ')}]`);
    // `.vscode/settings.json` excludes `legacy` (a plain directory name) and `**/generated/**`
    // (a glob) through `sass-scss-completion.exclude`.
    assert.ok(
      !labels.includes('legacy-card'),
      `did not expect legacy-card, got [${labels.join(', ')}]`,
    );
    assert.ok(
      !labels.includes('generated-chip'),
      `did not expect generated-chip, got [${labels.join(', ')}]`,
    );
  });

  test('suggests the class selectors a stylesheet defines inside a Vue template', async () => {
    const labels = (await selectorSuggestionsAt('template.vue', 1, 14, '"', 'vue')).map(
      (suggestion) => suggestion.label,
    );

    assert.ok(labels.includes('btn'), `expected btn, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('badge-primary'), `expected badge-primary, got [${labels.join(', ')}]`);
  });

  test('suggests the class selectors a plain CSS file defines', async () => {
    const suggestions = await selectorSuggestionsAt('template.html', 0, 12, '"');
    const labels = suggestions.map((suggestion) => suggestion.label);

    // `selectors-plain.css` declares the classes through plain CSS selectors, so they reach the
    // template the same way a Sass file's do.
    assert.ok(labels.includes('plain-btn'), `expected plain-btn, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('plain-card'), `expected plain-card, got [${labels.join(', ')}]`);

    // The root `.css` file is in the group that targets `template.html` and carries no label, so the
    // row shows its path and the panel the comment written above `.plain-btn`.
    const btn = suggestions.find((suggestion) => suggestion.label === 'plain-btn');

    assert.strictEqual(btn?.description, 'selectors-plain.css');
    assert.strictEqual(btn?.documentation, 'The plain CSS button.');
  });

  test('suggests the id selectors a stylesheet defines inside id=""', async () => {
    const labels = (await selectorSuggestionsAt('template.html', 1, 9, '"')).map(
      (suggestion) => suggestion.label,
    );

    assert.ok(labels.includes('app'), `expected app, got [${labels.join(', ')}]`);
    assert.ok(!labels.includes('btn'), `did not expect btn, got [${labels.join(', ')}]`);
  });

  test('suggests the attribute-selector values inside that attribute', async () => {
    const labels = (await selectorSuggestionsAt('template.html', 2, 17, '"')).map(
      (suggestion) => suggestion.label,
    );

    assert.ok(labels.includes('open'), `expected open, got [${labels.join(', ')}]`);
  });

  test('suggests the attribute names the selectors name', async () => {
    const labels = (await selectorSuggestionsAt('template.html', 3, 5, ' ')).map(
      (suggestion) => suggestion.label,
    );

    assert.ok(labels.includes('data-state'), `expected data-state, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('disabled'), `expected disabled, got [${labels.join(', ')}]`);
    assert.ok(labels.includes('class'), `expected class, got [${labels.join(', ')}]`);
  });

  test('shows the source path of a suggestion no group labels', async () => {
    const suggestions = await selectorSuggestionsAt('template.html', 0, 12, '"');
    const btn = suggestions.find((suggestion) => suggestion.label === 'btn');

    // No groups are set, so the row shows the sorted folder and file names of the stylesheets
    // that define the name, and `btn` carries no comment above its selectors.
    assert.strictEqual(btn?.description, 'selectors-admin.scss, selectors.scss');
    assert.strictEqual(btn?.documentation, '');
  });

  test('shows the comment above a selector in the documentation panel', async () => {
    const suggestions = await selectorSuggestionsAt('template.html', 0, 12, '"');
    const primary = suggestions.find((suggestion) => suggestion.label === 'btn-primary');

    // No groups are set, so the row shows the path and the panel below it the comment written
    // directly above `.btn-primary` in `selectors.scss`.
    assert.strictEqual(primary?.description, 'selectors.scss');
    assert.strictEqual(primary?.documentation, 'The primary call to action.');
  });

  test('shows the group label of a scoped suggestion in place of the path', async () => {
    // The `web` group targets `apps/web/**/*.vue` and styles `packages/theme`, so `theme-card`
    // carries the label in the row and the shortened path in the documentation panel.
    const vue = await selectorSuggestionsAt('apps/web/page.vue', 1, 14, '"', 'vue');
    const themeCard = vue.find((suggestion) => suggestion.label === 'theme-card');

    assert.strictEqual(themeCard?.description, 'web');
    assert.strictEqual(themeCard?.documentation, 'theme/theme.scss');
  });

  test('merges the labels of the groups that both define a name', async () => {
    // `card` is defined by `packages/theme` (group `web`) and by `packages/ui` (group `ui`), and
    // both groups target this template, so the row merges the labels and the panel both paths.
    const vue = await selectorSuggestionsAt('apps/web/page.vue', 1, 14, '"', 'vue');
    const card = vue.find((suggestion) => suggestion.label === 'card');

    assert.strictEqual(card?.description, 'ui, web');
    assert.strictEqual(card?.documentation, 'theme/theme.scss, ui/ui.scss');
  });

  test('scopes each group to the templates its targets glob covers', async () => {
    const vue = await selectorSuggestionsAt('apps/web/page.vue', 1, 14, '"', 'vue');
    const html = await selectorSuggestionsAt('apps/web/page.html', 0, 12, '"');

    // `ui` targets `apps/**/*.{vue,html}`, so its brace expansion reaches both files, while `web`
    // targets the `.vue` file alone.
    assert.strictEqual(
      vue.find((suggestion) => suggestion.label === 'ui-button')?.description,
      'ui',
    );
    assert.strictEqual(
      html.find((suggestion) => suggestion.label === 'ui-button')?.description,
      'ui',
    );
    assert.ok(
      !html.some((suggestion) => suggestion.label === 'theme-card'),
      `did not expect theme-card, got [${html.map((s) => s.label).join(', ')}]`,
    );
    // The root stylesheets are in no group whose `targets` cover `apps/`, so their names stay out.
    assert.ok(
      !vue.some((suggestion) => suggestion.label === 'btn'),
      `did not expect btn, got [${vue.map((s) => s.label).join(', ')}]`,
    );
  });

  test('offers nothing inside a template no group targets', async () => {
    // No group's `targets` glob covers `uncovered.html`, so it gets no suggestion at all.
    assert.deepStrictEqual(await selectorSuggestionsAt('uncovered.html', 1, 12, '"'), []);
  });

  test('reports the same diagnostics the stylelint plugin reports for every fixture', async () => {
    const golden = JSON.parse(fs.readFileSync(PARITY_GOLDEN, 'utf8')) as Record<
      string,
      ParityIssue[]
    >;

    // Open every fixture so the extension computes its diagnostics, then wait for the files that
    // expect issues to reach that count before reading any of them.
    for (const name of Object.keys(golden)) await vscode.workspace.openTextDocument(fileUri(name));

    await waitFor(async () => {
      for (const [name, expected] of Object.entries(golden)) {
        if (expected.length === 0) continue;
        if (ourDiagnostics(fileUri(name)).length < expected.length) return false;
      }

      return true;
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    for (const [name, expected] of Object.entries(golden)) {
      const actual = sortIssues(
        ourDiagnostics(fileUri(name)).map((diagnostic) => ({
          line: diagnostic.range.start.line,
          character: diagnostic.range.start.character,
          severity: severityName(diagnostic.severity),
          message: diagnostic.message,
        })),
      );

      assert.deepStrictEqual(actual, sortIssues(expected), `diagnostics for ${name}`);
    }
  });
});
