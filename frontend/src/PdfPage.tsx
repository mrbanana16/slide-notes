import { useEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

export function PdfPage({ pdf, number, zoom = 1, fit = false }: { pdf: PDFDocumentProxy; number: number; zoom?: number; fit?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '600px' })
    observer.observe(container.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !container.current) return
    const element = container.current
    let stopped = false
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let text: TextLayer | undefined
    let observer: ResizeObserver | undefined
    let onResize: (() => void) | undefined
    void pdf.getPage(number).then(page => {
      if (stopped) return
      const draw = async () => {
        render?.cancel()
        text?.cancel()
        element.replaceChildren()
        const original = page.getViewport({ scale: 1 })
        const available = Math.max(1, element.parentElement!.clientWidth)
        const scale = fit ? Math.min(available / original.width, Math.max(160, window.innerHeight - 300) / original.height) : available * zoom / original.width
        element.style.width = `${original.width * scale}px`
        const viewport = page.getViewport({ scale })
        element.style.aspectRatio = `${viewport.width} / ${viewport.height}`
        element.style.setProperty('--scale-factor', String(scale))
        element.style.setProperty('--total-scale-factor', String(scale * page.userUnit))
        const canvas = document.createElement('canvas')
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.setAttribute('aria-label', `课件第 ${number} 页`)
        const layer = document.createElement('div')
        layer.className = 'textLayer'
        element.append(canvas, layer)
        render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
        try {
          await Promise.all([render.promise, text.render()])
          if (!stopped) setError('')
        } catch (cause) {
          if (!stopped && !(cause instanceof Error && /cancel/i.test(cause.name + cause.message))) setError('此页显示失败，请重新打开课件。')
        }
      }
      let dimensions = ''
      onResize = () => {
        const next = `${element.parentElement!.clientWidth}:${window.innerHeight}`
        if (next !== dimensions) { dimensions = next; void draw() }
      }
      observer = new ResizeObserver(onResize)
      observer.observe(element.parentElement!)
      window.addEventListener('resize', onResize)
    }).catch(() => { if (!stopped) setError('此页无法读取，请重新导出 PDF。') })
    return () => { stopped = true; if (onResize) window.removeEventListener('resize', onResize); observer?.disconnect(); render?.cancel(); text?.cancel(); element.replaceChildren() }
  }, [pdf, number, visible, zoom, fit])
  return <div className="pdfSurface"><div className="pdfViewport"><div ref={container} className="pdfPage" /></div>{error && <p role="alert">{error}</p>}</div>
}
