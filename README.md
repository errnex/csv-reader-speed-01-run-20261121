# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/errnex/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/errnex/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in replacement for [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
for the [make.fun competition "Read broken CSV files faster"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
`solve.js` answers exactly as csv-reader 1.0.0 does for every input — same
`{columns, rows, errors}`, same broken-row policy — while reading the text
much faster.

## How it is faster

csv-reader walks the text one character at a time in JavaScript, building
every field up a character at a time. This entry never does that:

- A whole clean line — no quote, no carriage return except a trailing
  CRLF — is split by the native `split` in a single call.
- Every other field is found with `indexOf` scans that stop at the first
  delimiter, slicing whole fields instead of appending characters.
- The carriage returns are located once up front, in one native sweep,
  so the field scanner can ask for the next one in O(1) instead of
  rescanning the rest of the text for each field.
- No regex on hot paths, no per-character string concatenation, no
  allocations beyond the answer itself.

## Files

- `solve.js` — dependency-free ES module. `run(input)` returns
  csv-reader 1.0.0's answer for `{text, header}`: `{columns, rows, errors}`.
- `main.ts` — the program the harness runs (`node /bot/main.ts`). It turns
  V8's incremental marking off, reads every case from `/input/cases.json`,
  answers each with `run`, and writes `/output/answers.json`.
- `README.md` — this file.
- `LICENSE` — MIT.

## Verify locally

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out \
  node main.ts
# then compare /tmp/out/answers.json with <kit>/practice/reference/expected.json
```

Node 22, no installs, no network, no WASM or native code. Two runs on the
same set write byte-identical outputs.

## License

MIT — see [LICENSE](LICENSE).
