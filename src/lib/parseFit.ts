import { Decoder, Stream } from '@garmin/fitsdk'
import type { ParsedFile } from './parseGpx'
import { emptyTrack, type DeviceTotals } from './types'

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31

type FitRecord = {
  timestamp?: Date | number
  positionLat?: number
  positionLong?: number
  altitude?: number
  enhancedAltitude?: number
  heartRate?: number
  speed?: number
  enhancedSpeed?: number
  distance?: number
}

type FitSession = {
  sport?: string
  totalDistance?: number
  totalTimerTime?: number
  totalElapsedTime?: number
  avgHeartRate?: number
  maxHeartRate?: number
}

/** Reads a .FIT activity (HealthFit, Garmin, Wahoo, …) with Garmin's own SDK. */
export function parseFit(buffer: ArrayBuffer): ParsedFile & { device: DeviceTotals } {
  const stream = Stream.fromArrayBuffer(buffer)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT()) throw new Error("This doesn't look like a .FIT file.")

  const { messages } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: false,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  })

  const all = ((messages as Record<string, unknown>).recordMesgs ?? []) as FitRecord[]
  const records = all.filter((r) => r.timestamp !== undefined)
  if (records.length < 2) {
    throw new Error('This .FIT file has no ride recorded in it (it may be a course or a settings file).')
  }

  const n = records.length
  const track = emptyTrack(n, true)
  for (let i = 0; i < n; i++) {
    const r = records[i]
    track.time![i] = r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp)
    if (isNum(r.positionLat) && isNum(r.positionLong)) {
      track.lat[i] = r.positionLat * SEMICIRCLE_TO_DEG
      track.lon[i] = r.positionLong * SEMICIRCLE_TO_DEG
    }
    const alt = r.enhancedAltitude ?? r.altitude
    if (isNum(alt)) track.ele[i] = alt
    if (isNum(r.heartRate) && r.heartRate > 20 && r.heartRate < 250) track.hr[i] = r.heartRate
    const spd = r.enhancedSpeed ?? r.speed
    if (isNum(spd) && spd >= 0) track.speed[i] = spd
    if (isNum(r.distance)) track.dist[i] = r.distance
  }

  const sessions = ((messages as Record<string, unknown>).sessionMesgs ?? []) as FitSession[]
  const device: DeviceTotals = {}
  if (sessions.length) {
    const sum = (key: 'totalDistance' | 'totalTimerTime' | 'totalElapsedTime') => {
      let total = 0
      let seen = false
      for (const s of sessions) {
        const v = s[key]
        if (isNum(v)) {
          total += v
          seen = true
        }
      }
      return seen ? total : undefined
    }
    device.distanceM = sum('totalDistance')
    device.movingS = sum('totalTimerTime')
    device.elapsedS = sum('totalElapsedTime')
    const s = sessions[0]
    if (isNum(s.avgHeartRate)) device.avgHr = s.avgHeartRate
    if (isNum(s.maxHeartRate)) device.maxHr = s.maxHeartRate
    if (typeof s.sport === 'string') device.sport = s.sport
  }

  return { track, startTime: track.time![0], device }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
