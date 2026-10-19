// `npm run content:import -- --mapping <file> [options]`. DRY RUN unless --apply is given. See docs/product/guided-content-import.md.
//
//   --mapping <file>          reviewed JSON { reviewedBy: {name, role, reviewedOn}, links: { "<catalogue id>": "<public.exercises uuid>" } }
//   --existing <file>         dry run against a saved snapshot of the database instead of reading it
//   --offline                 dry run against an empty database; targets in public.exercises are NOT verified
//   --apply                   write the plan (development project only)
//   --plan-hash <hash>        the hash printed by the dry run being approved (required with --apply)
//   --project-ref <ref>       must be the development project
//   --confirm-project <ref>   type the development project ref again to confirm
// Reading the database needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never in Git).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { applyImport, buildImportPlan, DEV_PROJECT_REF, ExistingState, ImportInput, renderPlan } from './training-content/import.ts';
import { createImportDb } from './training-content/importDb.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);

const read = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));

async function main(): Promise<number> {
  const mappingPath = value('--mapping');
  if (!mappingPath) {
    console.log('Missing --mapping <file>: a reviewed mapping to public.exercises is required. Exercises are never matched by name.');
    return 1;
  }
  let mapping: ImportInput['mapping'];
  try {
    mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
  } catch {
    console.log(`The mapping file ${mappingPath} could not be read as JSON.`);
    return 1;
  }
  const input: ImportInput = { exercises: read('content/exercises'), sessions: read('content/sessions'), mapping };

  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const live = !flag('--offline') && !value('--existing');
  const client = live && url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  if (flag('--apply')) {
    if (!client) {
      console.log('--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the development project.');
      return 1;
    }
    const linked = existsSync('supabase/.temp/project-ref') ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() : '';
    try {
      const result = await applyImport(input, createImportDb(client), { projectRef: value('--project-ref') ?? '', linkedProjectRef: linked, supabaseUrl: url, confirmProject: value('--confirm-project'), planHash: value('--plan-hash') });
      console.log(`Applied ${result.applied} write(s).`);
      return 0;
    } catch (error) {
      console.log(error instanceof Error ? error.message : 'Import failed.');
      return 1;
    }
  }

  let existing: ExistingState;
  let note = '';
  if (value('--existing')) existing = JSON.parse(readFileSync(value('--existing')!, 'utf8'));
  else if (flag('--offline')) {
    existing = { exerciseVersions: [], sessionTemplates: [], links: [], exerciseIds: null };
    note = 'OFFLINE: assumed an empty database, and mapping targets in public.exercises were NOT verified.';
  } else if (client) existing = await createImportDb(client).read();
  else {
    console.log(`No database to compare with. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (development project ${DEV_PROJECT_REF}), or use --existing <snapshot> or --offline.`);
    return 1;
  }

  const { refusals, plan } = buildImportPlan(input, existing);
  if (note) console.log(note);
  if (!plan) {
    console.log(`REFUSED. Nothing can be imported (${refusals.length} problem(s)):`);
    for (const r of refusals) console.log(`  ${r.code}: ${r.id}`);
    return 1;
  }
  for (const line of renderPlan(plan)) console.log(line);
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
