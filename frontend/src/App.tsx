import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api, type Material, type Page } from './api'
import { NoteEditor, type Draft } from './NoteEditor'
import { PdfPage } from './PdfPage'
import './styles.css'

GlobalWorkerOptions.workerSrc = workerUrl

export default function App() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selected, setSelected] = useState<Material | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [resetting, setResetting] = useState(false)
  const operation = useRef(false)
  const loadGeneration = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const reader = useRef<HTMLElement>(null)
  const dirtyCount = Object.values(drafts).filter(draft => draft.text !== draft.saved).length

  async function loadMaterials() {
    const generation = loadGeneration.current
    setLoading(true)
    try {
      const result = await api<Material[]>('/api/materials')
      if (generation !== loadGeneration.current) return
      setMaterials(result); setError('')
    }
    catch (cause) { if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : '课件列表加载失败。') }
    finally { if (generation === loadGeneration.current) setLoading(false) }
  }
  useEffect(() => { void loadMaterials() }, [])
  useEffect(() => {
    if (!dirtyCount) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyCount])
  useEffect(() => {
    if (!selected) return
    let stopped = false
    const generation = loadGeneration.current
    setPdf(null)
    setPages([])
    setError('')
    setDocumentLoading(true)
    if (reader.current) reader.current.scrollTop = 0
    const task = getDocument({ url: `/api/materials/${selected.id}/file`, cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' })
    void Promise.all([api<Page[]>(`/api/materials/${selected.id}/pages`), task.promise]).then(([nextPages, doc]) => {
      if (stopped || generation !== loadGeneration.current) return
      setPages(nextPages)
      setDrafts(previous => {
        const next = { ...previous }
        for (const page of nextPages) {
          if (!next[page.id] || next[page.id].text === next[page.id].saved) next[page.id] = { text: page.note, saved: page.note, version: page.version }
        }
        return next
      })
      setPdf(doc)
    }).catch(cause => { if (!stopped && generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : '课件加载失败。') })
      .finally(() => { if (!stopped && generation === loadGeneration.current) setDocumentLoading(false) })
    return () => { stopped = true; void task.destroy() }
  }, [selected])

  async function upload(file?: File) {
    if (!file || operation.current) return
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('请选择 PDF 文件。'); return }
    if (file.size > 100 * 1024 * 1024) { setError('文件超过 100 MB 限制。'); return }
    operation.current = true
    setUploading(true)
    setNotice('')
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { duplicate, ...material } = await api<Material & { duplicate?: boolean }>('/api/materials', { method: 'POST', body: form })
      setMaterials(previous => previous.some(item => item.id === material.id) ? previous : [...previous, material])
      if (duplicate) setNotice('该课件已导入，已打开已有课件，笔记保持不变。')
      setSelected(material)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试。') }
    finally { operation.current = false; setUploading(false); if (input.current) input.current.value = '' }
  }

  async function resetAllData() {
    if (operation.current) return
    if (!window.confirm('清空全部数据？所有课件、原始 PDF、已保存笔记和当前未保存内容都将永久删除，无法撤销。')) return
    operation.current = true
    loadGeneration.current += 1
    setResetting(true)
    setError('')
    setNotice('')
    try {
      await api<{ reset: boolean }>('/api/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE_ALL_DATA' }),
      })
      setSelected(null)
      setPdf(null)
      setPages([])
      setMaterials([])
      setDrafts({})
      setLoading(false)
      setDocumentLoading(false)
      setNotice('全部数据已清空，可以重新导入课件。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败，请重试。')
      setDocumentLoading(false)
    } finally { operation.current = false; setResetting(false) }
  }

  return <div className={`workspace ${sidebar ? '' : 'sidebarClosed'}`}>
    <aside className="sidebar" aria-label="课件目录">
      <div className="brand"><span className="brandMark" aria-hidden="true">页</span><div><strong>课件笔记</strong><small>把理解留在每一页</small></div></div>
      <div className="directoryHeading">我的课件 <span>{materials.length}</span></div>
      <nav>{materials.map(material => <button key={material.id} className={`material ${selected?.id === material.id ? 'selected' : ''}`} disabled={resetting} onClick={() => setSelected(material)} aria-current={selected?.id === material.id ? 'page' : undefined}><span className="fileIcon" aria-hidden="true">▤</span><span><strong>{material.filename}</strong><small>{material.page_count} 页</small></span></button>)}</nav>
      {!loading && !materials.length && <p className="directoryEmpty">导入第一份 PDF，<br />开始逐页整理。</p>}
      <div className="sidebarBottom"><button className="primary" disabled={uploading || resetting} onClick={() => input.current?.click()}>{uploading ? '正在导入…' : '＋ 导入 PDF'}</button><p>课件与笔记保存在本机</p><button className="dangerButton" disabled={uploading || resetting || loading} onClick={() => void resetAllData()}>{resetting ? '正在清空…' : '清空全部数据'}</button></div>
    </aside>
    <header className="toolbar"><button className="sidebarToggle" aria-label={sidebar ? '收起目录' : '展开目录'} onClick={() => setSidebar(value => !value)}>☰</button><div className="breadcrumb">{selected ? <><span>我的课件 /</span> <strong>{selected.filename}</strong></> : <strong>学习工作台</strong>}</div><span className="mode">整理</span><span className="globalStatus" role="status">{dirtyCount ? `${dirtyCount} 页未保存` : '所有笔记已保存'}</span></header>
    <main ref={reader} className="reader" onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]) }}>
      {resetting && <p role="status" className="loading">正在清空全部数据…</p>}
      {notice && <div className="noticeBanner" role="status">{notice}</div>}
      {dragging && <div className="dropOverlay">松开以导入 PDF</div>}
      {error && <div className="errorBanner" role="alert">{error} <button onClick={() => selected ? setSelected({ ...selected }) : void loadMaterials()}>重新加载</button></div>}
      {loading && <p className="loading" role="status">正在读取课件目录…</p>}
      {!selected && !loading && <div className="emptyState"><div className="emptyPage" aria-hidden="true"><span /><span /><span /></div><h1>从一份课件开始</h1><p>课件在左，理解在右。<br />逐页阅读，把重点写成自己的笔记。</p><button className="primary" disabled={uploading || resetting} onClick={() => input.current?.click()}>{uploading ? '正在校验并导入…' : '导入 PDF 课件'}</button><small>也可将 PDF 拖到这里 · 最大 100 MB</small>{materials.length > 0 && <p>或从左侧目录打开已有课件。</p>}</div>}
      {selected && !resetting && <><div className="documentHeading"><div><h1>{selected.filename.replace(/\.pdf$/i, '')}</h1><p>{selected.page_count} 页 · 逐页整理</p></div><span>编辑后点击「保存笔记」<br />也可使用 ⌘ / Ctrl + S</span></div>{documentLoading && <p className="loading" role="status">正在加载课件…</p>}{pdf && pages.map(page => <article className="pageRow" key={page.id}><div className="pageLabel"><strong>第 {page.number} 页</strong><span>共 {selected.page_count} 页</span></div><div className="pageColumns"><PdfPage pdf={pdf} number={page.number} /><NoteEditor page={page} draft={drafts[page.id]} onChange={text => setDrafts(previous => ({ ...previous, [page.id]: { ...previous[page.id], text } }))} onSaved={(saved, version) => setDrafts(previous => previous[page.id] ? ({ ...previous, [page.id]: { ...previous[page.id], saved, version } }) : previous)} /></div></article>)}</>}
    </main>
    <input ref={input} type="file" accept="application/pdf,.pdf" aria-label="选择 PDF 课件" hidden onChange={event => void upload(event.target.files?.[0])} />
  </div>
}
