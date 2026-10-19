// `npm run content:readiness` — what each draft still needs before publication, and which session the app would
// offer for each equipment and time choice once everything is approved. Read-only; changes nothing.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogueInput } from '../src/workout/catalogue.ts';
import { assessReadiness } from './training-content/readiness.ts';

const read = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));

const input: CatalogueInput = { exercises: read('content/exercises'), sessions: read('content/sessions') };
const { items, coverage } = assessReadiness(input);

console.log('Still needed before publication (per item):');
const counts = new Map<string, number>();
for (const item of items) {
  for (const blocker of item.blockers) counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
}
for (const [blocker, count] of [...counts.entries()].sort()) console.log(`  ${blocker}: ${count} item(s)`);
const ready = items.filter((i) => i.blockers.length === 0).length;
console.log(`  ready for a reviewer to publish: ${ready} of ${items.length}`);

console.log('\nOnce everything is approved, the app would offer (beginner, normal energy, variant 0):');
for (const equipment of ['none', 'home', 'gym']) {
  const row = coverage
    .filter((c) => c.equipment === equipment)
    .map((c) => `${c.minutes} min -> ${c.session ?? 'nothing'}`)
    .join(' | ');
  console.log(`  equipment ${equipment}: ${row}`);
}
