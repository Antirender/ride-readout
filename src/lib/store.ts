import type { Ride } from './types'

/**
 * Rides are kept in IndexedDB, in this browser only. Nothing is uploaded.
 * If the browser refuses storage (some private windows do), rides simply
 * last until the tab is closed.
 */

const DB_NAME = 'ride-readout'
const STORE = 'rides'

let dbPromise: Promise<IDBDatabase> | null = null
const memory = new Map<string, Ride>()
let useMemory = false

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Storage is blocked'))
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function guarded<T>(viaDb: () => Promise<T>, viaMemory: () => T): Promise<T> {
  if (useMemory) return viaMemory()
  try {
    return await viaDb()
  } catch {
    useMemory = true
    return viaMemory()
  }
}

export function loadRides(): Promise<Ride[]> {
  return guarded(
    () => run<Ride[]>('readonly', (s) => s.getAll()),
    () => [...memory.values()],
  )
}

export function saveRide(ride: Ride): Promise<void> {
  memory.set(ride.id, ride)
  return guarded(
    async () => void (await run('readwrite', (s) => s.put(ride))),
    () => undefined,
  )
}

export function deleteRide(id: string): Promise<void> {
  memory.delete(id)
  return guarded(
    async () => void (await run('readwrite', (s) => s.delete(id))),
    () => undefined,
  )
}

export function deleteAllRides(): Promise<void> {
  memory.clear()
  return guarded(
    async () => void (await run('readwrite', (s) => s.clear())),
    () => undefined,
  )
}

/** True when rides will survive closing the tab. */
export function isPersistent(): boolean {
  return !useMemory
}
