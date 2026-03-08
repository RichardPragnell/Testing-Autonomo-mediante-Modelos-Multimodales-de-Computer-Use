export function buildReleaseSummary(releases) {
  return releases.reduce(
    (summary, release) => {
      summary.total += 1;
      summary[release.state] += 1;
      return summary;
    },
    {
      total: 0,
      blocked: 0,
      monitoring: 0,
      live: 0
    }
  );
}
