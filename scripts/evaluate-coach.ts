// Entry point for `npm run eval:coach`; see docs/ai-coach-evaluation.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runCli } from './coach-eval/cli.ts';

async function main() {
  const code = await runCli(process.argv.slice(2), {
    env: process.env,
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, text) => writeFile(path, text, 'utf8'),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    log: (line) => console.log(line),
    now: () => Date.now(),
  });
  process.exitCode = code;
}

void main();
