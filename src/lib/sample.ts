import { makeRide } from './importRide'
import { emptyTrack, type Ride } from './types'

/**
 * Two made-up rides on the same made-up loop, so anyone without a ride file
 * can see a full readout, including heart rate and "vs last ride".
 * Nothing here is a real place or a real person's data.
 */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LOOP_M = 24_300
const ORIGIN = { lat: 0.5, lon: 0.5 } // open sea: clearly not anyone's home

/** Height along the loop: two hills and a little ripple. u runs 0 to 1. */
function heightAt(u: number): number {
  const bump = (centre: number, width: number, high: number) => high * Math.exp(-(((u - centre) / width) ** 2))
  return 82 + bump(0.31, 0.085, 64) + bump(0.71, 0.06, 104) + 3 * Math.sin(u * 46) + 2 * Math.sin(u * 17 + 1)
}

/** The loop's outline in metres, sampled finely, with running length. */
function buildOutline() {
  const steps = 4000
  const xs = new Float64Array(steps + 1)
  const ys = new Float64Array(steps + 1)
  const len = new Float64Array(steps + 1)
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2
    const r = 1 + 0.22 * Math.sin(3 * th + 0.4) + 0.1 * Math.cos(5 * th)
    xs[i] = r * Math.cos(th)
    ys[i] = r * Math.sin(th) * 0.8
    if (i > 0) len[i] = len[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
  }
  const scale = LOOP_M / len[steps]
  return { xs, ys, len, scale, steps }
}

type Recipe = {
  seed: number
  startTime: number
  cruiseMs: number
  /** How many beats the heart adds per unit of effort: lower is fitter. */
  heartCost: number
  stops: { atM: number; seconds: number }[]
  glitchAtM?: number
  fileName: string
}

function simulate(recipe: Recipe): Ride {
  const rand = mulberry32(recipe.seed)
  const outline = buildOutline()
  const lat: number[] = []
  const lon: number[] = []
  const ele: number[] = []
  const hr: number[] = []
  const spd: number[] = []
  const time: number[] = []

  let dist = 0
  let v = 0
  let heart = 96
  let t = 0
  let wobble = 0
  let cursor = 0
  const stops = recipe.stops.map((s) => ({ ...s, left: s.seconds }))
  let glitched = false

  while (dist < LOOP_M && t < 4 * 3600) {
    const u = dist / LOOP_M
    const grade = (heightAt(Math.min(1, u + 30 / LOOP_M)) - heightAt(u)) / 30
    const next = stops.find((s) => s.left > 0)
    const toStop = next ? next.atM - dist : Infinity

    wobble = wobble * 0.97 + (rand() - 0.5) * 0.12
    let target = recipe.cruiseMs * Math.max(0.36, Math.min(1.85, 1 - 8.5 * grade)) * (1 + wobble)
    if (toStop < 45) target = Math.min(target, Math.max(0, toStop) * 0.22)
    if (next && toStop <= 0.6) {
      target = 0
      next.left -= 1
    }
    v += Math.max(-1.6, Math.min(0.55, target - v))
    if (v < 0.05) v = 0
    dist += v
    t += 1

    // Effort: lifting the rider up the hill, pushing air, rolling.
    const power = Math.max(0, v * (grade * 9.81 * 84 + 0.32 * v * v + 5))
    const wanted = Math.min(186, 88 + power * recipe.heartCost)
    heart += (wanted - heart) / 28 + (rand() - 0.5) * 0.9

    while (cursor < outline.steps && outline.len[cursor + 1] * outline.scale < dist) cursor++
    const a = outline.len[cursor] * outline.scale
    const b = outline.len[Math.min(outline.steps, cursor + 1)] * outline.scale
    const k = b > a ? Math.min(1, (dist - a) / (b - a)) : 0
    const c2 = Math.min(outline.steps, cursor + 1)
    const radius = outline.scale // the same scale the running length uses, so the track is exactly as long as the ride
    let x = (outline.xs[cursor] + (outline.xs[c2] - outline.xs[cursor]) * k) * radius + (rand() - 0.5) * 1.6
    let y = (outline.ys[cursor] + (outline.ys[c2] - outline.ys[cursor]) * k) * radius + (rand() - 0.5) * 1.6
    if (recipe.glitchAtM && !glitched && dist >= recipe.glitchAtM) {
      // One bad GPS fix, the kind riders told us about.
      x += 380
      y -= 260
      glitched = true
    }
    lat.push(ORIGIN.lat + y / 110_574)
    lon.push(ORIGIN.lon + x / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180)))
    ele.push(heightAt(Math.min(1, dist / LOOP_M)) + (rand() - 0.5) * 0.4)
    hr.push(Math.round(heart))
    spd.push(v)
    time.push(recipe.startTime + t * 1000)
  }

  const n = lat.length
  const track = emptyTrack(n, true)
  for (let i = 0; i < n; i++) {
    track.time![i] = time[i]
    track.lat[i] = lat[i]
    track.lon[i] = lon[i]
    track.ele[i] = ele[i]
    track.hr[i] = hr[i]
    track.speed[i] = spd[i]
    track.hAcc[i] = 3
  }
  const ride = makeRide('sample', recipe.fileName, track, recipe.startTime, { sport: 'cycling' })
  ride.id = `sample-${recipe.seed}`
  return ride
}

export function sampleRides(): Ride[] {
  const day = 24 * 3600 * 1000
  const evening = new Date()
  evening.setHours(17, 40, 0, 0)
  const base = evening.getTime()
  return [
    simulate({
      seed: 11,
      fileName: 'Sample ride 1 (made-up data)',
      startTime: base - 9 * day,
      cruiseMs: 5.9,
      heartCost: 0.31,
      stops: [
        { atM: 5_200, seconds: 42 },
        { atM: 17_420, seconds: 235 },
        { atM: 20_900, seconds: 38 },
      ],
    }),
    simulate({
      seed: 23,
      fileName: 'Sample ride 2 (made-up data)',
      startTime: base - 2 * day,
      cruiseMs: 6.25,
      heartCost: 0.285,
      stops: [
        { atM: 5_200, seconds: 55 },
        { atM: 17_420, seconds: 190 },
      ],
      glitchAtM: 12_600,
    }),
  ]
}
