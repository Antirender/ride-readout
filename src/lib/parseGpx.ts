import { emptyTrack, type Track } from './types'

export type ParsedFile = {
  track: Track
  startTime: number | null
  name?: string
}

const POINT_RE = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
const LAT_RE = /\blat\s*=\s*["']([^"']+)["']/
const LON_RE = /\blon\s*=\s*["']([^"']+)["']/
const ELE_RE = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/
const TIME_RE = /<time>\s*([^<]+?)\s*<\/time>/
// Garmin, Strava and friends put heart rate in a TrackPointExtension: <gpxtpx:hr>
const HR_RE = /<(?:\w+:)?(?:hr|heartrate)>\s*([\d.]+)\s*</i
// Apple writes <speed> and <hAcc> straight into <extensions>
const SPEED_RE = /<(?:\w+:)?speed>\s*([-\d.eE+]+)\s*</
const HACC_RE = /<(?:\w+:)?hAcc>\s*([-\d.eE+]+)\s*</

/**
 * Reads a GPX track without a DOM, so it works the same in the page,
 * in a worker and in tests.
 */
export function parseGpx(text: string): ParsedFile {
  if (!/<gpx[\s>]/i.test(text.slice(0, 4000)) && !text.includes('<trkpt')) {
    throw new Error("This doesn't look like a GPX file.")
  }

  const lat: number[] = []
  const lon: number[] = []
  const ele: number[] = []
  const time: number[] = []
  const hr: number[] = []
  const speed: number[] = []
  const hAcc: number[] = []
  let timed = 0

  POINT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = POINT_RE.exec(text))) {
    const attrs = m[2]
    const body = m[3] ?? ''
    const la = Number(LAT_RE.exec(attrs)?.[1])
    const lo = Number(LON_RE.exec(attrs)?.[1])
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
    lat.push(la)
    lon.push(lo)
    ele.push(num(ELE_RE.exec(body)?.[1]))
    const t = Date.parse(TIME_RE.exec(body)?.[1] ?? '')
    if (Number.isFinite(t)) timed++
    time.push(t)
    hr.push(num(HR_RE.exec(body)?.[1]))
    speed.push(num(SPEED_RE.exec(body)?.[1]))
    hAcc.push(num(HACC_RE.exec(body)?.[1]))
  }

  const n = lat.length
  if (n < 2) throw new Error('This GPX file has no track points in it.')

  // A planned route (from a map app) has points but no times.
  const hasTime = timed >= n * 0.9
  const track = emptyTrack(n, hasTime)
  let lastT = NaN
  for (let i = 0; i < n; i++) {
    track.lat[i] = lat[i]
    track.lon[i] = lon[i]
    track.ele[i] = ele[i]
    track.hr[i] = hr[i] > 20 && hr[i] < 250 ? hr[i] : NaN
    track.speed[i] = speed[i] >= 0 ? speed[i] : NaN
    track.hAcc[i] = hAcc[i]
    if (track.time) {
      // Fill the odd missing timestamp so the columns stay aligned.
      const t = Number.isFinite(time[i]) ? time[i] : lastT
      track.time[i] = t
      lastT = t
    }
  }
  if (track.time && !Number.isFinite(track.time[0])) {
    const first = track.time.find((t) => Number.isFinite(t)) ?? NaN
    for (let i = 0; i < n && !Number.isFinite(track.time[i]); i++) track.time[i] = first
  }

  const name = /<trk>[\s\S]{0,400}?<name>\s*(?:<!\[CDATA\[)?([^<\]]+)/.exec(text)?.[1]?.trim()
  return { track, startTime: track.time ? track.time[0] : null, name }
}

function num(s: string | undefined): number {
  if (s === undefined) return NaN
  const v = Number(s)
  return Number.isFinite(v) ? v : NaN
}
