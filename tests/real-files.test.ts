import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { analyze } from '../src/lib/analyze'
import { parseGpx } from '../src/lib/parseGpx'
import { buildReadout, readoutText } from '../src/lib/readout'
import type { Ride, Settings } from '../src/lib/types'

// Dev helper: RIDE_FILES="a.gpx,b.gpx" npx vitest run tests/real-files.test.ts
const files = (process.env.RIDE_FILES ?? '').split(',').filter(Boolean)
const settings: Settings = { units: 'km', age: null, maxHr: null, trimEnds: true }

test.skipIf(files.length === 0)('prints the readout for real files', () => {
  let prev: { ride: Ride; analysis: ReturnType<typeof analyze> } | null = null
  for (const file of files) {
    const parsed = parseGpx(readFileSync(file, 'utf8'))
    const ride: Ride = { id: file, fileName: file, source: 'gpx', startTime: parsed.startTime, addedAt: 0, track: parsed.track, device: {} }
    const t0 = performance.now()
    const analysis = analyze(ride)
    const ms = performance.now() - t0
    const r = buildReadout({ ride, analysis }, prev, settings)
    console.log(`\n=== ${file.split('/').pop()} (${ride.track.n} pts, ${ms.toFixed(0)} ms, gain ${analysis.gainM.toFixed(0)} m)\n${readoutText(r)}`)
    console.log(analysis.stops.map((s) => `${(s.atM / 1000).toFixed(1)}km ${(s.durationS / 60).toFixed(1)}min`).join(' | '))
    prev = { ride, analysis }
  }
})
