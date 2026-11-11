import type { AppleRoute, AppleWorkout, FromWorker, ToWorker } from '../workers/appleExport.worker'
import { makeRide, mergeHeartRate } from './importRide'
import { parseGpx } from './parseGpx'
import type { Ride } from './types'

export type { AppleRoute, AppleWorkout }

export type AppleEvent =
  | { type: 'listed'; routes: AppleRoute[]; xmlBytes: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'scanned'; workouts: AppleWorkout[]; heartSamples: number }
  | { type: 'error'; message: string }

/** One ride we can offer from the export, whether or not export.xml told us about it. */
export type AppleChoice = {
  key: string
  routeName: string
  /** Start and end from the workout record, when export.xml was read. */
  start: number | null
  end: number | null
  /** A date to sort and show by. */
  when: number
  distanceM: number | null
  cycling: boolean | null
}

/** Talks to the worker that reads the export zip in place. */
export class AppleExport {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, { resolve: (r: Ride) => void; reject: (e: Error) => void; choice: AppleChoice }>()

  constructor(file: File, onEvent: (event: AppleEvent) => void) {
    this.worker = new Worker(new URL('../workers/appleExport.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data
      if (msg.type === 'ride') {
        const job = this.pending.get(msg.requestId)
        this.pending.delete(msg.requestId)
        if (!job) return
        try {
          const parsed = parseGpx(msg.gpx)
          mergeHeartRate(parsed.track, msg.hrTimes, msg.hrBpm)
          job.resolve(
            makeRide('apple-export', job.choice.routeName, parsed.track, parsed.startTime, {
              distanceM: job.choice.distanceM ?? undefined,
              sport: job.choice.cycling ? 'cycling' : undefined,
            }),
          )
        } catch (err) {
          job.reject(err instanceof Error ? err : new Error(String(err)))
        }
      } else if (msg.type === 'error' && msg.requestId !== undefined) {
        this.pending.get(msg.requestId)?.reject(new Error(msg.message))
        this.pending.delete(msg.requestId)
      } else {
        onEvent(msg as AppleEvent)
      }
    }
    this.worker.onerror = (event) => onEvent({ type: 'error', message: event.message || 'The export could not be read.' })
    this.send({ type: 'open', file })
  }

  private send(message: ToWorker) {
    this.worker.postMessage(message)
  }

  loadRide(choice: AppleChoice): Promise<Ride> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextId++
      this.pending.set(requestId, { resolve, reject, choice })
      this.send({ type: 'load', requestId, routeName: choice.routeName, start: choice.start, end: choice.end })
    })
  }

  close() {
    this.worker.terminate()
  }
}

/** Apple names route files by local end time: route_2023-11-19_5.54pm.gpx */
function dateFromRouteName(name: string): number {
  const m = /route_(\d{4})-(\d{2})-(\d{2})_(\d{1,2})\.(\d{2})(am|pm)/i.exec(name)
  if (!m) return 0
  let hour = Number(m[4]) % 12
  if (m[6].toLowerCase() === 'pm') hour += 12
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[5])).getTime()
}

/** Builds the pick-list: workouts with a route when we have them, bare route files otherwise. */
export function buildChoices(routes: AppleRoute[], workouts: AppleWorkout[] | null): AppleChoice[] {
  const names = new Set(routes.map((r) => r.name))
  const choices: AppleChoice[] = []
  const claimed = new Set<string>()
  for (const w of workouts ?? []) {
    if (!w.routeName || !names.has(w.routeName) || claimed.has(w.routeName)) continue
    claimed.add(w.routeName)
    choices.push({
      key: w.routeName,
      routeName: w.routeName,
      start: w.start,
      end: Number.isFinite(w.end) ? w.end : null,
      when: w.start,
      distanceM: w.distanceM,
      cycling: /cycling/i.test(w.type),
    })
  }
  for (const r of routes) {
    if (claimed.has(r.name)) continue
    choices.push({
      key: r.name,
      routeName: r.name,
      start: null,
      end: null,
      when: dateFromRouteName(r.name),
      distanceM: null,
      cycling: workouts ? false : null,
    })
  }
  return choices.sort((a, b) => b.when - a.when)
}
