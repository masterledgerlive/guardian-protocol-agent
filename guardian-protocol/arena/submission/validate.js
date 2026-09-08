/**
 * Arena submission validation (Sprint 2).
 */
export const REQUIRED_FIELDS = Object.freeze([
  "strategy_name",
  "strategy_version",
  "author_or_agent_id",
  "parent_strategy",
  "assumptions",
  "dependencies",
  "benchmark_version",
  "execution_command",
  "input_hash",
  "output_hash",
  "trace_log",
  "metrics",
  "resource_usage",
  "cost_model",
  "limitations",
  "reproduction_instructions",
]);

export function validateSubmission(submission) {
  const errors = [];
  const warnings = [];
  if (!submission || typeof submission !== "object") {
    return { ok: false, errors: ["submission must be an object"], warnings };
  }

  for (const field of REQUIRED_FIELDS) {
    if (submission[field] === undefined || submission[field] === null || submission[field] === "") {
      errors.push(`missing field: ${field}`);
    }
  }

  if (submission.assumptions != null && !Array.isArray(submission.assumptions) && typeof submission.assumptions !== "string") {
    errors.push("assumptions must be an array or string");
  }

  if (submission.input_hash && !/^[a-f0-9]{64}$/i.test(String(submission.input_hash))) {
    warnings.push("input_hash should be a 64-char hex SHA-256");
  }
  if (submission.output_hash && !/^[a-f0-9]{64}$/i.test(String(submission.output_hash))) {
    warnings.push("output_hash should be a 64-char hex SHA-256");
  }

  if (submission.kind === "production" || submission.claims_production === true) {
    errors.push("submissions must not claim production results from the simulator");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function submissionFromReport(report, extras = {}) {
  return {
    strategy_name: report?.BENCHMARK_META?.strategy?.split("-")[0] ?? "UNKNOWN",
    strategy_version: report?.BENCHMARK_META?.strategy?.split("-").slice(1).join("-") ?? "0.0",
    author_or_agent_id: extras.author_or_agent_id ?? "local",
    parent_strategy: extras.parent_strategy ?? "FIFO-0.1",
    assumptions: report?.ASSUMPTIONS ?? [],
    dependencies: extras.dependencies ?? [],
    benchmark_version: report?.BENCHMARK_VERSION ?? "0.1.0",
    execution_command: extras.execution_command ?? "npm run benchmark",
    input_hash: report?.INPUT?.sha256 ?? null,
    output_hash: report?.RESULT?.output_sha256 ?? null,
    trace_log: report?.TRACE ?? null,
    metrics: report?.METRICS ?? null,
    resource_usage: {
      treasury: report?.TREASURY ?? null,
      storage: report?.STORAGE ?? null,
    },
    cost_model: report?.ECONOMICS ?? null,
    limitations: extras.limitations ?? ["simulated costs only", "identity encoding"],
    reproduction_instructions:
      extras.reproduction_instructions ??
      "cd guardian-protocol && npm test && npm run benchmark -- --strategy <KEY>",
    kind: "simulated",
  };
}
