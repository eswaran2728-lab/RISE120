// `npm run recipes:check`. See docs/food/recipes.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecipeValidation } from './recipes/validate.ts';

const dir = 'content/recipes';
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => ({ path: join(dir, name).split(String.fromCharCode(92)).join('/'), text: readFileSync(join(dir, name), 'utf8') }))
  : [];
const { exitCode, lines } = runRecipeValidation(files);
for (const line of lines) console.log(line);
process.exitCode = exitCode;
