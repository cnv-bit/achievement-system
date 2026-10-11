import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const applicationFiles = new Set([
  'src/settings/model.ts', 'src/settings/storage.ts', 'src/settings/controller.ts', 'src/settings/ports.ts',
  'src/prompting/controller.ts', 'src/prompting/ports.ts', 'src/prompting/prompt-builder.ts',
  'src/prompting/message-selection.ts', 'src/prompting/worldbook-context.ts',
]);
const pages = ['src/settings/settings-page.ts', 'src/settings/worldbook-page.ts', 'src/prompting/prompting-page.ts'];

function projectPath(file) {
  const resolved = fs.existsSync(file) ? fs.realpathSync(file) : file;
  return path.relative(root, resolved).replaceAll('\\', '/');
}

function isApplicationFile(file) {
  return file.startsWith('src/domain/') || file.startsWith('src/runtime/') || applicationFiles.has(file);
}

function dependencies(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const result = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) result.push(null);
    }
    if (specifier && ts.isStringLiteralLike(specifier)) result.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function dependencyTarget(specifier, sourceFile) {
  const resolved = ts.resolveModuleName(specifier, sourceFile, options, ts.sys).resolvedModule;
  return projectPath(resolved?.resolvedFileName ?? path.resolve(path.dirname(sourceFile), specifier));
}

function isForbiddenDependency(specifier, sourceFile) {
  if (specifier === null) return true; // Computed imports cannot be checked at this boundary.
  if (specifier.startsWith('node:')) return false;
  return !isApplicationFile(dependencyTarget(specifier, sourceFile));
}

test('boundary checker catches type imports, re-exports, dynamic imports and normalized escapes', () => {
  const file = path.join(root, 'src/runtime/check.ts');
  for (const specifier of ['../domain/types.ts', './ports.ts', '../settings/model.ts', 'node:crypto']) {
    assert.equal(isForbiddenDependency(specifier, file), false, specifier);
  }
  for (const specifier of ['../settings/backend.ts', '../settings/ports/../backend.ts', '../frontend/journal-port.ts',
    '../../src/runtime/../tavern-helper/adapters.ts', '../../content-packs/a/catalog.json', '../../../outside.ts']) {
    assert.equal(isForbiddenDependency(specifier, file), true, specifier);
  }
  const specifier = '../settings/backend.ts';
  const text = `import type { X } from '${specifier}'; export type { X } from '${specifier}';
    type Y = import('${specifier}').X; import('${specifier}'); import(route);`;
  assert.deepEqual(dependencies(text, file), [specifier, specifier, specifier, specifier, null]);
});

test('application logic has no imports of UI, authored content or host/HTTP adapters', () => {
  for (const file of fs.readdirSync(path.join(root, 'src'), { recursive: true })) {
    const relative = `src/${file.replaceAll('\\', '/')}`;
    if (!relative.endsWith('.ts') || !isApplicationFile(relative)) continue;
    const absolute = path.join(root, relative);
    for (const specifier of dependencies(fs.readFileSync(absolute, 'utf8'), absolute)) {
      assert.equal(isForbiddenDependency(specifier, absolute), false, `${relative} depends on ${specifier}`);
    }
  }
});

test('settings and prompting pages use contracts rather than concrete controllers', () => {
  for (const file of pages) {
    const absolute = path.join(root, file);
    const targets = dependencies(fs.readFileSync(absolute, 'utf8'), absolute).map(specifier => dependencyTarget(specifier, absolute));
    assert.ok(!targets.includes('src/settings/controller.ts') && !targets.includes('src/prompting/controller.ts'), file);
    assert.ok(targets.includes(file.startsWith('src/settings/') ? 'src/settings/ports.ts' : 'src/prompting/ports.ts'), file);
  }
});

test('business contracts and their dependency closure typecheck without DOM or Tavern ambient types', () => {
  const files = ['src/runtime/player-port.ts', 'src/runtime/ports.ts', 'src/runtime/pack-versions.ts', 'src/runtime/authoring.ts', 'src/settings/ports.ts', 'src/prompting/ports.ts'];
  const program = ts.createProgram(files.map(file => path.join(root, file)), { ...options, lib: ['lib.es2023.d.ts'], types: ['node'] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
  assert.ok(!program.getSourceFiles().some(file => /lib\.dom(?:\.iterable)?\.d\.ts$|tavern-helper[\\/]globals\.d\.ts$/.test(file.fileName)));
});
