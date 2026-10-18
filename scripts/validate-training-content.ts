// `npm run content:check` — validates content/exercises and content/sessions. See content/README.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runValidation } from './training-content/validate.ts';

const read = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ path: join(dir, name).replace(/\\/g, '/'), text: readFileSync(join(dir, name), 'utf8') }));

const { exitCode, lines } = runValidation({ exercises: read('content/exercises'), sessions: read('content/sessions') });
for (const line of lines) console.log(line);
process.exitCode = exitCode;
