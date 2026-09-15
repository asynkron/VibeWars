#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PRODUCER_ID = "vitest-tests";
export const EVIDENCE_FILE = `${PRODUCER_ID}.quality-evidence.json`;
const NATIVE_REPORT_FILE = `${PRODUCER_ID}.vitest.json`;
const NATIVE_REPORTER_FILE = "./scripts/vitest-quality-reporter.mjs";
const MAX_FAILURES = 100;
const MAX_MESSAGE_LENGTH = 1_000;

export function resolveEvidenceDir(env = process.env, repoRoot = process.cwd()) {
  const configured = String(env.FAKTORIAL_QUALITY_EVIDENCE_DIR || "").trim();
  return configured || path.join(repoRoot, ".faktorial", "quality-evidence");
}

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function completeEnvelope(payload) {
  return {
    schema_version: "quality-evidence.v1",
    producer_id: PRODUCER_ID,
    kind: "test-results",
    payload_schema: "test-results.v1",
    status: "complete",
    payload,
  };
}

export function notApplicableEnvelope(reason) {
  return terminalEnvelope("not_applicable", reason);
}

export function translationFailedEnvelope(reason) {
  return terminalEnvelope("translation_failed", reason);
}

function terminalEnvelope(status, reason) {
  return {
    schema_version: "quality-evidence.v1",
    producer_id: PRODUCER_ID,
    kind: "test-results",
    payload_schema: "test-results.v1",
    status,
    reason: cleanReason(reason),
  };
}

export function envelopeForRun({ testStarted, testExecutionError = "", testExitCode = 0, report }) {
  if (!testStarted) {
    return notApplicableEnvelope(testExecutionError || "the quality gate stopped before Vitest started");
  }
  if (testExecutionError) {
    return translationFailedEnvelope(`Vitest started but did not complete: ${testExecutionError}`);
  }
  if (!report) {
    return translationFailedEnvelope(
      `Vitest started but did not publish its JSON report${testExitCode ? ` (exit code ${testExitCode})` : ""}`,
    );
  }

  try {
    return completeEnvelope(translateVitestReport(report));
  } catch (error) {
    return translationFailedEnvelope(error?.message || error);
  }
}

export function translateVitestReport(report, repoRoot = process.cwd()) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Vitest JSON report must be an object");
  }

  const summary = {
    total: integerField(report, "numTotalTests"),
    passed: integerField(report, "numPassedTests"),
    failed: integerField(report, "numFailedTests"),
    skipped: integerField(report, "numPendingTests") + integerField(report, "numTodoTests"),
  };
  if (summary.total !== summary.passed + summary.failed + summary.skipped) {
    throw new Error("Vitest summary counts are contradictory");
  }
  if (!Array.isArray(report.testResults)) {
    throw new Error("Vitest JSON report omitted testResults");
  }

  const assertions = [];
  const identities = new Set();
  for (const testFile of report.testResults) {
    if (!testFile || typeof testFile !== "object" || !Array.isArray(testFile.assertionResults)) {
      throw new Error("Vitest JSON report contains a test file without assertionResults");
    }
    const file = stableFileName(testFile.name, repoRoot);
    for (const assertion of testFile.assertionResults) {
      const terminal = terminalStatus(assertion?.status);
      if (!terminal) {
        throw new Error(`Vitest assertion has an unsupported terminal status: ${String(assertion?.status)}`);
      }
      const ancestors = Array.isArray(assertion.ancestorTitles)
        ? assertion.ancestorTitles.map((value) => String(value).trim()).filter(Boolean)
        : [];
      const test = String(assertion.title || assertion.fullName || "").trim();
      const taskId = String(assertion.id || "").trim();
      if (!file || !test || !taskId) throw new Error("Vitest assertion omitted a stable file, test, or task identity");
      const suite = ancestors.length ? `${file} :: ${ancestors.join(" > ")}` : file;
      if (identities.has(taskId)) throw new Error(`Vitest emitted duplicate terminal task identity: ${taskId}`);
      identities.add(taskId);
      assertions.push({ assertion, suite, task: test, taskId, terminal });
    }
  }

  const observed = { total: 0, passed: 0, failed: 0, skipped: 0 };
  const failures = [];
  const displayCounts = new Map();
  for (const assertion of assertions) {
    const displayIdentity = `${assertion.suite}\0${assertion.task}`;
    displayCounts.set(displayIdentity, (displayCounts.get(displayIdentity) || 0) + 1);
    observed.total += 1;
    observed[assertion.terminal] += 1;
  }
  for (const assertion of assertions) {
    if (assertion.terminal !== "failed") continue;
    const displayIdentity = `${assertion.suite}\0${assertion.task}`;
    const test = displayCounts.get(displayIdentity) > 1
      ? `${assertion.task} [${assertion.taskId}]`
      : assertion.task;
    failures.push({
      suite: assertion.suite,
      test,
      message: cleanMessage(firstFailureMessage(assertion.assertion)),
    });
  }

  if (!sameCounts(summary, observed)) {
    throw new Error(
      `Vitest summary/detail count mismatch: summary=${JSON.stringify(summary)} detail=${JSON.stringify(observed)}`,
    );
  }
  failures.sort((left, right) => left.suite.localeCompare(right.suite) || left.test.localeCompare(right.test));
  const payload = { counts: summary, failures: failures.slice(0, MAX_FAILURES) };
  if (failures.length > MAX_FAILURES) payload.omitted_failures = failures.length - MAX_FAILURES;
  if (payload.counts.failed !== payload.failures.length + (payload.omitted_failures || 0)) {
    throw new Error("Vitest failed count does not match retained plus omitted failures");
  }
  return payload;
}

export async function prepareEvidenceDir(dir) {
  await mkdir(dir, { recursive: true });
  const staleFiles = (await readdir(dir)).filter((file) =>
    file.endsWith(".quality-evidence.json")
    || file === NATIVE_REPORT_FILE
    || /^\.(?:.+\.quality-evidence\.json|producers\.json)\..+\.tmp$/.test(file));
  await Promise.all(staleFiles.map((file) => rm(path.join(dir, file), { force: true })));
  await writeAtomicJson(dir, "producers.json", { started: [], categories: [] });
}

export async function writeStartedManifest(dir, started) {
  await writeAtomicJson(dir, "producers.json", {
    started: started ? [PRODUCER_ID] : [],
    categories: [],
  });
}

export async function writeEnvelope(dir, envelope) {
  await writeAtomicJson(dir, EVIDENCE_FILE, envelope);
}

export async function writeAtomicJson(dir, fileName, value) {
  const target = path.join(dir, fileName);
  const temporary = path.join(dir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function runCommand(executable, args, options = {}) {
  return new Promise((resolve) => {
    let started = false;
    let settled = false;
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: "inherit",
      shell: false,
    });
    child.once("spawn", () => { started = true; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ started, exitCode: 1, error: cleanReason(error?.message || error) });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (signal) {
        resolve({ started, exitCode: 1, error: `${executable} terminated by ${signal}` });
        return;
      }
      resolve({ started, exitCode: Number.isInteger(code) ? code : 1, error: "" });
    });
  });
}

async function runQuality() {
  const repoRoot = process.cwd();
  const evidenceDir = resolveEvidenceDir(process.env, repoRoot);
  const nativeReport = path.join(evidenceDir, NATIVE_REPORT_FILE);
  const npm = npmExecutable();
  await prepareEvidenceDir(evidenceDir);

  let exitCode = 0;
  let testStarted = false;
  let testExecutionError = "";
  let testExitCode = 0;
  let report;

  for (const phase of [
    { label: "dependency installation", executable: npm, args: ["ci"] },
    {
      label: "quality evidence contract tests",
      executable: process.execPath,
      args: ["--test", "scripts/quality-evidence.test.mjs"],
    },
    { label: "TypeScript typecheck", executable: npm, args: ["run", "typecheck"] },
  ]) {
    console.log(`quality-evidence: running ${phase.label}`);
    const result = await runCommand(phase.executable, phase.args, { cwd: repoRoot });
    if (result.exitCode !== 0 || result.error) {
      exitCode = result.exitCode || 1;
      testExecutionError = `${phase.label} failed${result.error ? `: ${result.error}` : ` (exit code ${exitCode})`}`;
      break;
    }
  }

  if (!exitCode) {
    console.log("quality-evidence: running Vitest with its JSON reporter");
    const result = await runCommand(
      npm,
      ["test", "--", `--reporter=${NATIVE_REPORTER_FILE}`],
      { cwd: repoRoot, env: { ...process.env, VIBEWARS_VITEST_REPORT: nativeReport } },
    );
    testStarted = result.started;
    testExecutionError = result.error;
    testExitCode = result.exitCode;
    await writeStartedManifest(evidenceDir, testStarted);
    try {
      report = JSON.parse(await readFile(nativeReport, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") testExecutionError ||= `could not read Vitest JSON report: ${cleanReason(error?.message || error)}`;
    } finally {
      await rm(nativeReport, { force: true });
    }
    if (result.exitCode !== 0 || result.error) exitCode = result.exitCode || 1;
  }

  const envelope = envelopeForRun({ testStarted, testExecutionError, testExitCode, report });
  await writeEnvelope(evidenceDir, envelope);

  if (!exitCode && envelope.status === "complete") {
    console.log("quality-evidence: running Vite production build");
    const result = await runCommand(npm, ["run", "build"], { cwd: repoRoot });
    if (result.exitCode !== 0 || result.error) exitCode = result.exitCode || 1;
  }
  if (envelope.status === "translation_failed") {
    console.error(`quality-evidence: translation failed: ${envelope.reason}`);
    exitCode ||= 1;
  }
  return exitCode;
}

function integerField(value, field) {
  const candidate = value[field];
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new Error(`Vitest JSON report has invalid ${field}`);
  }
  return candidate;
}

function terminalStatus(status) {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "todo" || status === "skipped" || status === "disabled") return "skipped";
  return "";
}

function stableFileName(value, repoRoot) {
  const name = String(value || "").trim();
  if (!name) return "";
  const absolute = path.resolve(repoRoot, name);
  const relative = path.relative(repoRoot, absolute);
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return name.split(path.sep).join("/");
}

function firstFailureMessage(assertion) {
  if (Array.isArray(assertion.failureMessages) && assertion.failureMessages.length) return assertion.failureMessages[0];
  return assertion.failureMessage || "Vitest reported failure";
}

function sameCounts(left, right) {
  return left.total === right.total
    && left.passed === right.passed
    && left.failed === right.failed
    && left.skipped === right.skipped;
}

function cleanMessage(value) {
  return String(value || "Vitest reported failure")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/(?:Bearer\s+|token=)[^\s]+/gi, (match) => match.startsWith("token=") ? "token=[REDACTED]" : "Bearer [REDACTED]")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH) || "Vitest reported failure";
}

function cleanReason(value) {
  return String(value || "unknown evidence translation failure")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    process.exitCode = await runQuality();
  } catch (error) {
    console.error(`quality-evidence: ${cleanReason(error?.message || error)}`);
    process.exitCode = 2;
  }
}
