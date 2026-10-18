import fs from 'fs';
import path from 'path';

// Every colour comes from src/theme/tokens.ts. A literal in a screen would drift from the theme (and from its
// contrast tests) the next time the palette changes.
const ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && entry.name !== 'tokens.ts' ? [full] : [];
  });
}

test('no screen or component writes a colour literal; they all use the theme tokens', () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'src'))]) {
    const text = fs.readFileSync(file, 'utf8');
    const found = text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g);
    if (found) offenders.push(`${path.relative(ROOT, file)}: ${[...new Set(found)].join(', ')}`);
  }

  expect(offenders).toEqual([]);
});
