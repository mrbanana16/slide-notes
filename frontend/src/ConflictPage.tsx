import { useEffect, useRef, useState } from 'react'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { Button } from 'antd'
import { type Material } from './api'
import { type DraftStore, type Entry } from './drafts'
import { NoteEditor } from './NoteEditor'
import { PdfPage } from './PdfPage'

export function ConflictPage({ material, entry, number, store, onReturn }: {
  material: Material; entry: Entry; number: number; store: DraftStore; onReturn: () => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    let active = true
    const task = getDocument({ url: '/api/materials/' + material.id + '/file', cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' })
    void task.promise.then(doc => { if (active) setPdf(doc) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; void task.destroy() }
  }, [material.id])
  useEffect(() => {
    const section = entry.kind === 'qa' ? [...panel.current!.querySelectorAll<HTMLElement>('[data-entry]')].find(el => el.dataset.entry === entry.url)
      : panel.current?.querySelectorAll('.noteSection')[entry.kind === 'note' ? 1 : 0]
    section?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [entry.url])
  const page = { id: entry.pageId, number }
  return <section ref={panel} className="conflictPage" aria-label="冲突页整理">
    <Button onClick={onReturn}>返回原阅读位置</Button><h2>{material.filename} · 第 {number} 页</h2>
    <div className="conflictColumns"><div>{pdf && <PdfPage pdf={pdf} number={number} />}{failed && <p>课件预览加载失败，仍可核对笔记版本。</p>}</div>
      <NoteEditor page={page} store={store} focusKind={entry.kind} /></div>
  </section>
}
