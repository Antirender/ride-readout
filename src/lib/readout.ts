import { AHA, effortBands, haversine, type Analysis, type BandKey, type Effort, type Issue } from './analyze'
import { capitalize, countWord, duration, durationWords, joinList, makeFmt, ordinal, rideDate, shortDate, type Fmt } from './format'
import type { Ride, Settings } from './types'

/**
 * The readout rules: measured facts in, plain sentences out.
 * House rules: describe what happened, never prescribe; say so when data is
 * missing or looks wrong instead of reading it as fact.
 */

export type Badge = { text: string; tone: 'warn' | 'note' }

export type Row = {
  key: 'effort' | 'hard' | 'stops' | 'fastest' | 'compare' | 'check'
  label: string
  text: string
  /** Smaller print under the sentence: sources and caveats. */
  note?: string
  badge?: Badge
  /** Draws the label in the warning colour. */
  warn?: boolean
}

export type Readout = {
  header: string[]
  summary: string
  rows: Row[]
  effort: Effort | null
}

export type Subject = { ride: Ride; analysis: Analysis }

export function maxHeartRate(settings: Settings): { bpm: number; estimated: boolean } | null {
  if (settings.maxHr && settings.maxHr >= 100 && settings.maxHr <= 230) return { bpm: settings.maxHr, estimated: false }
  if (settings.age && settings.age >= 10 && settings.age <= 100) return { bpm: 220 - settings.age, estimated: true }
  return null
}

export function buildReadout(cur: Subject, previous: Subject | null, settings: Settings): Readout {
  const f = makeFmt(settings.units)
  const a = cur.analysis
  const max = maxHeartRate(settings)
  const effort = a.heart && max ? effortBands(a.heart.hist, max.bpm) : null

  const header = [rideDate(cur.ride.startTime).toUpperCase(), f.dist(a.distanceM).toUpperCase()]
  if (a.hasTime) {
    header.push(`${duration(a.movingS)} MOVING`.toUpperCase())
    if (a.elapsedS - a.movingS >= 60) header.push(`${duration(a.elapsedS)} OUT`.toUpperCase())
  }

  return {
    header,
    summary: summarySentence(a, effort, f),
    rows: [
      effortRow(cur, effort, max, f),
      hardRow(a, f),
      stopsRow(a, f),
      fastestRow(a, f),
      compareRow(cur, previous, f),
      checkRow(a, f),
    ],
    effort,
  }
}

// ---- the one-line summary --------------------------------------------------

function summarySentence(a: Analysis, effort: Effort | null, f: Fmt): string {
  const climbs = climbPhrase(a, f)
  if (!a.hasTime) {
    return `A ${f.dist(a.distanceM)} route, ${climbs}. This file has no times, so speed, stops and effort can't be read from it.`
  }
  const length = a.movingS < 40 * 60 ? 'short' : a.movingS < 120 * 60 ? 'medium-length' : 'long'
  const pace = effort ? EFFORT_WORD[effort.dominant] : paceWord(a)
  const article = /^[aeiou]/.test(length) ? 'An' : 'A'
  return `${article} ${length}, ${pace} ride: ${climbs}, and ${stopsPhrase(a, f)}.`
}

const EFFORT_WORD: Record<BandKey, string> = {
  light: 'light-effort',
  moderate: 'moderate-effort',
  vigorous: 'hard',
  above: 'very hard',
}

function paceWord(a: Analysis): string {
  const kmh = a.avgMovingMs * 3.6
  return kmh < 18 ? 'easy-paced' : kmh < 25 ? 'steady-paced' : 'fast-paced'
}

function climbPhrase(a: Analysis, f: Fmt): string {
  if (!a.hasEle) return 'with no elevation in the file'
  const c = a.climbs
  if (c.length === 0) {
    const perKm = a.distanceM > 0 ? a.gainM / (a.distanceM / 1000) : 0
    return perKm < 6 ? 'flat most of the way' : 'rolling, with no single big climb'
  }
  const kinds = new Set(c.map((x) => x.kind))
  if (c.length === 1) return `one ${c[0].kind} climb`
  if (kinds.size === 1) return `${countWord(c.length)} ${c[0].kind} climbs`
  const steepest = c.reduce((m, x) => (x.gradePct > m.gradePct ? x : m))
  return `${countWord(c.length)} climbs, the steepest starting at ${f.marker} ${f.at(steepest.startM, a.distanceM)}`
}

function stopsPhrase(a: Analysis, f: Fmt): string {
  const s = a.stops
  if (s.length === 0) return 'you never really stopped'
  if (s.length === 1) return `one ${duration(s[0].durationS)} stop at ${f.marker} ${f.at(s[0].atM, a.distanceM)}`
  if (stopsOnHighGround(a)) return 'your stops all came on the high ground'
  const span = stopSpan(a)
  if (span) return `your stops all came between ${f.marker} ${f.at(span[0], a.distanceM)} and ${f.at(span[1], a.distanceM)}`
  return `${countWord(s.length)} stops along the way`
}

function stopsOnHighGround(a: Analysis): boolean {
  const range = a.maxEle - a.minEle
  if (!a.hasEle || a.stops.length < 2 || range < 30) return false
  return a.stops.every((s) => s.eleM >= a.minEle + range * 0.6)
}

/** The stretch the stops fall in, if they bunch into under 40% of the ride. */
function stopSpan(a: Analysis): [number, number] | null {
  if (a.stops.length < 2) return null
  const first = a.stops[0].atM
  const last = a.stops[a.stops.length - 1].atM
  return last - first <= a.distanceM * 0.4 && last - first > 0 ? [first, last] : null
}

// ---- rows ------------------------------------------------------------------

function effortRow(cur: Subject, effort: Effort | null, max: ReturnType<typeof maxHeartRate>, _f: Fmt): Row {
  const a = cur.analysis
  const label = 'Effort'
  if (!a.heart && a.heartThin) {
    const thin = a.heartThin
    const avg = Math.round(thin.avg)
    let where = ''
    if (max) {
      const share = thin.avg / max.bpm
      const name = share < AHA.moderate ? 'below the moderate range' : share < AHA.vigorous ? 'in the moderate range' : share < AHA.top ? 'in the vigorous range' : 'above the vigorous range'
      where = ` That average sits ${name} for a maximum of ${max.bpm} bpm.`
    }
    return {
      key: 'effort',
      label,
      warn: true,
      badge: { text: 'Thin data', tone: 'warn' },
      text: `Only ${thin.readings} heart-rate readings came with this ride, about one every ${durationWords(thin.everyS)}. They average ${avg} bpm and the highest is ${Math.round(thin.max)}.${where} That's a rough idea of the effort, not enough to say where it got hard.`,
      note: max
        ? `Ranges follow the American Heart Association: moderate is ${AHA.moderate * 100}–${AHA.vigorous * 100}% of maximum heart rate, vigorous ${AHA.vigorous * 100}–${AHA.top * 100}%. A HealthFit .FIT of the same ride carries every reading.`
        : 'A HealthFit .FIT of the same ride carries every reading. Add your age in Settings to place the average against the American Heart Association\'s ranges.',
    }
  }
  if (!a.heart) {
    const how =
      cur.ride.source === 'fit'
        ? 'Record with a watch or a chest strap to see it.'
        : "Add this ride's HealthFit .FIT to see it."
    return {
      key: 'effort',
      label,
      warn: true,
      badge: { text: 'Missing data', tone: 'warn' },
      text: `Heart rate isn't in this file, so I can't say how hard this was. ${how}`,
    }
  }
  const avg = Math.round(a.heart.avg)
  const peak = Math.round(a.heart.max)
  if (!effort || !max) {
    return {
      key: 'effort',
      label,
      badge: { text: 'Needs your age', tone: 'note' },
      text: `Your heart rate averaged ${avg} bpm and peaked at ${peak}. Tell me your age and I'll place that against the American Heart Association's ranges.`,
    }
  }
  const band = (k: BandKey) => effort.bands.find((b) => b.key === k)!
  const top = band(effort.dominant)
  const mins = (s: number) => durationWords(s)
  const rangeOf = (k: BandKey) => {
    const b = band(k)
    if (k === 'light') return `under ${b.toBpm} bpm`
    if (k === 'above') return `over ${b.fromBpm} bpm`
    return `${b.fromBpm} to ${b.toBpm! - 1} bpm`
  }
  const NAME: Record<BandKey, string> = {
    light: 'light',
    moderate: 'moderate',
    vigorous: 'vigorous',
    above: 'above the vigorous range',
  }
  let lead: string
  if (top.share >= 0.6 || !effort.second) {
    lead = `Mostly ${NAME[top.key]}: ${mins(top.seconds)} of the ${mins(effort.totalS)} recorded, with your heart rate ${rangeOf(top.key)}.`
  } else {
    const second = band(effort.second)
    lead = `Split between ${NAME[top.key]} (${mins(top.seconds)}, ${rangeOf(top.key)}) and ${NAME[second.key]} (${mins(second.seconds)}).`
  }
  const named = top.share >= 0.6 || !effort.second ? [top.key] : [top.key, effort.second]
  const rest = effort.bands
    .filter((b) => !named.includes(b.key) && b.seconds >= 60)
    .map((b) => `${mins(b.seconds)} ${NAME[b.key]}`)
  const tail = rest.length ? ` The rest: ${joinList(rest)}.` : ''
  return {
    key: 'effort',
    label,
    text: `${lead}${tail} Average ${avg} bpm, peak ${peak}.`,
    note: `Ranges follow the American Heart Association: moderate is ${AHA.moderate * 100}–${AHA.vigorous * 100}% of maximum heart rate, vigorous ${AHA.vigorous * 100}–${AHA.top * 100}%. Your maximum is ${max.estimated ? `estimated as 220 − age = ${max.bpm}` : `set to ${max.bpm}`} bpm. This describes the ride; it isn't training or medical advice.`,
  }
}

function hardRow(a: Analysis, f: Fmt): Row {
  const label = 'Where it got hard'
  const parts: string[] = []
  const total = a.distanceM
  const span = (s: number, e: number) => {
    const from = f.at(s, total)
    const to = f.at(e, total)
    // A short stretch on a long ride would read "km 11 to 11": give it a decimal.
    return from === to
      ? `${f.marker} ${f.inUnits(s).toFixed(1)} to ${f.inUnits(e).toFixed(1)}`
      : `${f.marker} ${from} to ${to}`
  }

  if (!a.hasEle) {
    parts.push("This file has no elevation, so I can't see the climbs.")
  } else if (a.climbs.length === 0) {
    parts.push(`No real climbs: the whole ride stayed within ${f.ele(a.maxEle - a.minEle)} of height.`)
  } else {
    const c = a.climbs
    const kinds = new Set(c.map((x) => x.kind))
    const list = c.map((x) =>
      kinds.size === 1
        ? `${span(x.startM, x.endM)} (up ${f.ele(x.gainM)})`
        : `${span(x.startM, x.endM)} (${x.kind}, up ${f.ele(x.gainM)})`,
    )
    const head =
      c.length === 1
        ? `One ${c[0].kind} climb`
        : kinds.size === 1
          ? `${capitalize(countWord(c.length))} ${c[0].kind} climbs`
          : `${capitalize(countWord(c.length))} climbs`
    parts.push(`${head}: ${joinList(list)}.`)

    if (a.hasTime && a.avgMovingMs > 0) {
      const speeds = c.filter((x) => x.speedMs > 0)
      if (speeds.length) {
        const len = speeds.reduce((s, x) => s + (x.endM - x.startM), 0)
        const secs = speeds.reduce((s, x) => s + (x.endM - x.startM) / x.speedMs, 0)
        const climbMs = len / secs
        const ratio = climbMs / a.avgMovingMs
        const where = c.length === 1 ? 'on it' : c.length === 2 ? 'on both' : 'on them'
        const versus =
          ratio > 0.9 && ratio < 1.1
            ? 'close to your average'
            : ratio <= 0.9
              ? `against ${f.speed(a.avgMovingMs)} for the whole ride`
              : `faster than your ${f.speed(a.avgMovingMs)} average`
        parts.push(`You held about ${f.speed(climbMs)} ${where}, ${versus}.`)
      }
    }
  }

  const h = a.heart?.hardest
  if (h) {
    const where = h.climb !== null ? (a.climbs.length === 1 ? ', on the climb' : `, on the ${ordinal(h.climb)} climb`) : ''
    parts.push(`Your heart rate was highest from ${span(h.startM, h.endM)}${where}: about ${Math.round(h.avg)} bpm.`)
  }
  return { key: 'hard', label, text: parts.join(' ') }
}

function stopsRow(a: Analysis, f: Fmt): Row {
  const label = 'Stops'
  if (!a.hasTime) return { key: 'stops', label, text: "No times in this file, so I can't see stops.", warn: true }
  const s = a.stops
  const at = (m: number) => `${f.marker} ${f.at(m, a.distanceM)}`
  const pauses = a.shortPausesS >= 60 ? ` Shorter pauses added ${durationWords(a.shortPausesS)}.` : ''
  if (s.length === 0) {
    return {
      key: 'stops',
      label,
      text: a.shortPausesS >= 60
        ? `No real stops, only short pauses: ${durationWords(a.shortPausesS)} in all.`
        : 'No stops. You kept moving the whole way.',
    }
  }
  if (s.length === 1) {
    return { key: 'stops', label, text: `1 stop: ${durationWords(a.stoppedS)} at ${at(s[0].atM)}.${pauses}` }
  }
  const span = stopSpan(a)
  const longest = s.reduce((m, x) => (x.durationS > m.durationS ? x : m))
  let text = `${s.length} stops, ${durationWords(a.stoppedS)} in total`
  text += span ? `, all between ${at(span[0])} and ${f.at(span[1], a.distanceM)}.` : '.'
  if (longest.durationS >= 300 && longest.durationS >= a.stoppedS * 0.4) {
    text += ` The longest was ${durationWords(longest.durationS)} at ${at(longest.atM)}.`
  }
  return { key: 'stops', label, text: text + pauses }
}

function fastestRow(a: Analysis, f: Fmt): Row {
  const label = 'Fastest'
  if (!a.fastest) return { key: 'fastest', label, text: "No times in this file, so I can't see speed.", warn: true }
  const where = { down: ', on the way down', up: ', going uphill', flat: ', on the flat', unknown: '' }[a.fastest.slope]
  return {
    key: 'fastest',
    label,
    text: `${f.speed(a.fastest.ms)} at ${f.marker} ${f.at(a.fastest.atM, a.distanceM)}${where}.`,
  }
}

// ---- am I improving? -------------------------------------------------------

/** Two rides count as the same route when they start and end together and are about as long. */
export function sameRoute(a: Analysis, b: Analysis): boolean {
  if (!a.start || !b.start || !a.end || !b.end) return false
  const near = (p: [number, number], q: [number, number]) => haversine(p[0], p[1], q[0], q[1]) < 400
  const lengthOk = Math.abs(a.distanceM - b.distanceM) <= Math.max(a.distanceM, b.distanceM) * 0.08
  return lengthOk && near(a.start, b.start) && near(a.end, b.end)
}

function compareRow(cur: Subject, prev: Subject | null, f: Fmt): Row {
  const label = 'Vs last ride'
  if (!prev) return { key: 'compare', label, text: 'Needs a second ride. Add one to compare.' }
  const a = cur.analysis
  const b = prev.analysis
  const when = shortDate(prev.ride.startTime)
  if (!a.hasTime || !b.hasTime) {
    const diff = a.distanceM - b.distanceM
    return {
      key: 'compare',
      label,
      text: `Compared with ${when}: ${f.dist(Math.abs(diff))} ${diff >= 0 ? 'longer' : 'shorter'}. One of the two files has no times, so I can't compare speed.`,
    }
  }

  const same = sameRoute(a, b)
  const facts: string[] = []
  const dDist = a.distanceM - b.distanceM
  if (!same && Math.abs(dDist) >= Math.max(500, b.distanceM * 0.05)) {
    facts.push(`${f.dist(Math.abs(dDist))} ${dDist > 0 ? 'longer' : 'shorter'}`)
  }
  if (same) {
    const dT = a.movingS - b.movingS
    if (Math.abs(dT) >= 30) facts.push(`${durationWords(Math.abs(dT))} ${dT < 0 ? 'quicker' : 'slower'} in moving time`)
  }
  const dSpeed = f.speedValue(a.avgMovingMs) - f.speedValue(b.avgMovingMs)
  const speedMoved = Math.abs(dSpeed) >= 0.5
  facts.push(
    speedMoved
      ? `${Math.abs(dSpeed).toFixed(1)} ${f.speedUnit} ${dSpeed > 0 ? 'faster' : 'slower'} on average (${f.speedPrecise(a.avgMovingMs)} against ${f.speedPrecise(b.avgMovingMs)})`
      : `about the same average speed (${f.speedPrecise(a.avgMovingMs)})`,
  )
  const dGain = a.gainM - b.gainM
  if (!same && a.hasEle && b.hasEle && Math.abs(dGain) >= Math.max(20, b.gainM * 0.25)) {
    facts.push(`${f.ele(Math.abs(dGain))} ${dGain > 0 ? 'more' : 'less'} climbing`)
  }

  const head = same ? `Same route as ${when}` : `Compared with ${when}`
  let text = `${head}: ${joinList(facts)}.`

  // Terrain has to be alike before speed says anything about the rider.
  const perKm = (x: Analysis) => (x.distanceM > 0 ? x.gainM / (x.distanceM / 1000) : 0)
  const alike =
    same ||
    (Math.abs(dDist) <= b.distanceM * 0.3 &&
      (!a.hasEle || !b.hasEle || Math.abs(perKm(a) - perKm(b)) <= Math.max(3, perKm(b) * 0.3)))

  if (a.heart && b.heart) {
    const dHr = Math.round(a.heart.avg) - Math.round(b.heart.avg)
    const hrMoved = Math.abs(dHr) >= 3
    text += hrMoved
      ? ` Your average heart rate was ${Math.abs(dHr)} bpm ${dHr > 0 ? 'higher' : 'lower'} (${Math.round(a.heart.avg)} against ${Math.round(b.heart.avg)}).`
      : ` Your average heart rate was about the same (${Math.round(a.heart.avg)} bpm).`
    if (!alike) {
      text += " The two rides are different enough in length or hills that the speeds aren't like for like."
    } else if (speedMoved && dSpeed > 0 && dHr <= 2) {
      text += ' Faster without a higher heart rate: on this pair of rides, you improved.'
    } else if (speedMoved && dSpeed > 0) {
      text += ' Faster, and you worked harder for it.'
    } else if (speedMoved && dSpeed < 0 && dHr >= 3) {
      text += ' Slower with a higher heart rate: this one cost you more.'
    } else if (speedMoved && dSpeed < 0) {
      text += ' Slower, and you took it easier.'
    } else if (dHr <= -3) {
      text += ' Same speed at a lower heart rate: on this pair of rides, it got easier.'
    } else if (dHr >= 3) {
      text += ' Same speed at a higher heart rate: this one cost you more.'
    } else {
      text += ' Much the same ride, for much the same effort.'
    }
  } else {
    if (!alike) text += " The two rides are different enough in length or hills that the speeds aren't like for like."
    text += ' Heart rate is missing or too thin in one of them, so I can only compare speed, not effort.'
  }
  return { key: 'compare', label, text }
}

// ---- data that looks wrong -------------------------------------------------

function checkRow(a: Analysis, f: Fmt): Row {
  const label = 'Data check'
  const lines = a.issues.filter((i) => i.kind !== 'no-time').map((i) => issueSentence(i, f))
  if (lines.length === 0) {
    return { key: 'check', label, text: a.hasTime ? 'Nothing in this file looked wrong.' : 'This file is a route without times.' }
  }
  return { key: 'check', label, text: lines.join(' '), warn: true, badge: { text: 'Check this', tone: 'warn' } }
}

function issueSentence(issue: Issue, f: Fmt): string {
  switch (issue.kind) {
    case 'gps-jumps':
      return `The GPS jumped ${issue.count === 1 ? 'once' : issue.count === 2 ? 'twice' : `${issue.count} times`}, which would have added ${f.dist(issue.meters)}. I left ${issue.count === 1 ? 'it' : 'those'} out.`
    case 'drift':
      return `While you were stopped the GPS kept wandering, ${f.dist(issue.meters)} in all. I didn't count it as riding.`
    case 'distance-mismatch':
      return `Your device says ${f.dist(issue.deviceM)}, but its GPS track adds up to ${f.dist(issue.trackM)}. I used the track; treat the distance as approximate.`
    case 'low-accuracy':
      return `The GPS signal was weak for about ${Math.round(issue.share * 100)}% of the ride, so distance and speed are rougher than usual.`
    case 'left-running':
      return `One stop lasted ${duration(issue.stopS)} of the ${duration(issue.elapsedS)} recording. It looks like the recording was left running.`
    case 'hr-gaps':
      return `Heart rate is missing for about ${Math.round((1 - issue.coverage) * 100)}% of the ride, so effort is based on the rest.`
    case 'too-short':
      return 'This is a very short ride, so there is not much to read from it.'
    case 'not-cycling':
      return `The file says this was "${issue.sport.replace(/_/g, ' ')}", not cycling. I read it as a ride anyway.`
    case 'no-time':
      return ''
  }
}

/** The whole readout as plain text, for copying into a message or a form. */
export function readoutText(r: Readout): string {
  const lines = [r.header.join(' · '), '', r.summary, '']
  for (const row of r.rows) lines.push(`${row.label.toUpperCase()}: ${row.text}`)
  return lines.join('\n')
}
