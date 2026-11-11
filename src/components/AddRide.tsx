import { useRef, useState } from 'react'

type Props = {
  onFiles: (files: File[]) => void
  onSample: () => void
  busy: boolean
  hasRides: boolean
}

/** The three ways in, in the order we recommend them. */
export function AddRide({ onFiles, onSample, busy, hasRides }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <section className="add">
      {!hasRides && (
        <header className="hero">
          <p className="eyebrow">For everyday riders</p>
          <h1>One ride in. A few plain sentences out.</h1>
          <p className="lede">
            Drop in a ride file and read how hard it was, where it got hard, and how it compares with your last ride.
            No account. Your rides never leave this device.
          </p>
        </header>
      )}
      {hasRides && <h1 className="add-title">Add a ride</h1>}

      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        // The drop itself is handled by the whole page, so a near miss still works.
        onDrop={() => setOver(false)}
      >
        <p className="drop-title">{busy ? 'Reading…' : 'Drop a ride file here'}</p>
        <p className="quiet">.FIT, .GPX, or Apple Health's export.zip. Several files at once is fine.</p>
        <div className="drop-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
            Choose a file
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onSample}>
            No file? Try two sample rides
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".fit,.gpx,.zip,application/zip,application/gpx+xml"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) onFiles(files)
          }}
        />
      </div>

      <h2 className="section-title">Three ways to get a ride out</h2>
      <ol className="ways">
        <li className="card way">
          <p className="way-tag best">Best from Apple Watch</p>
          <h3>HealthFit → one .FIT</h3>
          <ol>
            <li>Open the HealthFit app on your iPhone and pick the ride.</li>
            <li>Export it as a .FIT file and save or AirDrop it to this device.</li>
            <li>Drop the .FIT here.</li>
          </ol>
          <p className="fine">One ride at a time, and heart rate comes with it.</p>
        </li>
        <li className="card way">
          <p className="way-tag">No extra app</p>
          <h3>Apple Health → export.zip</h3>
          <ol>
            <li>On your iPhone: Health → your picture → Export All Health Data.</li>
            <li>Send the export.zip to this device.</li>
            <li>Drop the zip here, then pick which rides to add.</li>
          </ol>
          <p className="fine">The export can be over 1 GB. It is read in place, in your browser; nothing is uploaded.</p>
        </li>
        <li className="card way">
          <p className="way-tag">Everything else</p>
          <h3>Any single .FIT or .GPX</h3>
          <ol>
            <li>Garmin, Wahoo, Coros and most bike computers save rides as .FIT.</li>
            <li>Strava and Komoot can export a ride as .GPX from their websites.</li>
            <li>Drop the file here.</li>
          </ol>
          <p className="fine">GPX files often have no heart rate. The readout will say so instead of guessing.</p>
        </li>
      </ol>
    </section>
  )
}
