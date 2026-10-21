import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
// Comments may explain what is NOT done, so only code is checked.
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
const files = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'testing' ? [] : files(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });

// Wearable calorie estimates must never reach a nutrition target. The strongest guarantee is that this code cannot see them at all.
describe('health data and nutrition targets', () => {
  it('never reads, names or computes energy or any other data than steps and sleep', () => {
    for (const file of files('src/health')) {
      const text = code(file);
      expect(text).not.toMatch(/calor|kcal|energy|TotalCaloriesBurned|ActiveCaloriesBurned|BasalMetabolic|HeartRate|Weight|Exercise/i);
    }
  });

  it('is not imported by anything that makes a plan or a nutrition target', () => {
    const planning = [...files('src/plan'), ...files('src/food'), ...files('src/today'), ...files('src/coach'), 'supabase/functions/generate-plan/index.ts', 'supabase/functions/start-next-cycle/index.ts'];
    for (const file of planning) expect(read(file)).not.toMatch(/from ['"][./]*health\b|\/health\//);
  });

  it('is not reachable from the server plan code: no function reads imported health data', () => {
    const functions = fs.readdirSync(path.join(root, 'supabase/functions'));
    for (const name of functions) {
      const entry = path.join(root, 'supabase/functions', name, 'index.ts');
      if (fs.existsSync(entry)) expect(fs.readFileSync(entry, 'utf8')).not.toMatch(/health_connect|healthConnect|imported_health/i);
    }
  });
});
