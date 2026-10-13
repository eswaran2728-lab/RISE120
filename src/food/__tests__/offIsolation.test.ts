import fs from 'fs';
import path from 'path';

// Open Food Facts data is read-only until the owner approves a compliant reuse approach (its
// database licence has attribution and share-alike obligations). These checks keep it from being
// stored, cached or logged by accident.
const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const appFiles = [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'src'))];

describe('Open Food Facts stays read-only', () => {
  it('the barcode client imports nothing that stores, caches, logs or syncs', () => {
    const text = read('src/food/barcode.ts');
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

    expect(imports).toEqual(['../lib/supabase']);
    expect(text).not.toMatch(/\.from\(|\.insert\(|\.upsert\(|writeCache|rememberFoods/);
  });

  it('the scan screen cannot log, save or cache a product', () => {
    const text = read('app/food-scan.tsx');

    for (const forbidden of ['queueFoodLog', 'rememberFoods', 'saveUsdaFood', 'createCustomFood', 'FoodEntry', 'sync/', 'userCache']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('no app code that writes foods or logs mentions the openfoodfacts source', () => {
    for (const file of appFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const writesFoods = /from\('foods'\)|from\('food_logs'\)|rememberFoods|queueFoodLog/.test(text);
      if (writesFoods) expect({ file: path.relative(ROOT, file), mentionsOff: /openfoodfacts/i.test(text) }).toEqual({ file: path.relative(ROOT, file), mentionsOff: false });
    }
  });

  it('the lookup function only reads: it has no database writes', () => {
    for (const file of ['supabase/functions/lookup-barcode/index.ts', 'supabase/functions/_shared/food/barcodeHandler.ts', 'supabase/functions/_shared/food/off.ts']) {
      expect(read(file)).not.toMatch(/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
    }
    // The only database client in the function is the auth check.
    expect(read('supabase/functions/lookup-barcode/index.ts')).not.toContain(".from('");
  });
});
