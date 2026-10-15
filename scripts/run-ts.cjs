// Runs a TypeScript entry point with Node, without installing anything: `node scripts/run-ts.cjs <file.ts> [args]`.
// The coach code under supabase/functions is written for Deno (type imports without the `type` keyword), which
// Node's own type stripping cannot load, so TypeScript's transpiler is hooked into require instead. Development
// tool only; the app and the edge functions never use it.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, verbatimModuleSyntax: false },
  });
  module._compile(outputText, filename);
};

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-ts.cjs <file.ts> [args]');
  process.exit(2);
}
process.argv.splice(1, 2, path.resolve(entry));
require(path.resolve(entry));
