import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../lib/types'

type Props = {
  open: boolean
  settings: Settings
  rideCount: number
  persistent: boolean
  onChange: (next: Settings) => void
  onDeleteAll: () => void
  onClose: () => void
}

export function SettingsDialog({ open, settings, rideCount, persistent, onChange, onDeleteAll, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const number = (value: string, min: number, max: number) => {
    const n = Number(value)
    return value !== '' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={() => {
        setConfirming(false)
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="dialog-body">
        <header>
          <h2>Settings</h2>
          <button type="button" className="btn small" onClick={onClose}>
            Done
          </button>
        </header>

        <fieldset>
          <legend>Units</legend>
          <div className="choice">
            {(['km', 'mi'] as const).map((u) => (
              <label key={u}>
                <input type="radio" name="units" checked={settings.units === u} onChange={() => onChange({ ...settings, units: u })} />
                {u === 'km' ? 'Kilometres and metres' : 'Miles and feet'}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Effort</legend>
          <p className="fine">
            To say whether a ride was moderate or vigorous, the readout compares your heart rate with your maximum. The
            American Heart Association estimates that maximum as 220 minus your age.
          </p>
          <div className="fields">
            <label>
              Your age
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={100}
                defaultValue={settings.age ?? ''}
                key={`age-${settings.age}`}
                onBlur={(e) => onChange({ ...settings, age: number(e.target.value, 10, 100) })}
              />
            </label>
            <label>
              Max heart rate, if you know it
              <input
                type="number"
                inputMode="numeric"
                min={100}
                max={230}
                placeholder={settings.age ? `${220 - settings.age} (estimated)` : 'optional'}
                defaultValue={settings.maxHr ?? ''}
                key={`max-${settings.maxHr}`}
                onBlur={(e) => onChange({ ...settings, maxHr: number(e.target.value, 100, 230) })}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Privacy</legend>
          <label className="check">
            <input type="checkbox" checked={settings.trimEnds} onChange={(e) => onChange({ ...settings, trimEnds: e.target.checked })} />
            Hide the first and last 500 m of the route drawing
          </label>
          <p className="fine">
            {persistent
              ? `Your ${rideCount === 1 ? 'ride is' : `${rideCount} rides are`} stored in this browser only (IndexedDB). There is no account and no server: nothing you add is uploaded.`
              : "This browser won't let the site store anything (a private window, perhaps), so rides last only until you close this tab."}
          </p>
          {rideCount > 0 &&
            (confirming ? (
              <div className="confirm">
                <span>Delete all {rideCount} rides from this device? This can't be undone.</span>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => {
                    onDeleteAll()
                    setConfirming(false)
                  }}
                >
                  Yes, delete them
                </button>
                <button type="button" className="btn small" onClick={() => setConfirming(false)}>
                  Keep them
                </button>
              </div>
            ) : (
              <button type="button" className="btn small" onClick={() => setConfirming(true)}>
                Delete all rides from this device…
              </button>
            ))}
        </fieldset>
      </div>
    </dialog>
  )
}
