import { useMemo } from 'react'
import { AHA, type Analysis } from '../lib/analyze'
import { duration, type Fmt } from '../lib/format'
import { useWidth } from './useWidth'

type Props = {
  analysis: Analysis
  fmt: Fmt
  maxHr: number | null
  /** Index of the point under the pointer, shared with the route drawing. */
  hover: number | null
  onHover: (index: number | null) => void
}

const PAD = { left: 0, right: 0 }

/** Mean of a column inside each horizontal pixel bin, so 13,000 points draw as ~700. */
function binByDistance(a: Analysis, column: Float32Array, bins: number) {
  const sum = new Float64Array(bins)
  const count = new Uint32Array(bins)
  const total = a.distanceM || 1
  for (let i = 0; i < a.n; i++) {
    const value = column[i]
    if (!Number.isFinite(value)) continue
    const b = Math.min(bins - 1, Math.floor((a.d[i] / total) * bins))
    sum[b] += value
    count[b]++
  }
  const out = new Float32Array(bins).fill(NaN)
  for (let b = 0; b < bins; b++) if (count[b]) out[b] = sum[b] / count[b]
  // Bridge empty bins (stops, sparse recording) from the last known value.
  let last = NaN
  for (let b = 0; b < bins; b++) {
    if (Number.isFinite(out[b])) last = out[b]
    else out[b] = last
  }
  for (let b = bins - 1; b >= 0; b--) {
    if (Number.isFinite(out[b])) last = out[b]
    else out[b] = last
  }
  return out
}

function niceStep(span: number, target: number) {
  const rough = span / target
  const pow = 10 ** Math.floor(Math.log10(rough))
  const unit = rough / pow
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * pow
}

function indexAtDistance(a: Analysis, meters: number) {
  let lo = 0
  let hi = a.n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a.d[mid] < meters) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function RideCharts({ analysis: a, fmt, maxHr, hover, onHover }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const total = a.distanceM || 1
  const plotW = width - PAD.left - PAD.right
  const x = (m: number) => PAD.left + (m / total) * plotW
  const bins = Math.max(60, Math.min(900, Math.floor(plotW / 1.5)))

  const eleBins = useMemo(() => (a.hasEle ? binByDistance(a, a.ele, bins) : null), [a, bins])
  const hrBins = useMemo(() => (a.heart ? binByDistance(a, a.hr, bins) : null), [a, bins])

  const ticks = useMemo(() => {
    const span = fmt.inUnits(total)
    const step = niceStep(span, width < 520 ? 4 : 6)
    const out: number[] = []
    for (let v = 0; v <= span + 1e-9; v += step) out.push(v)
    return { out, step }
  }, [fmt, total, width])

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left - PAD.left) / plotW))
    onHover(indexAtDistance(a, ratio * total))
  }

  const hoverX = hover !== null ? x(a.d[hover]) : null
  const unitM = total / fmt.inUnits(total)

  // ---- elevation ----
  const eleH = 150
  const eleTop = 10
  const range = Math.max(a.maxEle - a.minEle, 12)
  const yEle = (e: number) => eleTop + (1 - (e - a.minEle) / range) * (eleH - eleTop)
  const binX = (b: number) => PAD.left + ((b + 0.5) / bins) * plotW
  let area = ''
  if (eleBins) {
    area = `M${PAD.left},${eleH}`
    area += ` L${PAD.left},${yEle(eleBins[0]).toFixed(1)}`
    for (let b = 0; b < bins; b++) area += ` L${binX(b).toFixed(1)},${yEle(eleBins[b]).toFixed(1)}`
    area += ` L${PAD.left + plotW},${yEle(eleBins[bins - 1]).toFixed(1)} L${PAD.left + plotW},${eleH} Z`
  }

  // ---- heart rate ----
  const hrH = 96
  const hrTop = 8
  let hrLo = 0
  let hrHi = 1
  let hrPath = ''
  const cuts =
    maxHr && a.heart
      ? [
          { bpm: Math.round(maxHr * AHA.moderate), name: 'moderate from' },
          { bpm: Math.round(maxHr * AHA.vigorous), name: 'vigorous from' },
          { bpm: Math.round(maxHr * AHA.top), name: 'above vigorous from' },
        ]
      : []
  if (hrBins && a.heart) {
    hrLo = Infinity
    hrHi = -Infinity
    for (let b = 0; b < bins; b++) {
      if (hrBins[b] < hrLo) hrLo = hrBins[b]
      if (hrBins[b] > hrHi) hrHi = hrBins[b]
    }
    hrLo = Math.floor((hrLo - 6) / 10) * 10
    hrHi = Math.ceil((hrHi + 4) / 10) * 10
  }
  const yHr = (bpm: number) => hrTop + (1 - (bpm - hrLo) / (hrHi - hrLo)) * (hrH - hrTop)
  if (hrBins) {
    for (let b = 0; b < bins; b++) hrPath += `${b ? 'L' : 'M'}${binX(b).toFixed(1)},${yHr(hrBins[b]).toFixed(1)}`
  }
  const visibleCuts = cuts.filter((c) => c.bpm > hrLo + 4 && c.bpm < hrHi - 2)

  const tip =
    hover !== null
      ? [
          `${fmt.marker} ${fmt.inUnits(a.d[hover]).toFixed(1)}`,
          a.hasEle ? fmt.ele(a.ele[hover]) : null,
          a.hasTime ? fmt.speed(a.v[hover]) : null,
          Number.isFinite(a.hr[hover]) ? `${Math.round(a.hr[hover])} bpm` : null,
          a.hasTime ? `${duration(a.t[hover])} in` : null,
        ].filter(Boolean)
      : null

  return (
    <section className="charts" ref={ref} aria-label="Ride charts">
      {eleBins ? (
        <>
          <p className="caption">
            <span>Elevation</span>
            {a.climbs.length > 0 && (
              <span>
                <i className="key climb" /> Climbs in orange
              </span>
            )}
            {a.stops.length > 0 && (
              <span>
                <i className="key stop" /> Stops as ticks
              </span>
            )}
            {a.fastest && (
              <span>
                <i className="key fast" /> Violet line = fastest
              </span>
            )}
            <span className="range">
              low {fmt.ele(a.minEle)} · high {fmt.ele(a.maxEle)}
            </span>
          </p>
          <svg
            className="chart"
            width={width}
            height={eleH + 22}
            role="img"
            aria-label={`Elevation along the ride, from ${fmt.ele(a.minEle)} to ${fmt.ele(a.maxEle)}`}
            onPointerMove={onMove}
            onPointerLeave={() => onHover(null)}
          >
            <defs>
              <clipPath id="climb-clip">
                {a.climbs.map((c, i) => (
                  <rect key={i} x={x(c.startM)} y={0} width={Math.max(1, x(c.endM) - x(c.startM))} height={eleH} />
                ))}
              </clipPath>
            </defs>
            <path d={area} className="area" />
            {a.climbs.length > 0 && <path d={area} className="area climb" clipPath="url(#climb-clip)" />}
            {a.stops.map((s, i) => (
              <line key={i} x1={x(s.atM)} x2={x(s.atM)} y1={eleH - 16} y2={eleH} className="stop-tick">
                <title>{`Stop: ${duration(s.durationS)}`}</title>
              </line>
            ))}
            {a.fastest && <line x1={x(a.fastest.atM)} x2={x(a.fastest.atM)} y1={0} y2={eleH} className="fast-line" />}
            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={0} y2={eleH} className="cross" />}
            {hoverX !== null && hover !== null && <circle cx={hoverX} cy={yEle(a.ele[hover])} r={4} className="dot" />}
            <Axis ticks={ticks.out} x={(v) => x(v * unitM)} y={eleH + 15} unit={fmt.distUnit} width={width} />
          </svg>
        </>
      ) : (
        <p className="caption">
          <span>No elevation in this file, so there is no profile to draw.</span>
        </p>
      )}

      {hrBins && a.heart && (
        <>
          <p className="caption second">
            <span>Heart rate</span>
            {a.heart.hardest && (
              <span>
                <i className="key hardest" /> Shaded = highest stretch
              </span>
            )}
            <span className="range">
              average {Math.round(a.heart.avg)} · peak {Math.round(a.heart.max)} bpm
            </span>
          </p>
          <svg
            className="chart"
            width={width}
            height={hrH + 22}
            role="img"
            aria-label={`Heart rate along the ride, average ${Math.round(a.heart.avg)} beats per minute`}
            onPointerMove={onMove}
            onPointerLeave={() => onHover(null)}
          >
            {a.heart.hardest && (
              <rect
                x={x(a.heart.hardest.startM)}
                y={0}
                width={Math.max(2, x(a.heart.hardest.endM) - x(a.heart.hardest.startM))}
                height={hrH}
                className="hardest"
              />
            )}
            {visibleCuts.map((c) => (
              <g key={c.bpm}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={yHr(c.bpm)} y2={yHr(c.bpm)} className="grid" />
                <text x={PAD.left + plotW - 4} y={yHr(c.bpm) - 4} className="grid-label" textAnchor="end">
                  {c.name} {c.bpm} bpm
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={PAD.left + plotW} y1={hrH} y2={hrH} className="base" />
            <path d={hrPath} className="hr-line" />
            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={0} y2={hrH} className="cross" />}
            {hoverX !== null && hover !== null && Number.isFinite(a.hr[hover]) && (
              <circle cx={hoverX} cy={yHr(a.hr[hover])} r={4} className="dot" />
            )}
            <Axis ticks={ticks.out} x={(v) => x(v * unitM)} y={hrH + 15} unit={fmt.distUnit} width={width} />
          </svg>
        </>
      )}

      <p className="tip" aria-live="off">
        {tip ? tip.join('  ·  ') : 'Move or drag along a chart to read any point of the ride.'}
      </p>
    </section>
  )
}

function Axis({ ticks, x, y, unit, width }: { ticks: number[]; x: (v: number) => number; y: number; unit: string; width: number }) {
  return (
    <g className="axis">
      {ticks.map((v, i) => {
        const px = x(v)
        const anchor = i === 0 ? 'start' : px > width - 30 ? 'end' : 'middle'
        return (
          <text key={v} x={px} y={y} textAnchor={anchor}>
            {Number.isInteger(v) ? v : v.toFixed(1)} {unit}
          </text>
        )
      })}
    </g>
  )
}
