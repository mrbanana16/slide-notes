import { useEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

export function PdfPage({ pdf, number }: { pdf: PDFDocumentProxy; number: number }) {
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
    void pdf.getPage(number).then(page => {
      if (stopped) return
      const draw = async () => {
        render?.cancel()
        text?.cancel()
        element.replaceChildren()
        const scale = Math.max(1, element.clientWidth) / page.getViewport({ scale: 1 }).width
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
      let width = 0
      observer = new ResizeObserver(() => {
        if (element.clientWidth !== width) { width = element.clientWidth; void draw() }
      })
      observer.observe(element)
    }).catch(() => { if (!stopped) setError('此页无法读取，请重新导出 PDF。') })
    return () => { stopped = true; observer?.disconnect(); render?.cancel(); text?.cancel(); element.replaceChildren() }
  }, [pdf, number, visible])
  return <div className="pdfSurface"><div ref={container} className="pdfPage" />{error && <p role="alert">{error}</p>}</div>
}
