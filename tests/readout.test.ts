import { Encoder, Profile } from '@garmin/fitsdk'
import { describe, expect, test } from 'vitest'
import { analyze, effortBands } from '../src/lib/analyze'
import { mergeHeartRate } from '../src/lib/importRide'
import { parseFit } from '../src/lib/parseFit'
import { parseGpx } from '../src/lib/parseGpx'
import { buildReadout, sameRoute } from '../src/lib/readout'
import { sampleRides } from '../src/lib/sample'
import type { Ride, Settings } from '../src/lib/types'

const settings: Settings = { units: 'km', age: 29, maxHr: null, trimEnds: true }
const row = (r: ReturnType<typeof buildReadout>, key: string) => r.rows.find((x) => x.key === key)!

/** A straight 6 km ride north at 5 m/s, one point a second, with a 2-minute stop halfway. */
function gpx({ heart = false, times = true } = {}) {
  const start = Date.UTC(2026, 9, 14, 19, 26, 0)
  let body = ''
  let metres = 0
  for (let s = 0; s <= 1320; s++) {
    const stopped = s >= 600 && s < 720
    if (!stopped && s > 0) metres += 5
    const lat = 43.45 + metres / 111_195
    const ele = 90 + (metres > 1500 && metres < 3500 ? (metres - 1500) * 0.03 : metres >= 3500 ? 60 : 0)
    body += `<trkpt lat="${lat.toFixed(7)}" lon="-79.68"><ele>${ele.toFixed(1)}</ele>`
    if (times) body += `<time>${new Date(start + s * 1000).toISOString()}</time>`
    if (heart) body += `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${stopped ? 100 : 140}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
    body += '</trkpt>\n'
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test</name><trkseg>${body}</trkseg></trk></gpx>`
}

function rideFrom(text: string, id = 'test'): Ride {
  const parsed = parseGpx(text)
  return { id, fileName: `${id}.gpx`, source: 'gpx', startTime: parsed.startTime, addedAt: 0, track: parsed.track, device: {} }
}

describe('reading a GPX file', () => {
  test('measures distance, moving time, the stop and the climb', () => {
    const a = analyze(rideFrom(gpx()))
    expect(a.distanceM).toBeGreaterThan(5900)
    expect(a.distanceM).toBeLessThan(6050)
    expect(a.elapsedS).toBe(1320)
    expect(Math.abs(a.movingS - 1200)).toBeLessThan(15)
    expect(a.stops).toHaveLength(1)
    expect(Math.abs(a.stops[0].durationS - 120)).toBeLessThan(15)
    expect(a.climbs).toHaveLength(1)
    expect(a.climbs[0].gainM).toBeGreaterThan(50)
    expect(a.climbs[0].kind).toBe('steady')
  })

  test('says so when heart rate is missing instead of guessing', () => {
    const ride = rideFrom(gpx())
    const r = buildReadout({ ride, analysis: analyze(ride) }, null, settings)
    expect(row(r, 'effort').badge?.text).toBe('Missing data')
    expect(row(r, 'effort').text).toContain("Heart rate isn't in this file")
    expect(row(r, 'compare').text).toContain('Needs a second ride')
  })

  test('reads heart rate from a Garmin-style extension and places it in the AHA ranges', () => {
    const ride = rideFrom(gpx({ heart: true }))
    const a = analyze(ride)
    expect(a.heart).not.toBeNull()
    expect(Math.round(a.heart!.max)).toBe(140)
    const r = buildReadout({ ride, analysis: a }, null, settings)
    // 220 − 29 = 191, so 140 bpm is 73% of maximum: vigorous.
    expect(row(r, 'effort').text).toContain('Mostly vigorous')
    expect(r.summary).toContain('hard')
  })

  test('asks for an age rather than assuming one', () => {
    const ride = rideFrom(gpx({ heart: true }))
    const r = buildReadout({ ride, analysis: analyze(ride) }, null, { ...settings, age: null })
    expect(row(r, 'effort').badge?.text).toBe('Needs your age')
  })

  test('treats a file without times as a route, not a ride', () => {
    const ride = rideFrom(gpx({ times: false }))
    const a = analyze(ride)
    expect(a.hasTime).toBe(false)
    const r = buildReadout({ ride, analysis: a }, null, settings)
    expect(r.summary).toContain('no times')
    expect(row(r, 'stops').text).toContain('No times')
  })

  test('rejects something that is not GPX', () => {
    expect(() => parseGpx('hello')).toThrow()
  })
})

describe('effort ranges', () => {
  test('follow the AHA cut-offs: 50%, 70% and 85% of maximum', () => {
    const hist = new Float32Array(256)
    hist[90] = 60
    hist[120] = 600
    hist[150] = 300
    hist[180] = 30
    const e = effortBands(hist, 200)
    expect(e.bands.map((b) => b.seconds)).toEqual([60, 600, 300, 30])
    expect(e.bands[1].fromBpm).toBe(100)
    expect(e.bands[2].fromBpm).toBe(140)
    expect(e.bands[3].fromBpm).toBe(170)
    expect(e.dominant).toBe('moderate')
  })
})

describe('thin heart-rate data from an Apple export', () => {
  test('is reported as thin, not as minute-by-minute effort', () => {
    const ride = rideFrom(gpx())
    const start = ride.startTime!
    // One reading every five minutes, the way Apple's export.xml often has it.
    const times = Float64Array.from([0, 300, 600, 900, 1200], (s) => start + s * 1000)
    mergeHeartRate(ride.track, times, Uint8Array.from([110, 135, 120, 150, 140]))
    const a = analyze(ride)
    expect(a.heart).toBeNull()
    expect(a.heartThin?.readings).toBe(5)
    const r = buildReadout({ ride, analysis: a }, null, settings)
    expect(row(r, 'effort').badge?.text).toBe('Thin data')
  })
})

describe('the sample rides', () => {
  const [first, second] = sampleRides()
  const a1 = analyze(first)
  const a2 = analyze(second)

  test('cover the same loop, so they compare like for like', () => {
    expect(Math.abs(a1.distanceM - 24_300)).toBeLessThan(500)
    expect(sameRoute(a1, a2)).toBe(true)
    const r = buildReadout({ ride: second, analysis: a2 }, { ride: first, analysis: a1 }, settings)
    expect(row(r, 'compare').text).toContain('Same route')
    expect(row(r, 'compare').text).toContain('you improved')
  })

  test('flag the planted GPS glitch instead of counting it as distance', () => {
    expect(a2.issues.some((i) => i.kind === 'gps-jumps')).toBe(true)
    expect(a1.issues).toHaveLength(0)
  })
})

describe('reading a .FIT file', () => {
  test('round-trips records and session totals through the Garmin SDK', () => {
    const encoder = new Encoder()
    encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: new Date() })
    const start = Date.UTC(2026, 9, 14, 19, 26, 0)
    const semi = (deg: number) => Math.round(deg * (2 ** 31 / 180))
    for (let s = 0; s < 900; s++) {
      encoder.onMesg(Profile.MesgNum.RECORD, {
        timestamp: new Date(start + s * 1000),
        positionLat: semi(43.45 + (s * 6) / 111_195),
        positionLong: semi(-79.68),
        altitude: 100,
        heartRate: 128,
        speed: 6,
        distance: s * 6,
      })
    }
    encoder.onMesg(Profile.MesgNum.SESSION, {
      timestamp: new Date(start + 900_000),
      startTime: new Date(start),
      sport: 'cycling',
      totalElapsedTime: 900,
      totalTimerTime: 900,
      totalDistance: 5400,
    })
    const bytes = encoder.close()
    const parsed = parseFit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(parsed.track.n).toBe(900)
    expect(parsed.device.sport).toBe('cycling')
    expect(parsed.device.distanceM).toBe(5400)
    const ride: Ride = { id: 'fit', fileName: 'a.fit', source: 'fit', startTime: parsed.startTime, addedAt: 0, track: parsed.track, device: parsed.device }
    const a = analyze(ride)
    expect(Math.abs(a.distanceM - 5394)).toBeLessThan(30)
    expect(Math.round(a.heart!.avg)).toBe(128)
    expect(a.issues).toHaveLength(0)
  })

  test('rejects a file that is not FIT', () => {
    expect(() => parseFit(new TextEncoder().encode('not a fit file at all').buffer as ArrayBuffer)).toThrow()
  })
})
