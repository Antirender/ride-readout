import { BlobReader, TextWriter, ZipReader, configure, type FileEntry } from '@zip.js/zip.js'

/**
 * Reads Apple Health's export.zip inside the browser without loading it whole.
 * The zip's index tells us where each file sits, so we pull out single route
 * files on demand, and stream export.xml past once to collect the list of
 * workouts and the heart-rate samples. The file never leaves this device.
 */

configure({ useWebWorkers: false })

export type AppleWorkout = {
  id: number
  type: string
  start: number
  end: number
  distanceM: number | null
  routeName: string | null
}

export type AppleRoute = { name: string; bytes: number }

export type ToWorker =
  | { type: 'open'; file: Blob }
  | { type: 'load'; requestId: number; routeName: string; start: number | null; end: number | null }

export type FromWorker =
  | { type: 'listed'; routes: AppleRoute[]; xmlBytes: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'scanned'; workouts: AppleWorkout[]; heartSamples: number }
  | { type: 'ride'; requestId: number; gpx: string; hrTimes: Float64Array; hrBpm: Uint8Array }
  | { type: 'error'; requestId?: number; message: string }

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(message, transfer)

const routes = new Map<string, FileEntry>()
let hrTimes = new Float64Array(1 << 16)
let hrBpm = new Uint8Array(1 << 16)
let hrCount = 0
let hrSorted = true

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data
  if (msg.type === 'open') {
    open(msg.file).catch((err) => post({ type: 'error', message: explain(err) }))
  } else if (msg.type === 'load') {
    load(msg).catch((err) => post({ type: 'error', requestId: msg.requestId, message: explain(err) }))
  }
}

function explain(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

async function open(file: Blob) {
  const reader = new ZipReader(new BlobReader(file))
  const entries = await reader.getEntries()
  let xml: FileEntry | null = null
  for (const entry of entries) {
    if (entry.directory) continue
    const name = entry.filename
    if (/workout-routes\/[^/]+\.gpx$/i.test(name)) {
      routes.set(baseName(name), entry)
    } else if (/\.xml$/i.test(name) && !/cda/i.test(baseName(name))) {
      // The main file is export.xml in English, but its name follows the phone's language.
      if (!xml || entry.uncompressedSize > xml.uncompressedSize) xml = entry
    }
  }
  if (routes.size === 0 && !xml) {
    throw new Error("This zip doesn't look like an Apple Health export: no workout routes and no export.xml inside.")
  }
  post({
    type: 'listed',
    routes: [...routes.entries()].map(([name, e]) => ({ name, bytes: e.uncompressedSize })),
    xmlBytes: xml ? xml.uncompressedSize : 0,
  })
  const workouts = xml ? await scan(xml) : []
  post({ type: 'scanned', workouts, heartSamples: hrCount })
}

// ---- one pass over export.xml ---------------------------------------------

const TOKEN =
  /<Record type="HKQuantityTypeIdentifierHeartRate"[^>]*>|<Workout [^>]*>|<\/Workout>|<FileReference path="([^"]*)"|<WorkoutStatistics type="HKQuantityTypeIdentifierDistance[^>]*>/g

function attr(tag: string, name: string): string | null {
  const key = ` ${name}="`
  const at = tag.indexOf(key)
  if (at < 0) return null
  const from = at + key.length
  return tag.slice(from, tag.indexOf('"', from))
}

/** "2023-11-19 15:08:47 -0400" → epoch ms, without the cost of Date.parse. */
function appleDate(s: string | null): number {
  if (!s || s.length < 25) return NaN
  const utc = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19))
  const sign = s.charCodeAt(20) === 45 ? -1 : 1
  return utc - sign * (+s.slice(21, 23) * 60 + +s.slice(23, 25)) * 60_000
}

function toMetres(value: string | null, unit: string | null): number | null {
  const v = Number(value)
  if (!value || !Number.isFinite(v)) return null
  return unit === 'mi' ? v * 1609.344 : unit === 'm' ? v : v * 1000
}

function pushHeart(time: number, bpm: number) {
  if (hrCount === hrTimes.length) {
    const t = new Float64Array(hrCount * 2)
    t.set(hrTimes)
    hrTimes = t
    const b = new Uint8Array(hrCount * 2)
    b.set(hrBpm)
    hrBpm = b
  }
  if (hrCount > 0 && time < hrTimes[hrCount - 1]) hrSorted = false
  hrTimes[hrCount] = time
  hrBpm[hrCount] = bpm
  hrCount++
}

async function scan(xml: FileEntry): Promise<AppleWorkout[]> {
  const workouts: AppleWorkout[] = []
  let current: AppleWorkout | null = null
  const decoder = new TextDecoder('utf-8')
  const total = xml.uncompressedSize
  let done = 0
  let lastReport = 0
  let carry = ''

  const consume = (text: string) => {
    TOKEN.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TOKEN.exec(text))) {
      const tag = m[0]
      const kind = tag.charCodeAt(1)
      if (kind === 82 /* R: heart-rate Record */) {
        const time = appleDate(attr(tag, 'startDate'))
        const bpm = Number(attr(tag, 'value'))
        if (Number.isFinite(time) && bpm > 20 && bpm < 250) pushHeart(time, Math.round(bpm))
      } else if (kind === 47 /* / : </Workout> */) {
        if (current) workouts.push(current)
        current = null
      } else if (kind === 70 /* F: FileReference */) {
        if (current && m[1]) current.routeName = baseName(m[1])
      } else if (tag.startsWith('<WorkoutStatistics')) {
        if (current && current.distanceM === null) current.distanceM = toMetres(attr(tag, 'sum'), attr(tag, 'unit'))
      } else {
        current = {
          id: workouts.length,
          type: (attr(tag, 'workoutActivityType') ?? '').replace('HKWorkoutActivityType', ''),
          start: appleDate(attr(tag, 'startDate')),
          end: appleDate(attr(tag, 'endDate')),
          distanceM: toMetres(attr(tag, 'totalDistance'), attr(tag, 'totalDistanceUnit')),
          routeName: null,
        }
        if (tag.endsWith('/>')) {
          workouts.push(current)
          current = null
        }
      }
    }
  }

  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      done += chunk.byteLength
      const text = carry + decoder.decode(chunk, { stream: true })
      // Only hand over whole lines; keep the unfinished tail for the next chunk.
      const cut = text.lastIndexOf('\n')
      if (cut < 0) {
        carry = text
      } else {
        consume(text.slice(0, cut))
        carry = text.slice(cut + 1)
      }
      if (done - lastReport > 8_000_000) {
        lastReport = done
        post({ type: 'progress', done, total })
      }
    },
  })
  await xml.getData(sink)
  consume(carry + decoder.decode())
  if (current) workouts.push(current)

  if (!hrSorted) {
    const order = Array.from({ length: hrCount }, (_, i) => i).sort((a, b) => hrTimes[a] - hrTimes[b])
    const t = new Float64Array(hrCount)
    const b = new Uint8Array(hrCount)
    for (let i = 0; i < hrCount; i++) {
      t[i] = hrTimes[order[i]]
      b[i] = hrBpm[order[i]]
    }
    hrTimes = t
    hrBpm = b
    hrSorted = true
  }
  post({ type: 'progress', done: total, total })
  return workouts.filter((w) => Number.isFinite(w.start))
}

// ---- one ride out ----------------------------------------------------------

function lowerBound(time: number): number {
  let lo = 0
  let hi = hrCount
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (hrTimes[mid] < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

async function load(msg: Extract<ToWorker, { type: 'load' }>) {
  const entry = routes.get(msg.routeName)
  if (!entry) throw new Error(`The route file ${msg.routeName} isn't in this export.`)
  const gpx = await entry.getData(new TextWriter())
  let times = new Float64Array(0)
  let bpm = new Uint8Array(0)
  if (hrCount > 0) {
    // Without workout times, take the route's own first and last timestamps.
    let start = msg.start
    let end = msg.end
    if (start === null || end === null) {
      const first = /<time>([^<]+)<\/time>\s*<extensions>|<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/.exec(gpx)
      const lastAt = gpx.lastIndexOf('<time>')
      start = Date.parse(first?.[1] ?? first?.[2] ?? '')
      end = lastAt >= 0 ? Date.parse(gpx.slice(lastAt + 6, gpx.indexOf('<', lastAt + 6))) : NaN
    }
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const from = lowerBound((start as number) - 60_000)
      const to = lowerBound((end as number) + 60_000)
      times = hrTimes.slice(from, to)
      bpm = hrBpm.slice(from, to)
    }
  }
  post({ type: 'ride', requestId: msg.requestId, gpx, hrTimes: times, hrBpm: bpm }, [times.buffer, bpm.buffer])
}
