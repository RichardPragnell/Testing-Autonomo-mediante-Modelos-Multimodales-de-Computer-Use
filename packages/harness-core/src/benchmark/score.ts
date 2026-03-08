import type { ModelRunMetrics, TaskRunResult } from "../types.js";

function avg(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function std(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const mean = avg(values);
  const variance = avg(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function wilsonInterval(successes: number, total: number, z = 1.96): { low: number; high: number } {
  if (total === 0) {
    return { low: 0, high: 0 };
  }
  const p = successes / total;
  const denom = 1 + (z ** 2) / total;
  const center = (p + (z ** 2) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z ** 2) / (4 * total ** 2))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
}

export function computeCompositeScore(input: {
  passRate: number;
  stability: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}): number {
  const latencyScore = 1 / (1 + input.avgLatencyMs / 2_000);
  const costScore = 1 / (1 + input.avgCostUsd / 0.05);

  const weighted =
    input.passRate * 0.45 + input.stability * 0.25 + latencyScore * 0.2 + costScore * 0.1;
  return Number((weighted * 100).toFixed(3));
}

function computeStability(taskRuns: TaskRunResult[]): number {
  if (!taskRuns.length) {
    return 0;
  }
  const grouped = new Map<string, number[]>();
  for (const run of taskRuns) {
    const current = grouped.get(run.taskId) ?? [];
    current.push(run.success ? 1 : 0);
    grouped.set(run.taskId, current);
  }
  const deviations = [...grouped.values()].map((values) => std(values));
  const stability = 1 - avg(deviations);
  return Number(Math.max(0, Math.min(1, stability)).toFixed(6));
}

export function buildModelMetrics(modelId: string, taskRuns: TaskRunResult[], skipped: number): ModelRunMetrics {
  const passed = taskRuns.filter((run) => run.success).length;
  const failed = taskRuns.length - passed;
  const total = taskRuns.length + skipped;
  const passRate = taskRuns.length ? passed / taskRuns.length : 0;
  const avgLatencyMs = avg(taskRuns.map((run) => run.latencyMs));
  const avgCostUsd = avg(taskRuns.map((run) => run.costUsd));
  const stability = computeStability(taskRuns);
  const score = computeCompositeScore({
    passRate,
    stability,
    avgLatencyMs,
    avgCostUsd
  });
  const confidence95 = wilsonInterval(passed, Math.max(taskRuns.length, 1));

  return {
    modelId,
    total,
    passed,
    failed,
    skipped,
    passRate: Number(passRate.toFixed(6)),
    stability,
    avgLatencyMs: Number(avgLatencyMs.toFixed(3)),
    avgCostUsd: Number(avgCostUsd.toFixed(6)),
    score,
    confidence95
  };
}

