import { useMemo } from 'react'
import type { Analysis } from '../lib/analyze'
import type { Fmt } from '../lib/format'
import type { Track } from '../lib/types'

type Props = {
  track: Track
  analysis: Analysis
  fmt: Fmt
  trimEnds: boolean
  hover: number | null
}

const SIZE = { w: 520, h: 300, pad: 18 }
const TRIM_M = 500

/**
 * The shape of the route with no map under it. Nothing is fetched to draw it,
 * and by default the first and last 500 m are left out, because routes tend to
 * start and end where people live.
 */
export function RouteSketch({ track, analysis: a, fmt, trimEnds, hover }: Props) {
  const drawn = useMemo(() => {
    if (!a.hasGps) return null
    // On a very short ride, hide a quarter at each end instead of everything.
    const trim = trimEnds ? Math.min(TRIM_M, a.distanceM * 0.25) : 0
    const from = trim
    const to = a.distanceM - trim
    const step = Math.max(1, Math.floor(a.n / 1800))
    const idx: number[] = []
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    for (let i = 0; i < a.n; i += step) {
      if (a.d[i] < from || a.d[i] > to) continue
      const la = track.lat[i]
      const lo = track.lon[i]
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
      idx.push(i)
      if (la < minLat) minLat = la
      if (la > maxLat) maxLat = la
      if (lo < minLon) minLon = lo
      if (lo > maxLon) maxLon = lo
    }
    if (idx.length < 2) return null
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const spanX = Math.max((maxLon - minLon) * k, 1e-6)
    const spanY = Math.max(maxLat - minLat, 1e-6)
    const scale = Math.min((SIZE.w - SIZE.pad * 2) / spanX, (SIZE.h - SIZE.pad * 2) / spanY)
    const offX = (SIZE.w - spanX * scale) / 2
    const offY = (SIZE.h - spanY * scale) / 2
    const px = (i: number) => offX + (track.lon[i] - minLon) * k * scale
    const py = (i: number) => offY + (maxLat - track.lat[i]) * scale
    const line = (indices: number[]) =>
      indices.map((i, n) => `${n ? 'L' : 'M'}${px(i).toFixed(1)},${py(i).toFixed(1)}`).join('')
    const within = (i: number) => a.d[i] >= from && a.d[i] <= to
    return {
      trim,
      path: line(idx),
      climbs: a.climbs.map((c) => line(idx.filter((i) => a.d[i] >= c.startM && a.d[i] <= c.endM))),
      stops: a.stops.filter((s) => within(s.startIdx)).map((s) => [px(s.startIdx), py(s.startIdx)] as const),
      fastest: a.fastest && within(a.fastest.idx) ? ([px(a.fastest.idx), py(a.fastest.idx)] as const) : null,
      px,
      py,
      within,
    }
  }, [a, track, trimEnds])

  if (!drawn) {
    return (
      <section className="card route">
        <p className="caption">
          <span>Route</span>
        </p>
        <p className="quiet">This file has no GPS positions, so there is no route to draw.</p>
      </section>
    )
  }

  const showHover = hover !== null && Number.isFinite(track.lat[hover]) && drawn.within(hover)
  return (
    <section className="card route">
      <p className="caption">
        <span>Route</span>
        <span>{drawn.trim > 0 ? `First and last ${fmt.ele(drawn.trim)} hidden` : 'Whole route shown'}</span>
        <span>No map, nothing sent anywhere</span>
      </p>
      <svg viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} role="img" aria-label="The shape of the route, without a map">
        <path d={drawn.path} className="route-line" />
        {drawn.climbs.map((d, i) => d && <path key={i} d={d} className="route-climb" />)}
        {drawn.stops.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={4} className="route-stop" />
        ))}
        {drawn.fastest && <circle cx={drawn.fastest[0]} cy={drawn.fastest[1]} r={5} className="route-fast" />}
        {showHover && <circle cx={drawn.px(hover)} cy={drawn.py(hover)} r={6} className="route-hover" />}
      </svg>
    </section>
  )
}
