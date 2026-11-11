import { parseGpx } from './parseGpx'
import type { DeviceTotals, Ride, RideSource, Track } from './types'

export function makeRide(
  source: RideSource,
  fileName: string,
  track: Track,
  startTime: number | null,
  device: DeviceTotals = {},
): Ride {
  // The same ride added twice lands on the same id, so it replaces itself instead of doubling up.
  const id = `${source === 'apple-export' ? 'gpx' : source}-${startTime ?? fileName}-${track.n}`
  return { id, fileName, source, startTime, addedAt: Date.now(), track, device }
}

/** Reads one dropped file into a ride. Throws a sentence a rider can act on. */
export async function readRideFile(file: File): Promise<Ride> {
  const name = file.name
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const looksFit = head.length >= 12 && String.fromCharCode(head[8], head[9], head[10], head[11]) === '.FIT'

  if (ext === 'fit' || looksFit) {
    // Garmin's FIT profile is large, so it is only downloaded when a .FIT file actually arrives.
    const { parseFit } = await import('./parseFit')
    const parsed = parseFit(await file.arrayBuffer())
    return makeRide('fit', name, parsed.track, parsed.startTime, parsed.device)
  }
  if (ext === 'gpx' || head[0] === 0x3c /* < */ || head[0] === 0xef /* BOM */) {
    if (ext === 'tcx') throw new Error(`${name}: TCX files aren't supported yet. Export the ride as .FIT or .GPX instead.`)
    const parsed = parseGpx(await file.text())
    return makeRide('gpx', name, parsed.track, parsed.startTime)
  }
  throw new Error(`${name}: I can read .FIT and .GPX files, and Apple Health's export.zip.`)
}

/**
 * Lays heart-rate samples (from Apple's export.xml) onto a GPS track.
 * A sample only speaks for the moments near it: gaps over a minute stay empty.
 */
export function mergeHeartRate(track: Track, times: Float64Array, bpm: Uint8Array | Float32Array) {
  if (!track.time || times.length === 0) return
  let j = 0
  for (let i = 0; i < track.n; i++) {
    const t = track.time[i]
    while (j + 1 < times.length && times[j + 1] <= t) j++
    const before = times[j] <= t ? j : -1
    const after = before === -1 ? 0 : j + 1 < times.length ? j + 1 : -1
    const gapBefore = before >= 0 ? t - times[before] : Infinity
    const gapAfter = after >= 0 ? times[after] - t : Infinity
    if (before >= 0 && after >= 0 && gapBefore + gapAfter <= 60_000) {
      const span = gapBefore + gapAfter
      track.hr[i] = span === 0 ? bpm[before] : bpm[before] + ((bpm[after] - bpm[before]) * gapBefore) / span
    } else if (gapBefore <= 15_000) {
      track.hr[i] = bpm[before]
    } else if (gapAfter <= 15_000) {
      track.hr[i] = bpm[after]
    }
  }
}
