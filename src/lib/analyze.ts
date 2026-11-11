import type { Ride } from './types'

/**
 * Turns a recorded track into the facts the readout talks about.
 * Everything here is measured from the file; nothing is judged.
 * All values are SI (metres, seconds, m/s); wording and units live in readout.ts.
 */

// ---- Rules, in one place so the team can argue with them -------------------
/** Below this smoothed speed the rider counts as stopped (3.6 km/h). */
const MOVING_MS = 1.0
/** Time in one place before it counts as a stop worth naming; shorter pauses (lights, junctions) are only totalled. */
export const MIN_STOP_S = 90
/** Pauses closer together than this are the same stop. */
const SAME_STOP_M = 150
/** GPS steps faster than this are treated as jumps, not riding (100 km/h). */
const JUMP_MS = 28
/** Elevation is averaged over this distance either side of a point. */
const ELE_WINDOW_M = 60
/** A rise must be at least this high and this long to be called a climb. */
const MIN_CLIMB_GAIN_M = 15
const MIN_CLIMB_LENGTH_M = 300
const MIN_CLIMB_GRADE = 0.005

export type Stop = {
  startIdx: number
  endIdx: number
  atM: number
  durationS: number
  eleM: number
}

export type ClimbKind = 'gentle' | 'steady' | 'steep'

export type Climb = {
  startIdx: number
  endIdx: number
  startM: number
  endM: number
  gainM: number
  gradePct: number
  kind: ClimbKind
  speedMs: number
}

export type Issue =
  | { kind: 'no-time' }
  | { kind: 'gps-jumps'; count: number; meters: number }
  | { kind: 'drift'; meters: number }
  | { kind: 'distance-mismatch'; deviceM: number; trackM: number }
  | { kind: 'low-accuracy'; share: number }
  | { kind: 'left-running'; stopS: number; elapsedS: number }
  | { kind: 'hr-gaps'; coverage: number }
  | { kind: 'too-short' }
  | { kind: 'not-cycling'; sport: string }

export type Analysis = {
  n: number
  hasTime: boolean
  hasGps: boolean
  hasEle: boolean
  hasHr: boolean
  distanceM: number
  elapsedS: number
  movingS: number
  avgMovingMs: number
  /** Per point: seconds from start, metres from start, smoothed speed, smoothed elevation. */
  t: Float64Array
  d: Float32Array
  v: Float32Array
  ele: Float32Array
  hr: Float32Array
  moving: Uint8Array
  stops: Stop[]
  /** Seconds in the named stops, and in the shorter pauses that didn't make the list. */
  stoppedS: number
  shortPausesS: number
  gainM: number
  minEle: number
  maxEle: number
  climbs: Climb[]
  fastest: { idx: number; ms: number; atM: number; slope: 'down' | 'flat' | 'up' | 'unknown' } | null
  heart: {
    avg: number
    max: number
    coverage: number
    /** Seconds spent at each whole bpm, 0 to 255. */
    hist: Float32Array
    hardest: { startIdx: number; endIdx: number; startM: number; endM: number; avg: number; climb: number | null } | null
  } | null
  /** Heart rate that came as a handful of scattered readings: enough for an average, no more. */
  heartThin: { readings: number; avg: number; max: number; everyS: number } | null
  issues: Issue[]
  start: [number, number] | null
  end: [number, number] | null
}

export function analyze(ride: Ride): Analysis {
  const tr = ride.track
  const n = tr.n
  const hasTime = tr.time !== null
  const issues: Issue[] = []

  // ---- time ---------------------------------------------------------------
  const t = new Float64Array(n)
  if (tr.time) {
    for (let i = 1; i < n; i++) {
      const s = (tr.time[i] - tr.time[0]) / 1000
      t[i] = Number.isFinite(s) && s > t[i - 1] ? s : t[i - 1]
    }
  } else {
    issues.push({ kind: 'no-time' })
  }

  // ---- distance steps -----------------------------------------------------
  let gpsCount = 0
  let distCount = 0
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(tr.lat[i]) && Number.isFinite(tr.lon[i])) gpsCount++
    if (Number.isFinite(tr.dist[i])) distCount++
  }
  const hasGps = gpsCount >= n * 0.5
  const mode: 'gps' | 'dist' | 'speed' = hasGps ? 'gps' : distCount >= n * 0.5 ? 'dist' : 'speed'

  const ds = new Float32Array(n)
  const dt = new Float32Array(n)
  const raw = new Float32Array(n)
  let jumps = 0
  let jumpM = 0
  let lastGps = -1
  let lastDist = NaN
  let start: [number, number] | null = null
  let end: [number, number] | null = null

  for (let i = 0; i < n; i++) {
    const gpsOk = Number.isFinite(tr.lat[i]) && Number.isFinite(tr.lon[i])
    if (gpsOk) {
      if (!start) start = [tr.lat[i], tr.lon[i]]
      end = [tr.lat[i], tr.lon[i]]
    }
    if (i > 0) dt[i] = t[i] - t[i - 1]
    const devSpeed = tr.speed[i]
    let step = 0
    if (mode === 'gps') {
      if (gpsOk) {
        if (lastGps >= 0) {
          step = haversine(tr.lat[lastGps], tr.lon[lastGps], tr.lat[i], tr.lon[i])
          const span = t[i] - t[lastGps]
          if (hasTime && span > 0 && span <= 30 && step / span > JUMP_MS) {
            jumps++
            jumpM += step
            step = Number.isFinite(devSpeed) ? Math.min(devSpeed, JUMP_MS) * span : 0
          }
        }
        lastGps = i
      }
    } else if (mode === 'dist') {
      const dv = tr.dist[i]
      if (Number.isFinite(dv)) {
        if (Number.isFinite(lastDist)) step = Math.max(0, dv - lastDist)
        lastDist = dv
      }
    } else if (Number.isFinite(devSpeed) && dt[i] > 0 && dt[i] <= 10) {
      step = devSpeed * dt[i]
    }
    ds[i] = step
    if (i > 0) {
      if (dt[i] > 0) raw[i] = Number.isFinite(devSpeed) && dt[i] <= 10 ? devSpeed : step / dt[i]
      else raw[i] = raw[i - 1]
    }
  }
  if (jumps > 0) issues.push({ kind: 'gps-jumps', count: jumps, meters: jumpM })

  // ---- smoothed speed, moving or stopped ----------------------------------
  const v = new Float32Array(n)
  const moving = new Uint8Array(n)
  if (hasTime) {
    const travelled = new Float64Array(n)
    for (let i = 1; i < n; i++) travelled[i] = travelled[i - 1] + raw[i] * dt[i]
    let lo = 0
    let hi = 0
    for (let i = 0; i < n; i++) {
      while (lo + 1 < n && t[lo + 1] <= t[i] - 3) lo++
      if (hi < i) hi = i
      while (hi + 1 < n && t[hi] < t[i] + 3) hi++
      const span = t[hi] - t[lo]
      v[i] = span > 0 ? (travelled[hi] - travelled[lo]) / span : raw[i]
    }
    for (let i = 1; i < n; i++) moving[i] = v[i] >= MOVING_MS ? 1 : 0
    // A stop under 5 s is noise; so is 5 s of "movement" inside a stop.
    flipShortRuns(moving, dt, 0, 5)
    flipShortRuns(moving, dt, 1, 5)
    moving[0] = n > 1 ? moving[1] : 0
  } else {
    moving.fill(1)
  }

  // ---- distance, moving time, stops ---------------------------------------
  const d = new Float32Array(n)
  let dist = 0
  let drift = 0
  let movingS = 0
  for (let i = 1; i < n; i++) {
    if (moving[i]) {
      dist += ds[i]
      movingS += dt[i]
    } else {
      drift += ds[i]
    }
    d[i] = dist
  }
  const distanceM = dist
  const elapsedS = hasTime ? t[n - 1] : 0
  if (drift > Math.max(300, distanceM * 0.03)) issues.push({ kind: 'drift', meters: drift })

  // ---- elevation ----------------------------------------------------------
  const ele = new Float32Array(n)
  let eleCount = 0
  for (let i = 0; i < n; i++) if (Number.isFinite(tr.ele[i])) eleCount++
  const hasEle = eleCount >= n * 0.5
  let minEle = 0
  let maxEle = 0
  let gainM = 0
  if (hasEle) {
    const filled = new Float64Array(n)
    let last = NaN
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(tr.ele[i])) last = tr.ele[i]
      filled[i] = last
    }
    for (let i = n - 1; i >= 0; i--) {
      if (Number.isFinite(filled[i])) last = filled[i]
      else filled[i] = last
    }
    const prefix = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + filled[i]
    let lo = 0
    let hi = 0
    for (let i = 0; i < n; i++) {
      while (d[lo] < d[i] - ELE_WINDOW_M) lo++
      if (hi < i) hi = i
      while (hi + 1 < n && d[hi + 1] <= d[i] + ELE_WINDOW_M) hi++
      ele[i] = (prefix[hi + 1] - prefix[lo]) / (hi + 1 - lo)
    }
    minEle = Infinity
    maxEle = -Infinity
    let ref = ele[0]
    for (let i = 0; i < n; i++) {
      if (ele[i] < minEle) minEle = ele[i]
      if (ele[i] > maxEle) maxEle = ele[i]
      if (ele[i] - ref >= 2) {
        gainM += ele[i] - ref
        ref = ele[i]
      } else if (ele[i] < ref) {
        ref = ele[i]
      }
    }
  }

  const stops: Stop[] = []
  if (hasTime) {
    // Shuffling around a cafe or a viewpoint is one stop, not five.
    let open: Stop | null = null
    const close = () => {
      if (open && open.durationS >= MIN_STOP_S) stops.push(open)
      open = null
    }
    for (const run of runsOf(moving, dt, 0)) {
      const startIdx = Math.max(0, run.from - 1)
      if (open && d[startIdx] - d[open.endIdx] <= SAME_STOP_M) {
        open.endIdx = run.to
        open.durationS += run.seconds
      } else {
        close()
        open = { startIdx, endIdx: run.to, atM: d[startIdx], durationS: run.seconds, eleM: ele[startIdx] }
      }
    }
    close()
  }
  const stoppedS = stops.reduce((sum, s) => sum + s.durationS, 0)
  const shortPausesS = Math.max(0, elapsedS - movingS - stoppedS)

  const climbs = hasEle ? findClimbs(ele, d, dt, moving, minEle, maxEle) : []

  // ---- fastest ------------------------------------------------------------
  let fastest: Analysis['fastest'] = null
  if (hasTime && movingS > 0) {
    let best = -1
    for (let i = 1; i < n; i++) if (moving[i] && (best < 0 || v[i] > v[best])) best = i
    if (best >= 0) {
      let slope: 'down' | 'flat' | 'up' | 'unknown' = 'unknown'
      if (hasEle) {
        let a = best
        let b = best
        while (a > 0 && d[best] - d[a] < 150) a--
        while (b < n - 1 && d[b] - d[best] < 150) b++
        const run = d[b] - d[a]
        const grade = run > 0 ? (ele[b] - ele[a]) / run : 0
        slope = grade < -0.012 ? 'down' : grade > 0.012 ? 'up' : 'flat'
      }
      fastest = { idx: best, ms: v[best], atM: d[best], slope }
    }
  }

  // ---- heart rate ---------------------------------------------------------
  let heart: Analysis['heart'] = null
  let heartThin: Analysis['heartThin'] = null
  if (hasTime) {
    const hist = new Float32Array(256)
    const hrDt = new Float64Array(n + 1) // prefix: seconds with a heart-rate reading
    const hrSum = new Float64Array(n + 1) // prefix: bpm × seconds
    let recorded = 0
    for (let i = 1; i < n; i++) {
      const ok = dt[i] > 0 && dt[i] <= 30
      const bpm = tr.hr[i]
      const has = ok && Number.isFinite(bpm)
      if (ok) recorded += dt[i]
      if (has) hist[Math.max(0, Math.min(255, Math.round(bpm)))] += dt[i]
      hrDt[i + 1] = hrDt[i] + (has ? dt[i] : 0)
      hrSum[i + 1] = hrSum[i] + (has ? bpm * dt[i] : 0)
    }
    const hrTime = hrDt[n]
    const coverage = recorded > 0 ? hrTime / recorded : 0
    if (hrTime >= 60 && coverage >= 0.2) {
      const avg = hrSum[n] / hrTime
      // Peak = the highest rate held for at least 3 seconds, so one stray reading doesn't count.
      let max = 0
      let acc = 0
      for (let b = 255; b >= 0; b--) {
        acc += hist[b]
        if (acc >= 3) {
          max = b
          break
        }
      }
      // The hardest stretch: the window (about 8% of the ride) with the highest average.
      const win = Math.max(120, Math.min(600, elapsedS * 0.08))
      let hardest: NonNullable<Analysis['heart']>['hardest'] = null
      let bestAvg = 0
      let b = 0
      for (let a = 0; a < n; a++) {
        if (b < a) b = a
        while (b < n - 1 && t[b] - t[a] < win) b++
        const span = t[b] - t[a]
        if (span < win) break
        const covered = hrDt[b + 1] - hrDt[a + 1]
        if (span <= win * 1.5 && covered >= win * 0.8) {
          const mean = (hrSum[b + 1] - hrSum[a + 1]) / covered
          if (mean > bestAvg) {
            bestAvg = mean
            hardest = { startIdx: a, endIdx: b, startM: d[a], endM: d[b], avg: mean, climb: null }
          }
        }
      }
      if (hardest && hardest.avg >= avg + 5) {
        const mid = (hardest.startM + hardest.endM) / 2
        const idx = climbs.findIndex((c) => mid >= c.startM && mid <= c.endM)
        hardest.climb = idx >= 0 ? idx : null
      } else {
        hardest = null
      }
      heart = { avg, max, coverage, hist, hardest }
      if (coverage < 0.9) issues.push({ kind: 'hr-gaps', coverage })
    } else if (hrTime > 0) {
      // Apple's export often keeps only a reading every few minutes. Count the separate readings.
      let readings = 0
      let sum = 0
      let top = 0
      let inRun = false
      for (let i = 0; i < n; i++) {
        const bpm = tr.hr[i]
        if (Number.isFinite(bpm)) {
          if (!inRun) {
            readings++
            sum += bpm
            if (bpm > top) top = bpm
          }
          inRun = true
        } else {
          inRun = false
        }
      }
      if (readings >= 3) heartThin = { readings, avg: sum / readings, max: top, everyS: elapsedS / readings }
    }
  }

  // ---- things that look wrong ---------------------------------------------
  const deviceM = ride.device.distanceM
  if (deviceM && deviceM > 0 && distanceM > 0) {
    const gap = Math.abs(deviceM - distanceM)
    if (gap > 200 && gap / deviceM > 0.05) issues.push({ kind: 'distance-mismatch', deviceM, trackM: distanceM })
  }
  let accCount = 0
  let accBad = 0
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(tr.hAcc[i])) {
      accCount++
      if (tr.hAcc[i] > 25) accBad++
    }
  }
  if (accCount > 0 && accBad / accCount >= 0.1) issues.push({ kind: 'low-accuracy', share: accBad / accCount })
  const longest = stops.reduce((m, s) => Math.max(m, s.durationS), 0)
  if (longest >= 3600 && longest >= elapsedS * 0.5) {
    issues.push({ kind: 'left-running', stopS: longest, elapsedS })
  }
  if (distanceM < 1000 || (hasTime && movingS < 300)) issues.push({ kind: 'too-short' })
  const sport = ride.device.sport
  if (sport && !/cycl|bik|generic/i.test(sport)) issues.push({ kind: 'not-cycling', sport })

  return {
    n,
    hasTime,
    hasGps,
    hasEle,
    hasHr: heart !== null,
    distanceM,
    elapsedS,
    movingS,
    avgMovingMs: movingS > 0 ? distanceM / movingS : 0,
    t,
    d,
    v,
    ele,
    hr: tr.hr,
    moving,
    stops,
    stoppedS,
    shortPausesS,
    gainM,
    minEle,
    maxEle,
    climbs,
    fastest,
    heart,
    heartThin,
    issues,
    start,
    end,
  }
}

// ---- effort, against the AHA ranges ---------------------------------------

export type BandKey = 'light' | 'moderate' | 'vigorous' | 'above'

export type Effort = {
  maxHr: number
  bands: { key: BandKey; label: string; fromBpm: number; toBpm: number | null; seconds: number; share: number }[]
  totalS: number
  dominant: BandKey
  second: BandKey | null
}

/**
 * American Heart Association target heart rate ranges:
 * moderate is about 50–70% of maximum heart rate, vigorous about 70–85%.
 */
export const AHA = { moderate: 0.5, vigorous: 0.7, top: 0.85 }

export function effortBands(hist: Float32Array, maxHr: number): Effort {
  const cut = [Math.round(maxHr * AHA.moderate), Math.round(maxHr * AHA.vigorous), Math.round(maxHr * AHA.top)]
  const seconds = [0, 0, 0, 0]
  for (let b = 0; b < hist.length; b++) {
    if (!hist[b]) continue
    seconds[b < cut[0] ? 0 : b < cut[1] ? 1 : b < cut[2] ? 2 : 3] += hist[b]
  }
  const totalS = seconds[0] + seconds[1] + seconds[2] + seconds[3]
  const keys: BandKey[] = ['light', 'moderate', 'vigorous', 'above']
  const labels = ['Light', 'Moderate', 'Vigorous', 'Above vigorous']
  const bands = keys.map((key, i) => ({
    key,
    label: labels[i],
    fromBpm: i === 0 ? 0 : cut[i - 1],
    toBpm: i === 3 ? null : cut[i],
    seconds: seconds[i],
    share: totalS > 0 ? seconds[i] / totalS : 0,
  }))
  const ranked = [...bands].sort((a, b) => b.seconds - a.seconds)
  return {
    maxHr,
    bands,
    totalS,
    dominant: ranked[0].key,
    second: ranked[1].share >= 0.25 ? ranked[1].key : null,
  }
}

// ---- helpers --------------------------------------------------------------

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

type Run = { from: number; to: number; seconds: number }

/** Runs of intervals (index 1..n-1) whose flag equals `value`. */
function runsOf(flags: Uint8Array, dt: Float32Array, value: 0 | 1): Run[] {
  const runs: Run[] = []
  let from = -1
  let seconds = 0
  for (let i = 1; i <= flags.length; i++) {
    const match = i < flags.length && flags[i] === value
    if (match) {
      if (from < 0) {
        from = i
        seconds = 0
      }
      seconds += dt[i]
    } else if (from >= 0) {
      runs.push({ from, to: i - 1, seconds })
      from = -1
    }
  }
  return runs
}

function flipShortRuns(flags: Uint8Array, dt: Float32Array, value: 0 | 1, minSeconds: number) {
  for (const run of runsOf(flags, dt, value)) {
    const inside = run.from > 1 && run.to < flags.length - 1
    if (inside && run.seconds < minSeconds) {
      for (let i = run.from; i <= run.to; i++) flags[i] = value ? 0 : 1
    }
  }
}

/**
 * Climbs are the big "up" legs of the elevation profile. The threshold scales
 * with the ride, so a 10 m bump counts on a flat commute and is ignored in the mountains.
 */
function findClimbs(
  ele: Float32Array,
  d: Float32Array,
  dt: Float32Array,
  moving: Uint8Array,
  minEle: number,
  maxEle: number,
): Climb[] {
  const n = ele.length
  const swing = Math.max(8, Math.min(40, (maxEle - minEle) * 0.12))
  const legs: [number, number][] = []
  let trend: 'up' | 'down' | null = null
  let lowIdx = 0
  let highIdx = 0
  let ext = 0
  for (let i = 1; i < n; i++) {
    if (trend === null) {
      if (ele[i] < ele[lowIdx]) lowIdx = i
      if (ele[i] > ele[highIdx]) highIdx = i
      if (ele[i] - ele[lowIdx] >= swing) {
        trend = 'up'
        ext = i
      } else if (ele[highIdx] - ele[i] >= swing) {
        trend = 'down'
        ext = i
      }
    } else if (trend === 'up') {
      if (ele[i] > ele[ext]) ext = i
      else if (ele[ext] - ele[i] >= swing) {
        legs.push([lowIdx, ext])
        trend = 'down'
        ext = i
      }
    } else {
      if (ele[i] < ele[ext]) ext = i
      else if (ele[i] - ele[ext] >= swing) {
        lowIdx = ext
        trend = 'up'
        ext = i
      }
    }
  }
  if (trend === 'up') legs.push([lowIdx, ext])

  const climbs: Climb[] = []
  for (const [low, high] of legs) {
    const rise = ele[high] - ele[low]
    // Trim the flat run-in and run-out so "km 4 to 14" means where it actually went up.
    let s = low
    for (let i = low; i <= high; i++) if (ele[i] <= ele[low] + rise * 0.05) s = i
    let e = high
    for (let i = s; i <= high; i++) {
      if (ele[i] >= ele[high] - rise * 0.05) {
        e = i
        break
      }
    }
    const gainM = ele[e] - ele[s]
    const length = d[e] - d[s]
    if (length < MIN_CLIMB_LENGTH_M || gainM < Math.max(MIN_CLIMB_GAIN_M, swing)) continue
    const grade = gainM / length
    if (grade < MIN_CLIMB_GRADE) continue
    let seconds = 0
    for (let i = s + 1; i <= e; i++) if (moving[i]) seconds += dt[i]
    climbs.push({
      startIdx: s,
      endIdx: e,
      startM: d[s],
      endM: d[e],
      gainM,
      gradePct: grade * 100,
      kind: grade < 0.02 ? 'gentle' : grade < 0.05 ? 'steady' : 'steep',
      speedMs: seconds > 0 ? length / seconds : 0,
    })
  }
  // Name at most the four biggest, in the order they were ridden, and skip
  // bumps that are small next to the main climb of the day.
  const biggest = climbs.reduce((m, c) => Math.max(m, c.gainM), 0)
  return climbs
    .filter((c) => c.gainM >= biggest * 0.3)
    .sort((a, b) => b.gainM - a.gainM)
    .slice(0, 4)
    .sort((a, b) => a.startM - b.startM)
}
