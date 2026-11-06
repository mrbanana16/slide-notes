import { FilePdfOutlined } from '@ant-design/icons'
import { useState, type PointerEvent } from 'react'

export function PdfIcon() {
  return <FilePdfOutlined className="pdfIcon" aria-hidden="true" />
}

export function useLayoutSize(key: string, initial: number, min: number, max: number) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const [value, set] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved && Number.isFinite(Number(saved))) return clamp(Number(saved))
    } catch { /* Use the default when storage is unavailable. */ }
    return initial
  })
  function update(next: number, persist: boolean) {
    next = clamp(Math.round(next))
    set(next)
    if (persist) {
      try { localStorage.setItem(key, String(next)) } catch { /* Keep the session preference. */ }
    }
  }
  return { value, min, max, update }
}

export function Divider({ label, size, percent = false }: { label: string; size: ReturnType<typeof useLayoutSize>; percent?: boolean }) {
  function position(event: PointerEvent<HTMLDivElement>, persist: boolean) {
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    if (rect.width) size.update((event.clientX - rect.left) * (percent ? 100 / rect.width : 1), persist)
  }
  return <div className="sizeDivider" tabIndex={0} role="separator" aria-label={label} aria-orientation="vertical"
    aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={size.value} aria-valuetext={size.value + (percent ? '%' : ' 像素')}
    onPointerDown={e => { if (e.button === 0) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId) } }}
    onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) position(e, false) }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) position(e, true) }}
    onKeyDown={e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      size.update(size.value + (e.key === 'ArrowLeft' ? -1 : 1) * (percent ? 2 : 12), true)
    }} />
}
