// Driver for the csv-reader-speed-01 entry: the harness runs
// `node /bot/main.ts` (Node 22). It reads every case from /input/cases.json
// (a JSON array of {id, input}), answers each one alone with run() from
// solve.js, and writes /output/answers.json: a JSON array of the answers,
// one per case and in the cases' order. Outside a container,
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it.
setFlagsFromString('--no-incremental-marking');

// solve.js is a dependency-free ES module; its run(input) returns
// csv-reader 1.0.0's answer for that input.
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
const outPath = join(OUTPUT_DIR, 'answers.json');
const outBytes = JSON.stringify(answers);
writeFileSync(outPath, outBytes);

// Verify the file we just wrote: it must parse as a JSON array holding
// exactly one answer per case. A mismatch is a hard failure, not a
// silent short output. The check reads the file back from disk, so it
// catches a truncated or mistargeted write too.
const written = JSON.parse(readFileSync(outPath, 'utf8')) as unknown[];
if (!Array.isArray(written) || written.length !== cases.length) {
  throw new Error(
    `answers.json verification failed: expected ${cases.length} answers, ` +
      `got ${Array.isArray(written) ? written.length : 'non-array'}`,
  );
}
console.error(
  `wrote ${written.length} answers, ${outBytes.length} bytes to ${outPath}`,
);
