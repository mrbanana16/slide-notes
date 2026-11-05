import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { api, ApiError, type Page, type PageSettings } from './api'
import { DraftStore } from './drafts'
import { NoteEditor, NotePreview } from './NoteEditor'
import { Divider, useLayoutSize } from './ReadingControls'
import { PdfPage } from './PdfPage'
import { categories, closestPage, rangePages, visiblePages, type Mode } from './reading'

type Props = {
  materialId: string; pages: Page[]; pdf: PDFDocumentProxy; store: DraftStore
  mode: Mode; onMode: (mode: Mode) => void; onSettings: (settings: PageSettings[]) => void
  reader: RefObject<HTMLElement | null>
}
export function Reader({ materialId, pages, pdf, store, mode, onMode, onSettings, reader }: Props) {
  const [layout, setLayout] = useState<'continuous' | 'single'>('continuous')
  const [current, setCurrent] = useState(1)
  const [category, setCategory] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [includeCollapsed, setIncludeCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toolsBar = useRef<HTMLDivElement>(null)
  const batchPanel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      for (const panel of toolsBar.current?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
        if (event instanceof KeyboardEvent) panel.querySelector('summary')?.focus()
        else if (event.target instanceof Node && panel.contains(event.target)) continue
        panel.open = false
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [])
  const [range, setRange] = useState('')
  const [batchCategory, setBatchCategory] = useState('')
  const [batchDisplay, setBatchDisplay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [batchError, setBatchError] = useState('')
  const [status, setStatus] = useState('')
  const split = useLayoutSize('slide-notes:pdf-percent', 60, 30, 72)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(false)
  const single = mode === 'immerse' || (mode === 'review' && layout === 'single')
  const shown = visiblePages(pages, category, showHidden, single, includeCollapsed)
  const active = shown.find(page => page.number === current) ?? closestPage(shown, current)
  const anchor = useRef<{ number: number; offset: number } | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())

  function capture() {
    const root = reader.current
    if (!root || single) return
    const top = root.getBoundingClientRect().top
    const row = shown.map(page => rows.current.get(page.id)).find(element => element && element.getBoundingClientRect().bottom > top + (root.querySelector('.toolbar')?.clientHeight ?? 0) + 2)
    if (row) {
      const number = Number(row.dataset.number)
      anchor.current = { number, offset: row.getBoundingClientRect().top - top }
      setCurrent(number)
    }
  }
  function navigate(number: number) {
    const target = closestPage(shown, number)
    if (!target) return
    anchor.current = { number: target.number, offset: 0 }
    setCurrent(target.number)
    if (!single) rows.current.get(target.id)?.scrollIntoView?.({ block: 'start' })
    else if (reader.current) reader.current.scrollTop = 0
  }
  function transition(change: () => void) { capture(); change() }
  function restorePosition() {
    if (single || !anchor.current) return
    const target = closestPage(shown, anchor.current.number)
    const row = target && rows.current.get(target.id)
    const root = reader.current
    if (row && root) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.current.offset
  }
  useLayoutEffect(() => {
    if (single) { if (active) setCurrent(active.number); if (reader.current) reader.current.scrollTop = 0; return }
    restorePosition()
  }, [mode, layout, category, showHidden, includeCollapsed])
  useEffect(() => {
    if (single || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => restorePosition())
    for (const row of rows.current.values()) observer.observe(row)
    return () => observer.disconnect()
  }, [single, shown.map(page => page.id).join(',')])
  useEffect(() => {
    const root = reader.current
    const onScroll = () => capture()
    root?.addEventListener('scroll', onScroll, { passive: true })
    return () => root?.removeEventListener('scroll', onScroll)
  }, [single, shown.map(page => page.id).join(',')])
  useEffect(() => {
    if (!single) return
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const protectedSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="separator"], [role="listbox"]'
      const protectedFocus = (element: EventTarget | null) => element instanceof Element && !!element.closest(protectedSelector)
      if (protectedFocus(event.target) || protectedFocus(document.activeElement)) return
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
      if (!direction) return
      const index = shown.findIndex(page => page.id === active?.id)
      const next = shown[index + direction]
      if (next) { event.preventDefault(); navigate(next.number) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [single, active?.id, shown.map(page => page.id).join(',')])
  async function saveSettings(targets: Page[], changes: object, batch = false) {
    if (busy || mode === 'review') return
    setBusy(true); setError(''); setBatchError(''); setStatus('')
    try {
      const result = await api<PageSettings[]>(`/api/materials/${materialId}/page-settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: targets.map(page => ({ id: page.id, version: page.settings_version ?? 0 })), ...changes }) })
      onSettings(result)
      if (batch && batchPanel.current) {
        batchPanel.current.open = false
        batchPanel.current.querySelector('summary')?.focus()
      }
      setStatus('页面属性已保存，原始页码与笔记保留。')
    } catch (cause) {
      const report = batch && batchPanel.current?.open ? setBatchError : setError
      report(cause instanceof Error ? cause.message : '页面属性保存失败，请重试。')
      if (cause instanceof ApiError && cause.status === 409) {
        try { onSettings(await api<PageSettings[]>(`/api/materials/${materialId}/pages`)) }
        catch { report('属性冲突且刷新失败，请重新加载课件后重试。笔记草稿仍保留。') }
      }
    } finally { setBusy(false) }
  }
  function applyBatch(event: FormEvent) {
    event.preventDefault()
    try {
      const targets = rangePages(pages, range)
      if (!batchCategory && !batchDisplay) throw new Error('请选择要修改的分类或显示状态。')
      const changes: { category?: string; display?: string } = {}
      if (batchCategory) changes.category = batchCategory
      if (batchDisplay) changes.display = batchDisplay
      void saveSettings(targets, changes, true)
    } catch (cause) {
      setBatchError((cause as Error).message)
    }
  }
  const settings = (page: Page) => mode !== 'review' && <div className="pageSettings"><label>分类<select aria-label={`第 ${page.number} 页分类`} disabled={busy} value={page.category ?? '正文'} onChange={event => void saveSettings([page], { category: event.target.value })}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>显示<select aria-label={`第 ${page.number} 页显示状态`} disabled={busy} value={page.display ?? 'normal'} onChange={event => void saveSettings([page], { display: event.target.value })}><option value="normal">正常</option><option value="collapsed">折叠</option><option value="hidden">隐藏</option></select></label></div>
  const rendered = single ? (active ? [active] : []) : shown
  return <>
    <div className="readingTools" ref={toolsBar} aria-label="阅读工具">
      {mode === 'immerse' && <button onClick={() => transition(() => onMode('organize'))}>退出沉浸</button>}
      {mode === 'review' && <><strong>只读复习</strong><button aria-pressed={!single} onClick={() => transition(() => setLayout('continuous'))}>连续阅读</button><button aria-pressed={single} onClick={() => transition(() => setLayout('single'))}>单页阅读</button></>}
      <details name="reader-tools" className="filterTools"><summary>筛选 · {category || '全部分类'}{showHidden && ' · 含隐藏页'}{single && includeCollapsed && ' · 含折叠页'}</summary><div className="filterFields">
      <label>分类筛选<select aria-label="分类筛选" value={category} onChange={event => transition(() => setCategory(event.target.value))}><option value="">全部分类</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={showHidden} onChange={event => transition(() => setShowHidden(event.target.checked))} />显示隐藏页</label>
      {single && <label><input type="checkbox" checked={includeCollapsed} onChange={event => transition(() => setIncludeCollapsed(event.target.checked))} />包含折叠页</label>}
      </div></details>
      <span role="status">当前第 {active?.number ?? '—'} 页 · 跳过 {pages.length - shown.length} 页</span>
      <label>跳转页码<input aria-label="跳转页码" type="number" min="1" max={pages.length} value={active?.number ?? ''} onChange={event => navigate(Number(event.target.value))} /></label>
      {single && <><small>← / ↑ 上一页 · → / ↓ 下一页</small><button disabled={!active || shown[0]?.id === active.id} onClick={() => navigate(shown[shown.indexOf(active!) - 1].number)}>上一页</button><button disabled={!active || shown.at(-1)?.id === active.id} onClick={() => navigate(shown[shown.indexOf(active!) + 1].number)}>下一页</button><label>缩放<select aria-label="课件缩放" value={fit ? 'fit' : zoom} onChange={event => { setFit(event.target.value === 'fit'); if (event.target.value !== 'fit') setZoom(Number(event.target.value)) }}><option value="fit">适应页面</option>{[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label></>}
      {mode !== 'review' && <details name="reader-tools" ref={batchPanel} className="batchPanel">
        <summary>批量操作</summary>
        <form className="batchTools" onSubmit={applyBatch}>
          <label>批量页码<input aria-label="批量页码" placeholder="1-3,5（原始页码）" value={range} onChange={e => setRange(e.target.value)} /></label>
          <label>批量分类<select aria-label="批量分类" value={batchCategory} onChange={e => setBatchCategory(e.target.value)}>
            <option value="">保持分类</option>{categories.map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>批量显示<select aria-label="批量显示" value={batchDisplay} onChange={e => setBatchDisplay(e.target.value)}>
            <option value="">保持显示状态</option><option value="normal">正常</option><option value="collapsed">折叠</option><option value="hidden">隐藏</option>
          </select></label>
          <button disabled={busy}>应用到页码范围</button>
          {batchError && <small role="alert" className="error">{batchError}</small>}
        </form>
      </details>}
    </div>
    {busy && <p role="status">正在保存页面属性…</p>}{error && <p role="alert" className="errorBanner">{error}</p>}{status && <p role="status">{status}</p>}
    {!shown.length && <div className="emptyState"><p>没有符合条件的页面，笔记与原始页码仍保留。</p><button onClick={() => { setCategory(''); setShowHidden(true); setIncludeCollapsed(true) }}>显示全部页面</button></div>}
    {rendered.map(page => <article className="pageRow" key={page.id} data-number={page.number} ref={element => { if (element) rows.current.set(page.id, element); else rows.current.delete(page.id) }}>
      <div className="pageLabel"><strong>第 {page.number} 页</strong><span>{page.category ?? '正文'} · {page.display === 'hidden' ? '隐藏' : page.display === 'collapsed' ? '折叠' : '正常'}</span>{settings(page)}{!single && page.display === 'collapsed' && <button aria-expanded={expanded.has(page.id)} onClick={() => setExpanded(old => { const next = new Set(old); if (next.has(page.id)) next.delete(page.id); else next.add(page.id); return next })}>{expanded.has(page.id) ? '收起页面' : '临时展开'}</button>}</div>
      {(single || page.display !== 'collapsed' || expanded.has(page.id)) && <div className={`pageColumns ${single ? 'singlePage' : ''}`} style={{ '--pdf-width': split.value + '%' } as CSSProperties}><PdfPage pdf={pdf} number={page.number} zoom={single ? zoom : 1} fit={single && fit} /><Divider label={`第 ${page.number} 页课件宽度`} size={split} percent />{mode === 'review' ? <NotePreview page={page} store={store} /> : <NoteEditor page={page} store={store} />}</div>}
    </article>)}
  </>
}
