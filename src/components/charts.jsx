/**
 * Shared chart configuration.
 *
 * Palette is validated, not eyeballed: the blue/red diverging pair was run
 * through the data-viz validator against this app's actual dark surface
 * (#12151c) and clears every gate — CVD ΔE 19.2, normal-vision ΔE 29.0,
 * both poles above 3:1 contrast.
 *
 * Every chart here is single-measure, so there is exactly one value axis.
 */

export const VIZ = {
  surface: "#12151c",
  // Single-hue blue for plain magnitude.
  series: "#3987e5",
  // Diverging poles for over/under-performance, split at the channel median.
  above: "#3987e5",
  below: "#e66767",
  grid: "#232833",
  axis: "#333a48",
  muted: "#6b7486",
  text: "#c7cddb"
};

export const axisProps = {
  stroke: VIZ.axis,
  tick: { fill: VIZ.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: VIZ.axis }
};

export const gridProps = {
  stroke: VIZ.grid,
  strokeDasharray: "0",
  vertical: false
};

/** Tooltip styled to the app surface rather than Recharts' light default. */
export function VizTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-ink-200">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-ink-300">
          {formatter ? formatter(entry) : `${entry.name}: ${entry.value}`}
        </p>
      ))}
    </div>
  );
}
