/**
 * CLI for validating deployment configuration without starting the server.
 */

import "dotenv/config";
import { loadConfig } from "./config.js";
import { getReadinessReport } from "./services/readiness.js";

const report = getReadinessReport(loadConfig());
const asJson = process.argv.includes("--json");

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Production readiness: ${report.status}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Network: ${report.network}`);

  if (report.issues.length === 0) {
    console.log("No readiness issues found.");
  } else {
    console.log("Issues:");
    for (const issue of report.issues) {
      const env = issue.env?.length ? ` (${issue.env.join(", ")})` : "";
      console.log(`- ${issue.severity}: ${issue.code}${env}: ${issue.message}`);
    }
  }
}

if (report.status !== "ready") {
  process.exitCode = 1;
}
