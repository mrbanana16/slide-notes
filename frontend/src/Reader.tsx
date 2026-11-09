import { Button, Empty, InputNumber, Segmented, Select, Space, Tooltip } from 'antd'
import { DownOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { api, ApiError, type Page, type PageSettings } from './api'
import { DraftStore } from './drafts'
import { NoteEditor, NotePreview } from './NoteEditor'
import { Divider, useLayoutSize } from './ReadingControls'
import { PdfPage } from './PdfPage'
import { closestPage, type Mode } from './reading'

type Props = {
  materialId: string; pages: Page[]; pdf: PDFDocumentProxy; store: DraftStore
  mode: Mode; onMode: (mode: Mode) => void; onSettings: (settings: PageSettings[]) => void
  onFailure: (message: string) => void
  reader: RefObject<HTMLElement | null>; pageNavigator: RefObject<HTMLDivElement | null>
}
function ReaderNotes({ page, store, review, nearby }: { page: Page; store: DraftStore; review: boolean; nearby: boolean }) {
  const slot = useRef<HTMLDivElement>(null)
  const height = useRef(0)
  const view = useRef(new Map<string, boolean>())
  const [focused, setFocused] = useState(false)
  const mounted = nearby || focused

  useLayoutEffect(() => {
    const panel = slot.current?.firstElementChild
    if (!mounted || !panel || typeof ResizeObserver === 'undefined') return
    const measure = () => { height.current = panel.getBoundingClientRect().height }
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    measure()
    return () => observer.disconnect()
  }, [mounted])

  return <div ref={slot} className="noteSlot" style={mounted ? undefined : { minHeight: height.current || 320 }}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    {mounted && (review ? <NotePreview page={page} store={store} view={view.current} /> : <NoteEditor page={page} store={store} view={view.current} />)}
  </div>
}

export function Reader({ materialId, pages, pdf, store, mode, onMode, onSettings, reader, pageNavigator, onFailure }: Props) {
  const [layout, setLayout] = useState<'continuous' | 'single'>('continuous')
  const [current, setCurrent] = useState(1)
  const [saving, setSaving] = useState<string | null>(null)
  const [pageDraft, setPageDraft] = useState<number | string | null>(null)
  const [editingPage, setEditingPage] = useState(false)
  const split = useLayoutSize('slide-notes:pdf-percent', 60, 30, 72)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(false)
  const single = mode === 'immerse' || (mode === 'review' && layout === 'single')
  const shown = pages
  const active = shown.find(page => page.number === current) ?? closestPage(shown, current)
  const anchor = useRef<{ number: number; offset: number } | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())
  const pageIds = shown.map(page => page.id).join(',')
  const [nearby, setNearby] = useState<Set<string>>(() => new Set())
  const noteLayoutAnchor = useRef<{ number: number; offset: number; scrollTop: number } | null>(null)
  useEffect(() => {
    if (!editingPage) setPageDraft(active?.number ?? null)
  }, [active?.number, editingPage])

  function capture() {
    const root = reader.current
    if (!root || single) return
    const top = root.getBoundingClientRect().top
    const edge = top + (root.querySelector('.toolbar')?.clientHeight ?? 0) + 2
    let first = 0
    let end = shown.length
    while (first < end) {
      const index = Math.floor((first + end) / 2)
      const row = rows.current.get(shown[index].id)
      if (row && row.getBoundingClientRect().bottom > edge) end = index
      else first = index + 1
    }
    const page = shown[first]
    const row = page && rows.current.get(page.id)
    if (row) {
      const position = { number: page.number, offset: row.getBoundingClientRect().top - top, scrollTop: root.scrollTop }
      anchor.current = position
      setCurrent(page.number)
      return position
    }
  }
  function navigate(number: number) {
    const target = closestPage(shown, number)
    if (!target) return
    const root = reader.current
    noteLayoutAnchor.current = null
    anchor.current = { number: target.number, offset: (root?.querySelector('.toolbar')?.clientHeight || 64) + 12 }
    setCurrent(target.number)
    if (!single) rows.current.get(target.id)?.scrollIntoView?.({ block: 'start' })
    else if (root) root.scrollTop = 0
  }
  function submitPage() {
    const number = Number(pageDraft)
    if (Number.isInteger(number) && number >= 1 && number <= pages.length) navigate(number)
    setEditingPage(false)
  }
  function transition(change: () => void) { capture(); change() }
  function restorePosition(position = anchor.current) {
    if (single || !position) return
    const target = closestPage(shown, position.number)
    const row = target && rows.current.get(target.id)
    const root = reader.current
    if (row && root) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - position.offset
  }
  useLayoutEffect(() => {
    if (single) { if (active) setCurrent(active.number); if (reader.current) reader.current.scrollTop = 0; return }
    restorePosition()
  }, [mode, layout])
  useEffect(() => {
    if (single || typeof ResizeObserver === 'undefined') return
    const root = reader.current
    if (!root) return
    let width = root.clientWidth
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width) return
      width = root.clientWidth
      restorePosition()
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [single, pageIds])
  useEffect(() => {
    const root = reader.current
    const onScroll = () => capture()
    root?.addEventListener('scroll', onScroll, { passive: true })
    return () => root?.removeEventListener('scroll', onScroll)
  }, [single, pageIds])
  useLayoutEffect(() => {
    const position = noteLayoutAnchor.current
    noteLayoutAnchor.current = null
    if (position && reader.current?.scrollTop === position.scrollTop) restorePosition(position)
  }, [nearby])

  useEffect(() => {
    const root = reader.current
    if (single || !root || typeof IntersectionObserver === 'undefined') return
    let stopped = false
    const observer = new IntersectionObserver(changes => {
      if (stopped) return
      noteLayoutAnchor.current = capture() ?? null
      setNearby(previous => {
        const next = new Set(previous)
        for (const change of changes) {
          const id = (change.target as HTMLElement).dataset.pageId!
          if (change.isIntersecting) next.add(id)
          else next.delete(id)
        }
        return next
      })
    }, { root, rootMargin: '600px 0px' })
    for (const row of rows.current.values()) observer.observe(row)
    return () => { stopped = true; observer.disconnect() }
  }, [single, pageIds])

  useEffect(() => {
    if (!single) return
    const key = (event: KeyboardEvent) => {
      if (reader.current?.inert || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const protectedSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="separator"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="menu"], .ant-segmented'
      const protectedFocus = (element: EventTarget | null) => element instanceof Element && !!element.closest(protectedSelector)
      if (protectedFocus(event.target) || protectedFocus(document.activeElement)) return
      if (document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden), .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-modal-wrap:not([style*="display: none"])')) return
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
      if (!direction) return
      const index = shown.findIndex(page => page.id === active?.id)
      const next = shown[index + direction]
      if (next) { event.preventDefault(); navigate(next.number) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [single, active?.id, pageIds])
  async function togglePage(page: Page) {
    if (saving) return
    setSaving(page.id)
    try {
      const result = await api<PageSettings[]>(`/api/materials/${materialId}/page-settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: [{ id: page.id, version: page.settings_version ?? 0 }], display: page.display === 'collapsed' ? 'normal' : 'collapsed' }) })
      onSettings(result)
    } catch (cause) {
      onFailure(cause instanceof Error ? cause.message : '页面显示状态保存失败，请重试。')
      if (cause instanceof ApiError && cause.status === 409) {
        try { onSettings(await api<PageSettings[]>(`/api/materials/${materialId}/pages`)) }
        catch { onFailure('状态冲突且刷新失败，请重新加载课件后重试。笔记草稿仍保留。') }
      }
    } finally { setSaving(null) }
  }
  const rendered = single ? (active ? [active] : []) : shown
  const pageIndicator = <div className="topPageNavigator" aria-label="当前页码">
    <InputNumber aria-label="跳转页码" style={{ width: `calc(${Math.max(3, String(pages.length).length)}ch + 16px)` }} min={1} max={pages.length} precision={0} controls={false} value={editingPage ? pageDraft : active?.number ?? null}
      onFocus={() => setEditingPage(true)} onChange={value => setPageDraft(value)} onPressEnter={submitPage}
      onBlur={() => { setEditingPage(false); setPageDraft(active?.number ?? null) }}
      onKeyDown={event => { if (event.key === 'Escape') { setEditingPage(false); setPageDraft(active?.number ?? null); event.currentTarget.blur() } }} />
    <span aria-hidden="true">/ {pages.length}</span>
  </div>
  return <>
    {pageNavigator.current && createPortal(pageIndicator, pageNavigator.current)}
    <div className="readingTools" aria-label="阅读工具">
      {mode === 'immerse' && <Button onClick={() => transition(() => onMode('organize'))}>退出沉浸</Button>}
      {mode === 'review' && <><strong>只读复习</strong><Segmented aria-label="阅读布局" value={layout} options={[{ label: '连续阅读', value: 'continuous' }, { label: '单页阅读', value: 'single' }]} onChange={value => transition(() => setLayout(value as 'continuous' | 'single'))} /></>}
      {single && <><small>← / ↑ 上一页 · → / ↓ 下一页</small><Space.Compact>
        <Button icon={<LeftOutlined />} disabled={!active || shown[0]?.id === active.id} onClick={() => navigate(shown[shown.indexOf(active!) - 1].number)}>上一页</Button>
        <Button icon={<RightOutlined />} disabled={!active || shown.at(-1)?.id === active.id} onClick={() => navigate(shown[shown.indexOf(active!) + 1].number)}>下一页</Button>
      </Space.Compact><label>缩放<Select aria-label="课件缩放" value={fit ? 'fit' : zoom} options={[{ value: 'fit', label: '适应页面' }, ...[0.75, 1, 1.25, 1.5, 2].map(value => ({ value, label: `${value * 100}%` }))]} onChange={value => { setFit(value === 'fit'); if (value !== 'fit') setZoom(Number(value)) }} /></label></>}
    </div>
    {!pages.length && <Empty description="课件中没有页面。" />}
    {rendered.map(page => <article className="pageRow" key={page.id} data-number={page.number} data-page-id={page.id} ref={element => { if (element) rows.current.set(page.id, element); else rows.current.delete(page.id) }}>
      <div className="pageLabel">
        <Tooltip title={page.display === 'collapsed' ? '展开页面' : '折叠页面'}>
          <Button type="text" size="small" className="pageFoldToggle" aria-label={`${page.display === 'collapsed' ? '展开' : '折叠'}第 ${page.number} 页`} aria-expanded={page.display !== 'collapsed'} disabled={!!saving} loading={saving === page.id}
            icon={page.display === 'collapsed' ? <RightOutlined /> : <DownOutlined />} onClick={() => void togglePage(page)} />
        </Tooltip>
        <strong>第 {page.number} 页</strong>
      </div>
      <div className="pageReveal" data-collapsed={page.display === 'collapsed'}><div inert={page.display === 'collapsed'} className={`pageColumns ${single ? 'singlePage' : ''}`} style={{ '--pdf-width': split.value + '%' } as CSSProperties}><PdfPage pdf={pdf} number={page.number} zoom={single ? zoom : 1} fit={single && fit} /><Divider label={`第 ${page.number} 页课件宽度`} size={split} percent /><ReaderNotes key={mode === 'review' ? 'review' : 'edit'} page={page} store={store} review={mode === 'review'}
        nearby={single || typeof IntersectionObserver === 'undefined' || nearby.has(page.id) || page.id === active?.id} /></div></div>
    </article>)}
  </>
}
