import { useState } from 'react'
import type { Effort } from '../lib/analyze'
import { durationWords, shortDate } from '../lib/format'
import type { Readout } from '../lib/readout'
import type { Ride, Settings } from '../lib/types'

type Props = {
  readout: Readout
  settings: Settings
  onSettings: (next: Settings) => void
  /** Other rides this one can be compared with, newest first. */
  others: Ride[]
  compareId: string | null
  onCompare: (id: string | null) => void
}

export function ReadoutCard({ readout, settings, onSettings, others, compareId, onCompare }: Props) {
  return (
    <article className="card readout" aria-label="Ride readout">
      <p className="eyebrow">{readout.header.join('  ·  ')}</p>
      <h1 className="summary">{readout.summary}</h1>
      <dl className="rows">
        {readout.rows.map((row) => (
          <div className="row" key={row.key}>
            <dt className={row.warn ? 'label warn' : 'label'}>{row.label}</dt>
            <dd>
              <p>{row.text}</p>
              {row.key === 'effort' && readout.effort && <EffortBar effort={readout.effort} />}
              {row.key === 'effort' && row.badge?.text === 'Needs your age' && (
                <AgeField onAge={(age) => onSettings({ ...settings, age })} />
              )}
              {row.note && <p className="fine">{row.note}</p>}
              {row.key === 'compare' && others.length > 1 && (
                <label className="pick">
                  Compare with
                  <select value={compareId ?? ''} onChange={(e) => onCompare(e.target.value || null)}>
                    <option value="">the ride before this one</option>
                    {others.map((r) => (
                      <option key={r.id} value={r.id}>
                        {shortDate(r.startTime)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </dd>
            <div className="badge-cell">
              {row.badge && <span className={`badge ${row.badge.tone}`}>{row.badge.text}</span>}
            </div>
          </div>
        ))}
      </dl>
    </article>
  )
}

function AgeField({ onAge }: { onAge: (age: number) => void }) {
  const [value, setValue] = useState('')
  const age = Number(value)
  const ok = Number.isInteger(age) && age >= 10 && age <= 100
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onAge(age)
      }}
    >
      <label>
        Your age
        <input
          type="number"
          inputMode="numeric"
          min={10}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 29"
        />
      </label>
      <button type="submit" className="btn small" disabled={!ok}>
        Place my effort
      </button>
      <span className="fine">Saved on this device only.</span>
    </form>
  )
}

const shortMinutes = (seconds: number) =>
  seconds >= 60 ? durationWords(seconds).replace(/minutes?/, 'min') : seconds >= 1 ? 'under 1 min' : '0 min'

/** Time in each AHA range: one hue, light to dark, with the minutes written out. */
function EffortBar({ effort }: { effort: Effort }) {
  const shown = effort.bands.filter((b) => b.seconds >= 1)
  return (
    <figure className="effort">
      <div className="effort-bar" role="img" aria-label="Time in each heart rate range">
        {shown.map((b) => (
          <span
            key={b.key}
            className={`seg ${b.key}`}
            style={{ flexGrow: Math.max(b.share, 0.012) }}
            title={`${b.label}: ${durationWords(b.seconds)} (${Math.round(b.share * 100)}%)`}
          />
        ))}
      </div>
      <figcaption className="effort-legend">
        {effort.bands.map((b) => (
          <span key={b.key} className={b.seconds < 1 ? 'dim' : undefined}>
            <i className={`swatch ${b.key}`} />
            {b.label}
            <b>{shortMinutes(b.seconds)}</b>
            <em>
              {b.key === 'light'
                ? `under ${b.toBpm}`
                : b.key === 'above'
                  ? `${b.fromBpm}+`
                  : `${b.fromBpm}–${b.toBpm! - 1}`}{' '}
              bpm
            </em>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
