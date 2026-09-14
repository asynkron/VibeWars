import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_FILE,
  PRODUCER_ID,
  envelopeForRun,
  npmExecutable,
  prepareEvidenceDir,
  resolveEvidenceDir,
  translateVitestReport,
  writeEnvelope,
  writeStartedManifest,
} from "./quality-evidence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declaredCommand = "node ./scripts/quality-evidence.mjs";

function report(assertions, overrides = {}) {
  const counts = { passed: 0, failed: 0, pending: 0, todo: 0 };
  for (const assertion of assertions) counts[assertion.status] += 1;
  return {
    numTotalTests: assertions.length,
    numPassedTests: counts.passed,
    numFailedTests: counts.failed,
    numPendingTests: counts.pending,
    numTodoTests: counts.todo,
    testResults: [{
      name: path.join(repoRoot, "src/example.test.ts"),
      assertionResults: assertions,
    }],
    ...overrides,
  };
}

function assertion(title, status, failureMessages = [], id = `task-${title}`) {
  return { id, ancestorTitles: ["quality contract"], title, status, failureMessages };
}

test("main verification declares exactly one matching required producer", async () => {
  const config = JSON.parse(await readFile(path.join(repoRoot, ".faktorial/main-verify.json"), "utf8"));
  assert.equal(config.schema_version, "main-verify.v2");
  assert.deepEqual(config.commands, [declaredCommand]);
  assert.deepEqual(config.evidence, [{
    command: declaredCommand,
    producer_id: PRODUCER_ID,
    kind: "test-results",
    payload_schema: "test-results.v1",
    required: true,
  }]);
});

test("translates exact counts and stable failed identities", () => {
  const payload = translateVitestReport(report([
    assertion("passes", "passed"),
    assertion("fails", "failed", ["expected 1 to be 2"]),
    assertion("skips", "pending"),
    assertion("todo", "todo"),
  ]), repoRoot);
  assert.deepEqual(payload.counts, { total: 4, passed: 1, failed: 1, skipped: 2 });
  assert.deepEqual(payload.failures, [{
    suite: "src/example.test.ts :: quality contract",
    test: "fails",
    message: "expected 1 to be 2",
  }]);
  assert.equal(payload.counts.failed, payload.failures.length + (payload.omitted_failures || 0));
});

test("uses native task ids for repeated display names", () => {
  const payload = translateVitestReport(report([
    assertion("same", "failed", ["first failure"], "task-1"),
    assertion("same", "failed", ["second failure"], "task-2"),
  ]), repoRoot);
  assert.deepEqual(payload.failures.map((failure) => failure.test), [
    "same [task-1]",
    "same [task-2]",
  ]);
});

test("rejects malformed, contradictory, duplicate, and incomplete reports", () => {
  assert.throws(() => translateVitestReport(null), /must be an object/);
  assert.throws(
    () => translateVitestReport(report([assertion("passes", "passed")], { numTotalTests: 2 })),
    /contradictory/,
  );
  assert.throws(
    () => translateVitestReport(report([
      assertion("first", "passed", [], "duplicate-task"),
      assertion("second", "passed", [], "duplicate-task"),
    ])),
    /duplicate terminal task identity/,
  );
  assert.throws(
    () => translateVitestReport({
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
    /omitted testResults/,
  );
});

test("fails closed after Vitest starts but reports not applicable before it starts", () => {
  const before = envelopeForRun({
    testStarted: false,
    testExecutionError: "TypeScript typecheck failed (exit code 2)",
  });
  assert.equal(before.status, "not_applicable");
  assert.match(before.reason, /typecheck failed/i);

  const missing = envelopeForRun({ testStarted: true, testExitCode: 1 });
  assert.equal(missing.status, "translation_failed");
  assert.match(missing.reason, /did not publish its JSON report/);

  const malformed = envelopeForRun({ testStarted: true, report: { broken: true } });
  assert.equal(malformed.status, "translation_failed");
  assert.match(malformed.reason, /numTotalTests/);
});

test("bounds retained failures while preserving exact omitted count", () => {
  const assertions = Array.from({ length: 105 }, (_, index) =>
    assertion(`failure ${String(index).padStart(3, "0")}`, "failed", [`failure ${index}`]));
  const payload = translateVitestReport(report(assertions), repoRoot);
  assert.equal(payload.counts.failed, 105);
  assert.equal(payload.failures.length, 100);
  assert.equal(payload.omitted_failures, 5);
});

test("atomically replaces stale and incomplete evidence state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibewars-quality-evidence-"));
  try {
    await writeFile(path.join(dir, EVIDENCE_FILE), "stale");
    await writeFile(path.join(dir, "obsolete.quality-evidence.json"), "stale");
    await writeFile(path.join(dir, `.${EVIDENCE_FILE}.old.tmp`), "incomplete");
    await writeFile(path.join(dir, `${PRODUCER_ID}.vitest.json`), "stale");
    await prepareEvidenceDir(dir);
    assert.deepEqual(await readdir(dir), ["producers.json"]);

    await writeStartedManifest(dir, true);
    await writeEnvelope(dir, envelopeForRun({ testStarted: true, report: report([]) }));
    const files = await readdir(dir);
    assert.deepEqual(files.sort(), ["producers.json", EVIDENCE_FILE]);
    assert.equal(files.some((file) => file.endsWith(".tmp")), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "producers.json"), "utf8")), {
      started: [PRODUCER_ID],
      categories: [],
    });
    const envelope = JSON.parse(await readFile(path.join(dir, EVIDENCE_FILE), "utf8"));
    assert.equal(envelope.status, "complete");
    if (process.platform !== "win32") assert.equal((await stat(path.join(dir, EVIDENCE_FILE))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uses portable npm and evidence-directory resolution", () => {
  assert.equal(npmExecutable("win32"), "npm.cmd");
  assert.equal(npmExecutable("linux"), "npm");
  assert.equal(resolveEvidenceDir({ FAKTORIAL_QUALITY_EVIDENCE_DIR: " custom " }, repoRoot), "custom");
  assert.equal(resolveEvidenceDir({}, repoRoot), path.join(repoRoot, ".faktorial", "quality-evidence"));
});
