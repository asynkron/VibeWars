import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REPORT_PATH_ENV = "VIBEWARS_VITEST_REPORT";

export default class QualityJsonReporter {
  async onTestRunEnd(testModules) {
    const reportPath = String(process.env[REPORT_PATH_ENV] || "").trim();
    if (!reportPath) throw new Error(`${REPORT_PATH_ENV} is required`);

    const report = {
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [],
    };

    for (const testModule of testModules) {
      const assertionResults = [];
      for (const testCase of testModule.children.allTests()) {
        const result = testCase.result();
        const status = reporterStatus(testCase, result);
        report.numTotalTests += 1;
        if (status === "passed") report.numPassedTests += 1;
        else if (status === "failed") report.numFailedTests += 1;
        else if (status === "todo") report.numTodoTests += 1;
        else report.numPendingTests += 1;

        assertionResults.push({
          id: testCase.id,
          ancestorTitles: ancestorTitles(testCase, testModule),
          fullName: testCase.fullName,
          status,
          title: testCase.name,
          failureMessages: result.errors?.map((error) => error.stack || error.message || String(error)) || [],
        });
      }
      report.testResults.push({
        assertionResults,
        status: testModule.ok() ? "passed" : "failed",
        message: testModule.errors()[0]?.message || "",
        name: testModule.moduleId,
      });
    }

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}

function reporterStatus(testCase, result) {
  if (result.state === "passed" || result.state === "failed") return result.state;
  if (result.state === "skipped" && testCase.options.mode === "todo") return "todo";
  return result.state;
}

function ancestorTitles(testCase, testModule) {
  const titles = [];
  let parent = testCase.parent;
  while (parent && parent !== testModule) {
    if (parent.name) titles.push(parent.name);
    parent = parent.parent;
  }
  return titles.reverse();
}
