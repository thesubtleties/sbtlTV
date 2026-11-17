// packages/mailbox/src/server/metrics.ts
/**
 * Totals for the operator's dashboard, served on a separate port that only the cluster reaches
 * (main.ts). Counts only: no group, computer, address or time of any single request.
 */
export class Metrics {
  /** Uploads refused: not sealed, not in 16 KB steps, database over its cap, key-handoff entry not one of ours */
  refused = { unsealed: 0, unpadded: 0, db_full: 0, bad_rekey: 0 };
  /** Downloads refused because that version (or key) was downloaded too many times */
  limited = { box: 0, rekey: 0 };

  render(now: { dbBytes: number; maxDbBytes: number; tracked: number }): string {
    const lines = [
      '# HELP relay_uploads_refused_total Uploads the relay refused, by reason.',
      '# TYPE relay_uploads_refused_total counter',
      ...Object.entries(this.refused).map(([k, v]) => `relay_uploads_refused_total{reason="${k}"} ${v}`),
      '# HELP relay_downloads_limited_total Downloads refused because that version was downloaded too many times.',
      '# TYPE relay_downloads_limited_total counter',
      ...Object.entries(this.limited).map(([k, v]) => `relay_downloads_limited_total{kind="${k}"} ${v}`),
      '# HELP relay_db_bytes Size of the sync database.',
      '# TYPE relay_db_bytes gauge',
      `relay_db_bytes ${now.dbBytes}`,
      '# HELP relay_db_over_cap 1 while the database is over its size cap (only existing boxes can be replaced).',
      '# TYPE relay_db_over_cap gauge',
      `relay_db_over_cap ${now.dbBytes > now.maxDbBytes ? 1 : 0}`,
      '# HELP relay_downloads_tracked Box versions with a download count in memory.',
      '# TYPE relay_downloads_tracked gauge',
      `relay_downloads_tracked ${now.tracked}`,
    ];
    return lines.join('\n') + '\n';
  }
}
