import { useLayoutEffect, useRef, useState } from 'react'

/** The rendered width of an element, so SVG charts can draw at true pixel size. */
export function useWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
