interface ChartSeries {
  key: string;
  label: string;
  colorVar: string;
}

interface ChartPoint {
  label: string;
  values: Record<string, number>;
}

interface AccessibleChartProps {
  title: string;
  /** One-sentence plain-language summary — spec §10.6 requires every chart to carry one. */
  summary: string;
  series: ChartSeries[];
  points: ChartPoint[];
}

/**
 * No chart library is in this project's dependency tree — this is a small
 * hand-built grouped-bar chart (max 2 series per spec §10.6) rather than
 * adding a new charting dependency for one feature. Exact values are always
 * present in a real <table> (keyboard + screen-reader accessible via the
 * native <details> disclosure), not just in the SVG.
 */
export function AccessibleChart({ title, summary, series, points }: AccessibleChartProps) {
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const barWidth = 10;
  const groupGap = 6;
  const seriesGap = 2;
  const groupWidth = series.length * barWidth + (series.length - 1) * seriesGap;
  const chartHeight = 140;
  const svgWidth = points.length * (groupWidth + groupGap);

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-sm text-ink-muted">{summary}</p>

      <div className="mt-3 flex items-center gap-4 text-xs text-ink-muted">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.colorVar }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${svgWidth} ${chartHeight + 20}`}
          width={svgWidth}
          height={chartHeight + 20}
          className="min-w-full"
        >
          {points.map((point, pi) => {
            const groupX = pi * (groupWidth + groupGap);
            return (
              <g key={point.label}>
                {series.map((s, si) => {
                  const value = point.values[s.key] ?? 0;
                  const barHeight = (value / max) * chartHeight;
                  const x = groupX + si * (barWidth + seriesGap);
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={chartHeight - barHeight}
                      width={barWidth}
                      height={Math.max(barHeight, value > 0 ? 1 : 0)}
                      fill={s.colorVar}
                      rx={1}
                    />
                  );
                })}
                <text
                  x={groupX + groupWidth / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fontSize="8"
                  fill="currentColor"
                  className="text-ink-muted"
                >
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-primary">View exact values</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title} — exact values by day</caption>
            <thead>
              <tr className="text-ink-muted">
                <th scope="col" className="py-1 pr-3">
                  Date
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-3">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label} className="border-t border-border">
                  <td className="py-1 pr-3 text-ink">{point.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 tabular-nums text-ink">
                      {(point.values[s.key] ?? 0).toLocaleString("en-KE")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
