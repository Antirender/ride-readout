import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddRide } from './components/AddRide'
import { AppleImport } from './components/AppleImport'
import { ReadoutCard } from './components/ReadoutCard'
import { RideCharts } from './components/RideCharts'
import { RouteSketch } from './components/RouteSketch'
import { SettingsDialog } from './components/SettingsDialog'
import { analyze, type Analysis } from './lib/analyze'
import { duration, makeFmt, shortDate } from './lib/format'
import { readRideFile } from './lib/importRide'
import { buildReadout, maxHeartRate, readoutText } from './lib/readout'
import { sampleRides } from './lib/sample'
import { loadSettings, saveSettings } from './lib/settings'
import { deleteAllRides, deleteRide, isPersistent, loadRides, saveRide } from './lib/store'
import type { Ride, Settings } from './lib/types'

const RIDER_FORM = 'https://forms.gle/DE4X8HrKSnH53n3Y7'

type Notice = { id: number; tone: 'warn' | 'ok'; text: string }

const byNewest = (a: Ride, b: Ride) => (b.startTime ?? b.addedAt) - (a.startTime ?? a.addedAt)
const isZip = (file: File) => /\.zip$/i.test(file.name) || file.type === 'application/zip'

export default function App() {
  const [rides, setRides] = useState<Ride[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [appleFile, setAppleFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [hover, setHover] = useState<number | null>(null)
  const [compareWith, setCompareWith] = useState<Record<string, string | null>>({})
  const noticeId = useRef(0)

  useEffect(() => {
    loadRides().then((stored) => {
      const sorted = stored.sort(byNewest)
      setRides(sorted)
      setSelectedId(sorted[0]?.id ?? null)
    })
  }, [])

  const notify = useCallback((tone: Notice['tone'], text: string) => {
    setNotices((list) => [...list, { id: ++noticeId.current, tone, text }])
  }, [])

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }, [])

  const keepRides = useCallback(async (incoming: Ride[]) => {
    if (incoming.length === 0) return
    await Promise.all(incoming.map(saveRide))
    setRides((current) => {
      const ids = new Set(incoming.map((r) => r.id))
      return [...(current ?? []).filter((r) => !ids.has(r.id)), ...incoming].sort(byNewest)
    })
    setSelectedId([...incoming].sort(byNewest)[0].id)
    setHover(null)
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      const zips = files.filter(isZip)
      const single = files.filter((f) => !isZip(f))
      setBusy(true)
      const added: Ride[] = []
      for (const file of single) {
        try {
          added.push(await readRideFile(file))
        } catch (err) {
          notify('warn', err instanceof Error ? err.message : `${file.name} could not be read.`)
        }
      }
      await keepRides(added)
      setBusy(false)
      if (zips.length > 0) {
        setAppleFile(zips[0])
        setAdding(true)
        if (zips.length > 1) notify('warn', 'One Apple Health export at a time: I opened the first zip.')
      } else if (added.length > 0) {
        setAdding(false)
      }
    },
    [keepRides, notify],
  )

  const analyses = useMemo(() => {
    const map = new Map<string, Analysis>()
    for (const ride of rides ?? []) map.set(ride.id, analyze(ride))
    return map
  }, [rides])

  const current = rides?.find((r) => r.id === selectedId) ?? null
  const analysis = current ? analyses.get(current.id)! : null
  const fmt = useMemo(() => makeFmt(settings.units), [settings.units])

  // "Last ride" means the most recent ride before this one, unless the rider picks another.
  const previous = useMemo(() => {
    if (!current || !rides) return null
    const chosen = compareWith[current.id]
    if (chosen) return rides.find((r) => r.id === chosen) ?? null
    if (current.startTime === null) return null
    return rides.filter((r) => r.startTime !== null && r.startTime < current.startTime!).sort(byNewest)[0] ?? null
  }, [current, rides, compareWith])

  const readout = useMemo(() => {
    if (!current || !analysis) return null
    const prev = previous ? { ride: previous, analysis: analyses.get(previous.id)! } : null
    return buildReadout({ ride: current, analysis }, prev, settings)
  }, [current, analysis, previous, analyses, settings])

  const showAdd = adding || (rides !== null && rides.length === 0)
  const max = maxHeartRate(settings)

  const removeRide = async (ride: Ride) => {
    await deleteRide(ride.id)
    const rest = (rides ?? []).filter((r) => r.id !== ride.id)
    setRides(rest)
    setSelectedId(rest[0]?.id ?? null)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files]
        if (files.length) addFiles(files)
      }}
    >
      <header className="top">
        <a
          className="brand"
          href="./"
          onClick={(e) => {
            e.preventDefault()
            setAdding(false)
            setAppleFile(null)
          }}
        >
          <Mark />
          Ride Readout
        </a>
        <p className="private">
          <span className="dot-ok" /> Your rides stay on this device
        </p>
        <button type="button" className="btn small" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <div className="shell">
        {rides && rides.length > 0 && (
          <nav className="rail" aria-label="Your rides">
            <button
              type="button"
              className="btn primary add-btn"
              onClick={() => {
                setAdding(true)
                setAppleFile(null)
              }}
            >
              + Add a ride
            </button>
            <ul>
              {rides.map((ride) => {
                const a = analyses.get(ride.id)!
                const active = !showAdd && ride.id === selectedId
                return (
                  <li key={ride.id}>
                    <button
                      type="button"
                      className={active ? 'ride-item active' : 'ride-item'}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(ride.id)
                        setAdding(false)
                        setAppleFile(null)
                        setHover(null)
                      }}
                    >
                      <span className="ride-date">{shortDate(ride.startTime)}</span>
                      <span className="ride-meta">
                        {fmt.dist(a.distanceM)}
                        {a.hasTime && ` · ${duration(a.movingS)}`}
                        {ride.source === 'sample' && ' · sample'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}

        <main className="main">
          {notices.map((n) => (
            <p key={n.id} className={`notice ${n.tone}`} role={n.tone === 'warn' ? 'alert' : 'status'}>
              <span>{n.text}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotices((list) => list.filter((x) => x.id !== n.id))}>
                ×
              </button>
            </p>
          ))}

          {rides === null && <p className="quiet">Opening your rides…</p>}

          {showAdd && appleFile && (
            <AppleImport
              file={appleFile}
              units={settings.units}
              onCancel={() => setAppleFile(null)}
              onRides={async (list, problems) => {
                problems.forEach((p) => notify('warn', p))
                await keepRides(list)
                setAppleFile(null)
                if (list.length > 0) setAdding(false)
              }}
            />
          )}

          {showAdd && !appleFile && (
            <AddRide
              busy={busy}
              hasRides={(rides?.length ?? 0) > 0}
              onFiles={addFiles}
              onSample={async () => {
                await keepRides(sampleRides())
                setAdding(false)
              }}
            />
          )}

          {!showAdd && current && analysis && readout && (
            <RideView
              key={current.id}
              ride={current}
              analysis={analysis}
              text={readoutText(readout)}
              onNote={(note) => {
                const next = { ...current, riderNote: note }
                saveRide(next)
                setRides((list) => (list ?? []).map((r) => (r.id === next.id ? next : r)))
              }}
              onDelete={() => removeRide(current)}
            >
              <ReadoutCard
                readout={readout}
                settings={settings}
                onSettings={updateSettings}
                others={(rides ?? []).filter((r) => r.id !== current.id)}
                compareId={compareWith[current.id] ?? null}
                onCompare={(id) => setCompareWith((m) => ({ ...m, [current.id]: id }))}
              />
              <RideCharts analysis={analysis} fmt={fmt} maxHr={max?.bpm ?? null} hover={hover} onHover={setHover} />
              <RouteSketch track={current.track} analysis={analysis} fmt={fmt} trimEnds={settings.trimEnds} hover={hover} />
            </RideView>
          )}
        </main>
      </div>

      <footer className="foot">
        <p>
          Ride Readout describes what happened on a ride. It doesn't coach, and it isn't medical advice. Effort ranges
          follow the{' '}
          <a href="https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates" target="_blank" rel="noreferrer">
            American Heart Association's target heart rates
          </a>
          .
        </p>
        <p>
          A Sheridan Interaction Design portfolio project by Yiyang Zhang, Johnny and Jie Zhou. Ridden with it?{' '}
          <a href={RIDER_FORM} target="_blank" rel="noreferrer">
            Tell us if the sentences were true
          </a>
          .
        </p>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        rideCount={rides?.length ?? 0}
        persistent={isPersistent()}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        onDeleteAll={async () => {
          await deleteAllRides()
          setRides([])
          setSelectedId(null)
          setSettingsOpen(false)
        }}
      />
    </div>
  )
}

type RideViewProps = {
  ride: Ride
  analysis: Analysis
  text: string
  onNote: (note: string) => void
  onDelete: () => void
  children: React.ReactNode
}

function RideView({ ride, text, onNote, onDelete, children }: RideViewProps) {
  const [note, setNote] = useState(ride.riderNote ?? '')
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [first, second, third] = Array.isArray(children) ? children : [children]

  const copy = async () => {
    const mine = note.trim() ? `\n\nIN MY OWN WORDS: ${note.trim()}` : ''
    try {
      await navigator.clipboard.writeText(text + mine)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="ride">
      {first}
      {second}
      <div className="lower">
        {third}
        <section className="card check-card">
          <p className="caption">
            <span>Rider check</span>
          </p>
          <label htmlFor="rider-note" className="check-q">
            In one sentence, what does this tell you about your ride?
          </label>
          <textarea
            id="rider-note"
            rows={3}
            value={note}
            placeholder="Was anything untrue, or not worth saying?"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (ride.riderNote ?? '')) onNote(note)
            }}
          />
          <p className="fine">
            Kept on this device with the ride. To help us test the wording, copy the readout and paste it into our{' '}
            <a href={RIDER_FORM} target="_blank" rel="noreferrer">
              rider form
            </a>
            .
          </p>
          <div className="check-actions">
            <button type="button" className="btn small" onClick={copy}>
              {copied ? 'Copied' : 'Copy the readout'}
            </button>
            {confirming ? (
              <>
                <button type="button" className="btn small danger" onClick={onDelete}>
                  Yes, delete this ride
                </button>
                <button type="button" className="btn small" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn small" onClick={() => setConfirming(true)}>
                Delete this ride…
              </button>
            )}
          </div>
          <p className="fine source">
            From {ride.source === 'fit' ? 'a .FIT file' : ride.source === 'gpx' ? 'a .GPX file' : ride.source === 'apple-export' ? 'an Apple Health export' : 'made-up sample data'}
            : {ride.fileName} · {ride.track.n.toLocaleString('en-US')} points
          </p>
        </section>
      </div>
    </div>
  )
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#111114" />
      <path d="M4 23 L11 13 L15 18 L21 9 L28 23 Z" fill="#dba28b" />
      <rect x="19.6" y="5" width="2.4" height="19" rx="1.2" fill="#6f61ff" />
    </svg>
  )
}
