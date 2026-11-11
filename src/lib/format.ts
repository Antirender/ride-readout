import type { Units } from './types'

const KM = 1000
const MILE = 1609.344
const FOOT = 0.3048

export type Fmt = ReturnType<typeof makeFmt>

/** All number-to-words formatting, in the rider's units. */
export function makeFmt(units: Units) {
  const unitM = units === 'mi' ? MILE : KM
  const distUnit = units === 'mi' ? 'mi' : 'km'
  const speedUnit = units === 'mi' ? 'mph' : 'km/h'
  const marker = units === 'mi' ? 'mile' : 'km'

  const inUnits = (m: number) => m / unitM
  const speedValue = (ms: number) => (ms * 3600) / unitM

  return {
    units,
    distUnit,
    speedUnit,
    marker,
    inUnits,
    speedValue,
    /** "51.0 km" */
    dist(m: number, digits = 1) {
      return `${inUnits(m).toFixed(digits)} ${distUnit}`
    },
    /** A position along the ride, as a bare number: 4, or 1.2 on short rides. */
    at(m: number, totalM: number) {
      const v = inUnits(m)
      return inUnits(totalM) < 10 ? trimZero(v.toFixed(1)) : String(Math.round(v))
    },
    /** "16 km/h" */
    speed(ms: number) {
      return `${Math.round(speedValue(ms))} ${speedUnit}`
    },
    speedPrecise(ms: number) {
      return `${speedValue(ms).toFixed(1)} ${speedUnit}`
    },
    /** "83 m" or "272 ft" */
    ele(m: number) {
      return units === 'mi' ? `${Math.round(m / FOOT)} ft` : `${Math.round(m)} m`
    },
  }
}

function trimZero(s: string) {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** "3 h 3 min", "52 min", "45 s" */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const totalMin = Math.round(seconds / 60)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "20 minutes", "1 minute", "45 seconds", "1 h 5 min" */
export function durationWords(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  const min = Math.round(seconds / 60)
  if (min >= 60) return duration(seconds)
  return min === 1 ? '1 minute' : `${min} minutes`
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n)
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ordinal(i: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth'][i] ?? `${i + 1}th`
}

/** "Sun, Nov 19, 2023" in the rider's own time zone. */
export function rideDate(ms: number | null): string {
  if (ms === null) return 'No date in file'
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function shortDate(ms: number | null): string {
  if (ms === null) return 'undated ride'
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear()
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "a, b and c" */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
