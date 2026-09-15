# Quality gate discovery and failure reporting proof

## Before

At commit `c5647095b23bd65ef7da8c253043b4ef38e9b18c`, hosted run
`fk2-1789431999558293541` exited unsuccessfully despite reporting 701 passed
and 16 skipped assertions. Running the same suite with both the default and
custom Vitest reporters reproduced the failure: Vitest collected
`scripts/quality-evidence.test.mjs`, a Node test-runner contract suite, and
reported `No test suite found`. The custom reporter omitted this suite-level
failure from its assertion evidence and hid the default diagnostic output.

Two regression cases also proved that a failed empty suite and an unhandled
runner error were incorrectly translated into a complete passing envelope.

## After

Vitest excludes the Node contract suites under `scripts`; the preceding
`node --test scripts/quality-evidence.test.mjs` quality phase still executes
all ten adapter contracts. The custom reporter retains unhandled runner
errors. Translation rejects failed suites without failed assertions and
unhandled runner errors, preserving their diagnostics without inventing test
counts. The default reporter is enabled alongside machine-readable evidence.

`node ./scripts/quality-evidence.mjs` passed locally on 2026-09-15: dependency
installation, all ten adapter contracts, TypeScript, 701 passed and 16 skipped
Vitest tests, and the Vite production build. The emitted required producer has
`status: complete`, total 717, failed 0. No application tests were disabled.
