/** One recorded ride, as columns. Missing values are NaN. */
export type Track = {
  n: number
  /** Epoch milliseconds per point, or null when the file has no timestamps. */
  time: Float64Array | null
  lat: Float64Array
  lon: Float64Array
  /** Metres above sea level. */
  ele: Float32Array
  /** Beats per minute. */
  hr: Float32Array
  /** Speed reported by the device, m/s. */
  speed: Float32Array
  /** Cumulative distance reported by the device, m. */
  dist: Float32Array
  /** Horizontal GPS accuracy, m. */
  hAcc: Float32Array
}

export type RideSource = 'fit' | 'gpx' | 'apple-export' | 'sample'

/** What the device itself said about the ride, when the file carries it. */
export type DeviceTotals = {
  distanceM?: number
  movingS?: number
  elapsedS?: number
  avgHr?: number
  maxHr?: number
  sport?: string
}

export type Ride = {
  id: string
  fileName: string
  source: RideSource
  /** Epoch ms of the first point, or null when the file has no timestamps. */
  startTime: number | null
  addedAt: number
  track: Track
  device: DeviceTotals
  /** The rider's own one-sentence answer to "what does this tell you?" */
  riderNote?: string
}

export type Units = 'km' | 'mi'

export type Settings = {
  units: Units
  /** Used for the AHA estimate of max heart rate (220 − age). */
  age: number | null
  /** A measured max heart rate overrides the age estimate. */
  maxHr: number | null
  /** Hide the first and last 500 m of the route drawing. */
  trimEnds: boolean
}

export function emptyTrack(n: number, withTime: boolean): Track {
  const nan32 = () => new Float32Array(n).fill(NaN)
  return {
    n,
    time: withTime ? new Float64Array(n) : null,
    lat: new Float64Array(n).fill(NaN),
    lon: new Float64Array(n).fill(NaN),
    ele: nan32(),
    hr: nan32(),
    speed: nan32(),
    dist: nan32(),
    hAcc: nan32(),
  }
}
