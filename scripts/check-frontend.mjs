import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const publicRoot = join(root, 'public');
const jsRoot = join(publicRoot, 'js');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const modules = walk(jsRoot).filter((path) => path.endsWith('.mjs'));
for (const modulePath of modules) {
  execFileSync(process.execPath, ['--check', modulePath], { stdio: 'inherit' });

  const source = readFileSync(modulePath, 'utf8');
  const importPattern = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    const dependency = resolve(dirname(modulePath), match[1]);
    assert(existsSync(dependency), `Missing import ${match[1]} referenced by ${modulePath}`);
  }
}

const htmlContracts = [
  { html: 'index.html', view: join(jsRoot, 'play', 'play-view.mjs') },
  { html: 'puzzles.html', view: join(jsRoot, 'puzzles', 'puzzle-view.mjs') },
  { html: 'dev.html', view: join(jsRoot, 'dev', 'dev-view.mjs') },
];

for (const contract of htmlContracts) {
  const html = readFileSync(join(publicRoot, contract.html), 'utf8');
  const view = readFileSync(contract.view, 'utf8');
  const ids = [...view.matchAll(/requireElement\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const id of ids) {
    assert(new RegExp(`id=["']${id}["']`).test(html), `${contract.html} is missing required View element #${id}`);
  }
}

for (const sourcePath of walk(publicRoot).filter((path) => ['.html', '.mjs'].includes(extname(path)))) {
  const source = readFileSync(sourcePath, 'utf8');
  assert(!source.includes('.innerHTML'), `Unsafe innerHTML usage found in ${sourcePath}`);
}

const directFetchUsers = modules.filter((path) => {
  if (path.endsWith(join('shared', 'api-client.mjs'))) return false;
  return /\bfetch\s*\(/.test(readFileSync(path, 'utf8'));
});
assert(directFetchUsers.length === 0, `Direct fetch usage outside JsonApiClient: ${directFetchUsers.join(', ')}`);

const serverRoot = join(root, 'server');
const serverModules = existsSync(serverRoot)
  ? walk(serverRoot).filter((path) => path.endsWith('.cjs'))
  : [];
for (const modulePath of serverModules) {
  execFileSync(process.execPath, ['--check', modulePath], { stdio: 'inherit' });
}

const testsRoot = join(root, 'tests');
const tests = existsSync(testsRoot)
  ? walk(testsRoot).filter((path) => /\.test\.(mjs|cjs)$/.test(path))
  : [];
execFileSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
console.log(`Checked ${modules.length} frontend modules, ${serverModules.length} server modules, ${htmlContracts.length} HTML/View contracts, and ${tests.length} test files.`);
