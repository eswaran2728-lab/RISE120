import fs from 'fs';
import path from 'path';
import en from '../locales/en.json';

// Every translation key written as a string literal in the app must exist in the locale files.
// (Locale parity is checked elsewhere; this catches a key that is missing from all of them.)
const ROOT = path.resolve(__dirname, '../../..');
const NAMESPACES = Object.keys(en).join('|');
const KEY = new RegExp(`'((?:${NAMESPACES})(?:\\.[A-Za-z0-9_]+)+)'`, 'g');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'testing' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function resolves(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

test('every translation key used in app/ and src/ exists in the English locale', () => {
  const missing: string[] = [];
  for (const file of [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'src'))]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(KEY)) {
      if (!resolves(match[1])) missing.push(`${path.relative(ROOT, file)}: ${match[1]}`);
    }
  }

  expect(missing).toEqual([]);
});
