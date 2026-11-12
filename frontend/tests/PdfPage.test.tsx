import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from '../src/PdfPage'

vi.mock('pdfjs-dist', () => ({ TextLayer: class { render = () => Promise.resolve(); cancel = vi.fn() } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('scales canvas and text viewport together, fits page height, and redraws after window resize', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]) }
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe() { this.callback() }
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.stubGlobal('innerHeight', 1000)
  vi.stubGlobal('devicePixelRatio', 1)
  const draw = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  const pdf = { getPage: vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    userUnit: 1, render: draw, streamTextContent: vi.fn(),
  })) } as unknown as PDFDocumentProxy
  const view = render(<PdfPage pdf={pdf} number={1} zoom={2} />)
  await waitFor(() => expect(view.container.querySelector('canvas')?.width).toBe(1200))
  expect(view.container.querySelector<HTMLElement>('.pdfPage')?.style.getPropertyValue('--scale-factor')).toBe('2')
  view.rerender(<PdfPage pdf={pdf} number={1} fit />)
  await waitFor(() => expect(view.container.querySelector('canvas')?.width).toBe(525))
  expect(view.container.querySelector<HTMLElement>('.pdfPage')?.style.getPropertyValue('--scale-factor')).toBe('0.875')
  vi.stubGlobal('innerHeight', 700)
  window.dispatchEvent(new Event('resize'))
  await waitFor(() => expect(view.container.querySelector('canvas')?.width).toBe(300))
  expect(draw).toHaveBeenCalledTimes(3)
})
