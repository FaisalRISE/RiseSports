import type { SkillAverage } from "@/lib/skills/store";

/* The thirteen-axis skill chart.
 *
 * Plain SVG, rendered on the server. A charting library for one polygon would
 * be a dependency, a client bundle and a hydration boundary bought for thirteen
 * points of trigonometry — and the Artifact/CSP rules elsewhere in this project
 * push the same way: draw it, do not import it.
 *
 * ── The label problem, which is the whole difficulty ─────────────────────
 * Thirteen labels around a circle will collide with the shape and with each
 * other unless each one is anchored by WHERE IT SITS: a label on the right edge
 * reads left-to-right away from the chart, one on the left reads towards it,
 * and one at the top or bottom is centred. The legacy chart calls these
 * "edge-anchored labels" and that is the trick being ported.
 *
 * An unrated axis is drawn at zero, not skipped. Thirteen points make a
 * particular shape; twelve make a different one, and a reader cannot tell a
 * missing axis from a weak one unless the axis is still there.
 */

export type SkillRadarProps = {
  skills: SkillAverage[];
  /** The scale's top. Scores run 1-5. */
  max?: number;
  size?: number;
  /** Drawn faintly behind, for "what I said" against "what everyone says". */
  compare?: Record<string, number> | null;
};

const POLAR = (cx: number, cy: number, r: number, i: number, n: number) => {
  /* Start at the top and go clockwise, which is how a radar is read. */
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
};

export function SkillRadar({ skills, max = 5, size = 260, compare = null }: SkillRadarProps) {
  const n = skills.length;
  if (n < 3) return null;

  /* Room for the labels outside the plot. The box is wider than it is tall
     because the longest labels sit on the left and right edges. */
  const padX = 74;
  const padY = 26;
  const r = size / 2;
  const cx = r + padX;
  const cy = r + padY;
  const w = size + padX * 2;
  const h = size + padY * 2;

  const ring = (frac: number) =>
    skills.map((_, i) => POLAR(cx, cy, r * frac, i, n).join(",")).join(" ");

  const shape = (get: (s: SkillAverage) => number) =>
    skills
      .map((s, i) => POLAR(cx, cy, (r * Math.max(0, Math.min(max, get(s)))) / max, i, n).join(","))
      .join(" ");

  const rated = skills.some((s) => s.score != null);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      style={{ maxWidth: w }}
      role="img"
      aria-label={
        rated
          ? `Skill chart: ${skills.filter((s) => s.score != null).map((s) => `${s.skill} ${s.score} out of ${max}`).join(", ")}`
          : "Skill chart, nothing rated yet"
      }
    >
      {/* Rings at each whole point of the scale, so a shape can be read off. */}
      {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
        <polygon
          key={f}
          points={ring(f)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={f === 1 ? 0.35 : 0.14}
          strokeWidth={1}
        />
      ))}

      {skills.map((s, i) => {
        const [x, y] = POLAR(cx, cy, r, i, n);
        return (
          <line key={s.skill} x1={cx} y1={cy} x2={x} y2={y}
            stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} />
        );
      })}

      {compare && (
        <polygon
          points={shape((s) => compare[s.skill] ?? 0)}
          fill="currentColor"
          fillOpacity={0.08}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="4 3"
          strokeWidth={1.5}
        />
      )}

      {rated && (
        <polygon
          points={shape((s) => s.score ?? 0)}
          fill="#65a30d"
          fillOpacity={0.28}
          stroke="#65a30d"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}

      {skills.map((s, i) => {
        const [lx, ly] = POLAR(cx, cy, r + 13, i, n);
        /* Anchored by position: the few pixels of slack stop a label at the
           very top or bottom from being called left or right by rounding. */
        const anchor = lx > cx + 4 ? "start" : lx < cx - 4 ? "end" : "middle";
        return (
          <text
            key={s.skill}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={9.5}
            fontWeight={700}
            fill="currentColor"
            fillOpacity={s.score == null ? 0.35 : 0.75}
          >
            {s.skill}
            {s.score != null && (
              <tspan fillOpacity={0.55}> {s.score.toFixed(1)}</tspan>
            )}
          </text>
        );
      })}
    </svg>
  );
}
