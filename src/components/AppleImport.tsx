import { useEffect, useMemo, useRef, useState } from 'react'
import { AppleExport, buildChoices, type AppleRoute, type AppleWorkout } from '../lib/appleExport'
import { clockTime, makeFmt, rideDate } from '../lib/format'
import type { Ride, Units } from '../lib/types'

type Props = {
  file: File
  units: Units
  onRides: (rides: Ride[], problems: string[]) => void
  onCancel: () => void
}

type Phase = 'opening' | 'scanning' | 'ready' | 'adding' | 'error'

const megabytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`)

/** Pick rides out of an Apple Health export without ever loading the whole file. */
export function AppleImport({ file, units, onRides, onCancel }: Props) {
  const fmt = makeFmt(units)
  const [phase, setPhase] = useState<Phase>('opening')
  const [error, setError] = useState('')
  const [routes, setRoutes] = useState<AppleRoute[]>([])
  const [workouts, setWorkouts] = useState<AppleWorkout[] | null>(null)
  const [xmlBytes, setXmlBytes] = useState(0)
  const [heartSamples, setHeartSamples] = useState(0)
  const [progress, setProgress] = useState(0)
  /** null until the rider changes the ticks; until then the three most recent rides are ticked. */
  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [added, setAdded] = useState(0)
  const reader = useRef<AppleExport | null>(null)

  useEffect(() => {
    const exportReader = new AppleExport(file, (event) => {
      if (event.type === 'listed') {
        setRoutes(event.routes)
        setXmlBytes(event.xmlBytes)
        setPhase(event.xmlBytes > 0 ? 'scanning' : 'ready')
      } else if (event.type === 'progress') {
        setProgress(event.total > 0 ? event.done / event.total : 0)
      } else if (event.type === 'scanned') {
        setWorkouts(event.workouts.length ? event.workouts : null)
        setHeartSamples(event.heartSamples)
        setPhase('ready')
      } else {
        setError(event.message)
        setPhase('error')
      }
    })
    reader.current = exportReader
    return () => exportReader.close()
  }, [file])

  const choices = useMemo(() => buildChoices(routes, workouts), [routes, workouts])
  const cyclingCount = useMemo(() => choices.filter((c) => c.cycling).length, [choices])
  const filtered = showAll || cyclingCount === 0 ? choices : choices.filter((c) => c.cycling)

  // Start with the three most recent rides ticked, so one click gets a comparison.
  const picked = useMemo(() => {
    if (chosen) return chosen
    const rides = cyclingCount > 0 ? choices.filter((c) => c.cycling) : choices
    return new Set(rides.slice(0, 3).map((c) => c.key))
  }, [chosen, choices, cyclingCount])

  const toggle = (key: string) => {
    const next = new Set(picked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setChosen(next)
  }

  const addPicked = async () => {
    const list = choices.filter((c) => picked.has(c.key))
    if (!reader.current || list.length === 0) return
    setPhase('adding')
    setAdded(0)
    const rides: Ride[] = []
    const problems: string[] = []
    for (const choice of list) {
      try {
        rides.push(await reader.current.loadRide(choice))
      } catch (err) {
        problems.push(`${choice.routeName}: ${err instanceof Error ? err.message : String(err)}`)
      }
      setAdded((n) => n + 1)
    }
    onRides(rides, problems)
  }

  return (
    <section className="card apple" aria-label="Apple Health export">
      <header className="apple-head">
        <div>
          <p className="eyebrow">Apple Health export · {megabytes(file.size)}</p>
          <h2>{file.name}</h2>
        </div>
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </header>

      {phase === 'opening' && <p className="quiet">Opening the zip's index. The file stays where it is.</p>}

      {phase === 'scanning' && (
        <div className="scan">
          <p>
            Found {routes.length} recorded routes. Now reading through export.xml ({megabytes(xmlBytes)}) for your
            workouts and heart rate. This takes a little while, and nothing is uploaded.
          </p>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="fine">{Math.round(progress * 100)}%</p>
        </div>
      )}

      {phase === 'error' && (
        <p className="notice warn" role="alert">
          {error}
        </p>
      )}

      {(phase === 'ready' || phase === 'adding') && (
        <>
          <p className="apple-sum">
            {workouts
              ? `${cyclingCount} bike ${cyclingCount === 1 ? 'ride' : 'rides'} with a route`
              : `${choices.length} recorded routes`}
            {workouts && heartSamples > 0 && `, and ${heartSamples.toLocaleString('en-US')} heart-rate readings to match to them`}
            {!workouts && xmlBytes === 0 && ". There's no export.xml in this zip, so I can't tell rides from walks or add heart rate"}
            . Pick the rides to add.
          </p>
          {workouts && choices.length > cyclingCount && cyclingCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Also show {choices.length - cyclingCount} routes that aren't bike rides (walks, runs…)
            </label>
          )}
          <ul className="apple-list">
            {filtered.map((c) => (
              <li key={c.key}>
                <label>
                  <input type="checkbox" checked={picked.has(c.key)} disabled={phase === 'adding'} onChange={() => toggle(c.key)} />
                  <span className="when">{c.when ? rideDate(c.when) : c.routeName}</span>
                  <span className="quiet">{c.when ? clockTime(c.when) : ''}</span>
                  <span className="quiet num">{c.distanceM !== null ? fmt.dist(c.distanceM) : ''}</span>
                  {c.cycling === false && <span className="tag">not a ride</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="apple-foot">
            <button type="button" className="btn primary" disabled={picked.size === 0 || phase === 'adding'} onClick={addPicked}>
              {phase === 'adding'
                ? `Reading ${Math.min(added + 1, picked.size)} of ${picked.size}…`
                : `Add ${picked.size} ${picked.size === 1 ? 'ride' : 'rides'}`}
            </button>
            <button type="button" className="btn" disabled={phase === 'adding'} onClick={() => setChosen(new Set())}>
              Clear
            </button>
          </div>
        </>
      )}
    </section>
  )
}
