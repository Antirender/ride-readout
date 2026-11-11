import type { Settings } from './types'

const KEY = 'ride-readout:settings'

export const DEFAULT_SETTINGS: Settings = { units: 'km', age: null, maxHr: null, trimEnds: true }

/** Settings are small, so they live in localStorage. Rides go to IndexedDB. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      units: saved.units === 'mi' ? 'mi' : 'km',
      age: typeof saved.age === 'number' ? saved.age : null,
      maxHr: typeof saved.maxHr === 'number' ? saved.maxHr : null,
      trimEnds: saved.trimEnds !== false,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private windows can refuse storage; the app still works for this visit.
  }
}
