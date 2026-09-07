/**
 * Arena scoring + leaderboards (Sprint 2).
 * Prefer Pareto evidence; weights are visible and configurable.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  cost: 0.35,
  latency: 0.2,
  storage_overhead: 0.15,
  success: 0.3,
});

function num(v, fallback = Infinity) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function scoreReport(report, { baseline = null, weights = DEFAULT_WEIGHTS } = {}) {
  const success = report?.RESULT?.exact_match === true ? 1 : 0;
  const cost = num(report?.ECONOMICS?.simulated_cost, Infinity);
  const latency = num(report?.PERFORMANCE?.retrieval_time, Infinity);
  const overhead = num(report?.METRICS?.primary?.storage_overhead, Infinity);

  let improvement = null;
  if (baseline?.ECONOMICS?.simulated_cost != null && Number.isFinite(cost)) {
    const b = Number(baseline.ECONOMICS.simulated_cost);
    improvement = b === 0 ? null : (b - cost) / b;
  }

  // Lower cost/latency/overhead is better → invert into [0,1]-ish utility via soft ratios vs baseline
  const baseCost = num(baseline?.ECONOMICS?.simulated_cost, cost || 1);
  const baseLat = num(baseline?.PERFORMANCE?.retrieval_time, latency || 1);
  const baseOh = num(baseline?.METRICS?.primary?.storage_overhead, overhead || 1);

  const costScore = baseCost > 0 ? Math.min(2, baseCost / Math.max(cost, 1e-18)) : 0;
  const latScore = baseLat > 0 ? Math.min(2, baseLat / Math.max(latency, 1e-18)) : 0;
  const ohScore = baseOh > 0 ? Math.min(2, baseOh / Math.max(overhead, 1e-18)) : 0;

  const composite =
    weights.success * success +
    weights.cost * costScore +
    weights.latency * latScore +
    weights.storage_overhead * ohScore;

  return {
    strategy: report?.STRATEGY ?? report?.BENCHMARK_META?.strategy ?? "unknown",
    success,
    cost,
    latency,
    storage_overhead: overhead,
    improvement_vs_baseline: improvement,
    composite,
    weights: { ...weights },
    evidence: {
      input_sha256: report?.INPUT?.sha256 ?? null,
      output_sha256: report?.RESULT?.output_sha256 ?? null,
      replay_hash: report?.TRACE?.replay_hash ?? null,
      exact_match: report?.RESULT?.exact_match ?? null,
    },
    kind: "simulated_score",
  };
}

export function buildLeaderboards(reports, { baselineStrategy = "FIFO-0.1", weights = DEFAULT_WEIGHTS } = {}) {
  const list = Array.isArray(reports) ? reports : [];
  const baseline = list.find((r) => (r.STRATEGY ?? r.BENCHMARK_META?.strategy) === baselineStrategy) ?? null;
  const scored = list.map((r) => scoreReport(r, { baseline, weights }));

  const by = (key, dir = "asc") =>
    [...scored].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });

  return {
    baseline: baselineStrategy,
    weights: { ...weights },
    absolute: by("composite", "desc"),
    cheapest: by("cost", "asc"),
    fastest: by("latency", "asc"),
    smallest_overhead: by("storage_overhead", "asc"),
    most_improved: by("improvement_vs_baseline", "desc"),
    kind: "simulated_leaderboard",
  };
}

/** Simple 2D Pareto on cost vs latency among successful runs. */
export function paretoFrontier(reports) {
  const ok = (Array.isArray(reports) ? reports : [])
    .filter((r) => r?.RESULT?.exact_match === true)
    .map((r) => ({
      strategy: r.STRATEGY ?? r.BENCHMARK_META?.strategy,
      cost: Number(r.ECONOMICS?.simulated_cost),
      latency: Number(r.PERFORMANCE?.retrieval_time),
    }))
    .filter((p) => Number.isFinite(p.cost) && Number.isFinite(p.latency));

  return ok.filter(
    (p) =>
      !ok.some(
        (q) =>
          q !== p &&
          q.cost <= p.cost &&
          q.latency <= p.latency &&
          (q.cost < p.cost || q.latency < p.latency)
      )
  );
}
