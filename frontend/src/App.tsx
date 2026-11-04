import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api, type Material, type Page, type Directory as DirectoryData } from './api'
import { NoteEditor } from './NoteEditor'
import { DraftStore } from './drafts'
import { PdfPage } from './PdfPage'
import { Directory } from './Directory'
import { ImportDialog } from './ImportDialog'
import { materialPath } from './directoryOrder'
import './styles.css'

GlobalWorkerOptions.workerSrc = workerUrl

export default function App() {
  const [directory, setDirectory] = useState<DirectoryData>({ revision: 0, courses: [], chapters: [], materials: [] })
  const materials = directory.materials
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [duplicate, setDuplicate] = useState<{ material: Material; path: string } | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importCourse, setImportCourse] = useState('')
  const [importChapter, setImportChapter] = useState('')
  const [documentRetry, setDocumentRetry] = useState(0)
  const [selected, setSelected] = useState<Material | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [store] = useState(() => new DraftStore())
  const [, refreshDrafts] = useState(0)
  useEffect(() => store.subscribe(() => refreshDrafts(value => value + 1)), [store])
  useEffect(() => () => store.dispose(), [store])
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
  const reader = useRef<HTMLElement>(null)
  const dirtyCount = store.dirtyPages

  async function loadMaterials() {
    const generation = loadGeneration.current
    setLoading(true)
    try {
      const result = await api<DirectoryData>('/api/directory')
      if (generation !== loadGeneration.current) return
      applyDirectory(result); setError('')
      return result
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
      for (const page of nextPages) store.bind(page)
      setPdf(doc)
    }).catch(cause => { if (!stopped && generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : '课件加载失败。') })
      .finally(() => { if (!stopped && generation === loadGeneration.current) setDocumentLoading(false) })
    return () => { stopped = true; void task.destroy() }
  }, [selected?.id, documentRetry])

  function applyDirectory(next: DirectoryData) {
    setDirectory(next)
    setSelected(old => old ? next.materials.find(m => m.id === old.id) ?? null : null)
  }
  async function mutateDirectory(url: string, method: string, body: object): Promise<boolean> {
    if (operation.current) return false
    operation.current = true
    setDirectoryBusy(true); setError(''); setNotice('')
    try {
      const next = await api<DirectoryData>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, revision: directory.revision }) })
      applyDirectory(next)
      if (importOpen && url === '/api/courses' && method === 'POST') {
        const created = next.courses.find(c => !directory.courses.some(old => old.id === c.id))
        if (created) { setImportCourse(created.id); setImportChapter('') }
      }
      setNotice('目录已保存。')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '目录保存失败，请重试。')
      return false
    } finally { operation.current = false; setDirectoryBusy(false) }
  }
  function prepareImport(file?: File) {
    if (operation.current) return
    setError(''); setNotice('')
    setDuplicate(null)
    setImportFile(file ?? null)
    setImportCourse(selected?.course_id ?? directory.courses[0]?.id ?? '')
    setImportChapter(selected?.chapter_id ?? '')
    setImportOpen(true)
  }
  async function deleteMaterial(material: Material) {
    if (operation.current) return
    operation.current = true; setDirectoryBusy(true); setError('')
    let paused = false
    try {
      const detail = await api<Material & { note_count: number; page_ids: string[] }>(`/api/materials/${material.id}`)
      const local = Object.values(store.entries).filter(entry => detail.page_ids.includes(entry.pageId) && store.dirty(entry)).length
      if (!window.confirm(`删除“${material.filename}”？将永久删除原始 PDF、${material.page_count} 页及 ${detail.note_count} 条已保存笔记／问答${local ? `，并丢弃 ${local} 处未保存编辑` : ''}。无法撤销。`)) return
      store.pause(true); paused = true
      const next = await api<DirectoryData>(`/api/materials/${material.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: directory.revision, confirmation: material.id }) })
      store.removePages(detail.page_ids)
      applyDirectory(next)
      setNotice('课件及其关联笔记已删除。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试。') }
    finally { if (paused) store.pause(false); operation.current = false; setDirectoryBusy(false) }
  }
  async function openExisting() {
    if (!duplicate || operation.current) return
    const current = await loadMaterials()
    const material = current?.materials.find(m => m.id === duplicate.material.id)
    if (!material) { setError('课件目录未能加载或课件已被删除，请重新加载目录。'); return }
    setSelected(material); setImportOpen(false); setImportFile(null); setDuplicate(null)
  }
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
      const course = importCourse || directory.courses[0]?.id
      if (!course) throw new Error('请先创建并选择课程。')
      form.append('course_id', course)
      if (importChapter) form.append('chapter_id', importChapter)
      const { duplicate: exists, location, ...material } = await api<Material & { duplicate?: boolean; location?: { course_name: string; chapter_name: string | null } }>('/api/materials', { method: 'POST', body: form })
      if (exists) {
        const path = location ? [location.course_name, location.chapter_name, material.filename].filter(Boolean).join(' / ') : materialPath(directory, material)
        setDuplicate({ material, path })
        return
      }
      const next = await api<DirectoryData>('/api/directory')
      applyDirectory(next)
      setImportOpen(false); setImportFile(null); setDuplicate(null)
      setSelected(material)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试。') }
    finally { operation.current = false; setUploading(false) }
  }

  async function resetAllData() {
    if (operation.current) return
    if (!window.confirm('清空全部数据？所有课件、原始 PDF、已保存笔记和当前未保存内容都将永久删除，无法撤销。系统“未分类”保留为空分类。')) return
    operation.current = true
    store.pause(true)
    loadGeneration.current += 1
    setResetting(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ reset: boolean; directory: DirectoryData }>('/api/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE_ALL_DATA' }),
      })
      setSelected(null)
      setPdf(null)
      setPages([])
      setDirectory(result.directory)
      setImportOpen(false); setImportFile(null); setDuplicate(null)
      store.clear()
      setLoading(false)
      setDocumentLoading(false)
      setNotice('全部数据已清空，可以重新导入课件。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败，请重试。')
      setDocumentLoading(false)
    } finally { operation.current = false; store.pause(false); setResetting(false) }
  }

  return <div className={`workspace ${sidebar ? '' : 'sidebarClosed'}`}>
    <aside className="sidebar" aria-label="课件目录">
      <div className="brand"><span className="brandMark" aria-hidden="true">页</span><div><strong>slide-notes</strong><small>把理解留在每一页</small></div></div>
      <Directory data={directory} selected={selected?.id} busy={loading || uploading || resetting || directoryBusy} onSelect={setSelected} mutate={mutateDirectory} onDelete={deleteMaterial} />
      <div className="sidebarBottom"><button className="primary" disabled={uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在导入…' : '＋ 导入 PDF'}</button><p>课件与笔记保存在本机</p><button className="dangerButton" disabled={uploading || resetting || directoryBusy || loading} onClick={() => void resetAllData()}>{resetting ? '正在清空…' : '清空全部数据'}</button></div>
    </aside>
    <header className="toolbar"><button className="sidebarToggle" aria-label={sidebar ? '收起目录' : '展开目录'} onClick={() => setSidebar(value => !value)}>☰</button><div className="breadcrumb">{selected ? <><span>{directory.courses.find(c => c.id === selected.course_id)?.name}{selected.chapter_id ? ` / ${directory.chapters.find(c => c.id === selected.chapter_id)?.name}` : ''} /</span> <strong>{selected.filename}</strong></> : <strong>学习工作台</strong>}</div><span className="mode">整理</span><span className="globalStatus" role="status">{dirtyCount ? `${dirtyCount} 页未保存` : '所有笔记已保存'}</span></header>
    <main ref={reader} className="reader" onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); prepareImport(event.dataTransfer.files[0]) }}>
      {resetting && <p role="status" className="loading">正在清空全部数据…</p>}
      {store.storageError && <p role="alert" className="errorBanner">{store.storageError}</p>}
      {notice && <div className="noticeBanner" role="status">{notice}</div>}
      {dragging && <div className="dropOverlay">松开以导入 PDF</div>}
      {error && <div className="errorBanner" role="alert">{error} <button onClick={() => void loadMaterials().then(() => { if (selected) setDocumentRetry(value => value + 1) })}>重新加载</button></div>}
      {directoryBusy && <p role="status">正在保存目录…</p>}
      {loading && <p className="loading" role="status">正在读取课件目录…</p>}
      {!selected && !loading && <div className="emptyState"><div className="emptyPage" aria-hidden="true"><span /><span /><span /></div><h1>从一份课件开始</h1><p>课件在左，理解在右。<br />逐页阅读，把重点写成自己的笔记。</p><button className="primary" disabled={uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在校验并导入…' : '导入 PDF 课件'}</button><small>也可将 PDF 拖到这里 · 最大 100 MB</small>{materials.length > 0 && <p>或从左侧目录打开已有课件。</p>}</div>}
      {selected && !resetting && <><div className="documentHeading"><div><h1>{selected.filename.replace(/\.pdf$/i, '')}</h1><p>{selected.page_count} 页 · 逐页整理</p></div><span>停止输入约 800ms 自动保存<br />也可使用 ⌘ / Ctrl + S</span></div>{documentLoading && <p className="loading" role="status">正在加载课件…</p>}{pdf && pages.map(page => <article className="pageRow" key={page.id}><div className="pageLabel"><strong>第 {page.number} 页</strong><span>共 {selected.page_count} 页</span></div><div className="pageColumns"><PdfPage pdf={pdf} number={page.number} /><NoteEditor page={page} store={store} /></div></article>)}</>}
    </main>
    {importOpen && <ImportDialog directory={directory} course={importCourse || directory.courses[0]?.id || ''} chapter={importChapter} file={importFile} busy={uploading || directoryBusy || loading} error={error} duplicate={duplicate?.path} onOpenExisting={() => void openExisting()} onCourse={id => { setImportCourse(id); setImportChapter('') }} onChapter={setImportChapter} onFile={file => { setImportFile(file); setDuplicate(null); setError('') }} onReload={() => { void loadMaterials(); setImportCourse(''); setImportChapter('') }} onClose={() => setImportOpen(false)} onSubmit={() => void upload(importFile ?? undefined)} onCreate={name => mutateDirectory('/api/courses', 'POST', { name })} />}

  </div>
}
