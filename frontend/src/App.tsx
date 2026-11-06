import { Alert, Button, Drawer, Modal, notification, Popover } from 'antd'
import { Divider, PdfIcon, ripple, useLayoutSize } from './ReadingControls'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api, type Material, type Page, type Directory as DirectoryData } from './api'
import { ConflictPage } from './ConflictPage'
import { Reader } from './Reader'
import type { Mode } from './reading'
import { DraftStore } from './drafts'
import { Directory } from './Directory'
import { ImportDialog } from './ImportDialog'
import { materialPath } from './directoryOrder'
import { WorkspaceTheme, overlayContainer, useDisplayMode, useMediaPreference } from './theme'
import { SystemSettings } from './SystemSettings'
import './styles.css'

GlobalWorkerOptions.workerSrc = workerUrl

export default function App() {
  const { mode: displayMode, selectMode } = useDisplayMode()
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [modal, modalHolder] = Modal.useModal()
  const narrow = useMediaPreference('(max-width: 740px)')
  const width = useLayoutSize('slide-notes:sidebar-width', 320, 215, 440)
  const [drawer, setDrawer] = useState(false)
  const [full, setFull] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setNotice('浏览器未进入全屏，仍可在当前窗口继续阅读或沉浸整理。') }
  }
  const [sidebar, setSidebar] = useState(true)
  const [mode, setMode] = useState<Mode>('organize')
  const readOnly = mode === 'review'
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
      for (const page of nextPages) store.bind(page, selected.id)
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
    if (operation.current || readOnly) return false
    operation.current = true
    setDirectoryBusy(true); setError(''); setNotice('')
    try {
      const next = await api<DirectoryData>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, revision: directory.revision }) })
      applyDirectory(next)
      if (importOpen && url === '/api/courses' && method === 'POST') {
        const created = next.courses.find(c => !directory.courses.some(old => old.id === c.id))
        if (created) { setImportCourse(created.id); setImportChapter('') }
      }
      if (importOpen && url === '/api/chapters' && method === 'POST') {
        const created = next.chapters.find(ch => !directory.chapters.some(old => old.id === ch.id))
        if (created) setImportChapter(created.id)
      }
      setNotice('目录已保存。')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '目录保存失败，请重试。')
      return false
    } finally { operation.current = false; setDirectoryBusy(false) }
  }
  function prepareImport(file?: File) {
    if (operation.current || readOnly) return
    setError(''); setNotice('')
    setDuplicate(null)
    setImportFile(file ?? null)
    setImportCourse(selected?.course_id ?? directory.courses[0]?.id ?? '')
    setImportChapter(selected?.chapter_id ?? '')
    setDrawer(false)
    setImportOpen(true)
  }
  async function deleteMaterial(material: Material) {
    if (operation.current || readOnly) return
    operation.current = true; setDirectoryBusy(true); setError('')
    let paused = false
    try {
      const detail = await api<Material & { note_count: number; page_ids: string[] }>(`/api/materials/${material.id}`)
      const local = Object.values(store.entries).filter(entry => detail.page_ids.includes(entry.pageId) && store.dirty(entry)).length
      if (!await modal.confirm({ getContainer: overlayContainer, title: '删除课件？', okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true }, content: `删除“${material.filename}”？将永久删除原始 PDF、${material.page_count} 页及 ${detail.note_count} 条已保存笔记／问答${local ? `，并丢弃 ${local} 处未保存编辑` : ''}。无法撤销。` })) return
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
    if (!file || operation.current || readOnly) return
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
    if (operation.current || readOnly) return
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

  const directoryPanel = <>
      <div className="brand"><span className="brandMark" aria-hidden="true">P</span><div><strong>slide-notes</strong><small>把理解留在每一页</small></div></div>
      <div className="directoryImport"><button className="primary" disabled={readOnly || uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在导入…' : '＋ 导入 PDF'}</button></div>
      <Directory readOnly={readOnly} data={directory} selected={selected?.id} busy={loading || uploading || resetting || directoryBusy} onSelect={material => { setSelected(material); setDrawer(false) }} mutate={mutateDirectory} onDelete={deleteMaterial} />
      <div className="sidebarBottom"><button onClick={() => { setDrawer(false); setSettingsOpen(true) }}><span aria-hidden="true">⚙ </span>系统设置</button></div>
  </>
  useEffect(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll'
    document.body.append(probe)
    reader.current?.style.setProperty('--scrollbar-width', (probe.offsetWidth - probe.clientWidth) + 'px')
    probe.remove()
  }, [])
  const [immersiveSidebar, setImmersiveSidebar] = useState(false)
  const sidebarVisible = mode === 'immerse' ? immersiveSidebar : sidebar
  const directoryVisible = narrow ? drawer : sidebarVisible
  function changeMode(next: Mode) {
    if (next !== mode) { setDrawer(false); setImmersiveSidebar(false) }
    setMode(next)
  }
  function toggleDirectory() {
    if (narrow) setDrawer(!drawer)
    else if (mode === 'immerse') setImmersiveSidebar(!immersiveSidebar)
    else setSidebar(!sidebar)
  }
  const destinationCourse = importCourse || directory.courses[0]?.id || ''
  const [toast, toastHolder] = notification.useNotification({ placement: 'top' })
  const [offline, setOffline] = useState(false)
  const [checking, setChecking] = useState(false)
  const returnPosition = useRef(0)
  const [targetUrl, setTargetUrl] = useState('')
  const entries = Object.values(store.entries)
  const conflict = entries.find(entry => entry.conflict)
  const target = store.entries[targetUrl]
  const targetLocation = target && store.locations.get(target.pageId)
  const targetMaterial = materials.find(material => material.id === targetLocation?.materialId)
  const latest = store.history[0]
  const failed = entries.some(entry => entry.error || entry.conflict)
  const pending = entries.some(entry => entry.pending)
  const clock = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour12: false })
  let saveText = '暂无保存记录'
  if (conflict) saveText = '保存冲突'
  else if (failed) saveText = '保存失败'
  else if (pending) saveText = '正在保存…'
  else if (dirtyCount) saveText = dirtyCount + ' 页未保存'
  else if (latest?.result === '成功') saveText = clock(latest.time) + (latest.automatic ? ' 已自动保存' : ' 已手动保存')
  else if (latest) saveText = '已同步'
  const dot = failed ? 'offline' : dirtyCount ? 'checking' : latest ? 'online' : 'idle'
  useEffect(() => {
    const disconnected = () => setOffline(true)
    window.addEventListener('slide-notes:offline', disconnected)
    return () => window.removeEventListener('slide-notes:offline', disconnected)
  }, [])
  useEffect(() => {
    if (!notice) return
    if (notice.startsWith('浏览器未进入全屏')) toast.error({ title: notice, key: 'fullscreen-error', duration: 0 })
    else toast.success({ title: notice, key: 'operation', duration: 4 })
  }, [notice, toast])
  useEffect(() => {
    if (error && !offline && !importOpen) toast.error({ title: error, key: 'operation-error', duration: 0,
      actions: <Button onClick={() => void loadMaterials().then(result => { if (result && selected) setDocumentRetry(n => n + 1) })}>重新加载</Button> })

  }, [error, offline, importOpen, toast])
  async function retryConnection() {
    setChecking(true)
    try {
      const result = await api<{ status: string }>('/api/status', { cache: 'no-store' })
      if (result?.status !== 'ok') return
      if (!await loadMaterials()) return
      setOffline(false)
      if (selected && !pdf) setDocumentRetry(n => n + 1)
      for (const entry of Object.values(store.entries)) {
        if (entry.error && !entry.conflict && !entry.missing) void store.save(entry)
      }
    } catch { setOffline(true) }
    finally { setChecking(false) }
  }
  return <WorkspaceTheme mode={displayMode}><div className={'workspace ' + (sidebarVisible && !narrow ? '' : 'sidebarClosed')}
    style={{ '--course-width': width.value + 'px' } as CSSProperties}>
    {modalHolder}{toastHolder}
    {narrow ? <Drawer title="课程目录" placement="left" open={drawer} onClose={() => setDrawer(false)} getContainer={overlayContainer}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' }, wrapper: { maxWidth: '90vw' } }}>
      <div className="courseSidebar drawerSidebar">{directoryPanel}</div>
    </Drawer> : <aside className="courseSidebar" aria-label="课件目录" inert={!sidebarVisible || !!targetMaterial}>{directoryPanel}<Divider label="目录宽度" size={width} /></aside>}
    <div className="readingFrame"><section className="readerScroll" ref={reader} inert={!!targetMaterial}>
    <header className="toolbar">
      <button className="sidebarToggle" aria-expanded={directoryVisible}
        aria-label={directoryVisible ? '收起目录' : '展开目录'} onClick={e => { ripple(e); toggleDirectory() }}>☰</button>
      <div className="breadcrumb">{selected ? <><span>{directory.courses.find(c => c.id === selected.course_id)?.name}
        {selected.chapter_id ? ' / ' + directory.chapters.find(c => c.id === selected.chapter_id)?.name : ''} /</span> <strong>{selected.filename}</strong></> : <strong>学习工作台</strong>}</div>
      <button className="fullIcon" aria-label={full ? '退出全屏' : '全屏'} title={full ? '退出全屏' : '全屏'} onClick={() => void fullscreen()}>
        <svg viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={full ? 'M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5' : 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6'} />
        </svg>
      </button>
      <div className="modeSwitcher" aria-label="工作模式">
        {([['organize', '整理'], ['review', '复习'], ['immerse', '沉浸整理']] as const).map(([value, label]) =>
          <button key={value} aria-pressed={mode === value} disabled={uploading || resetting || directoryBusy || importOpen}
            onClick={e => { ripple(e); changeMode(value) }}>{label}</button>)}
      </div>
      <Popover trigger={['hover', 'click', 'focus']} placement="bottomRight" content={<div className="saveLog">
        {store.history.length === 0 && <span>本次尚无保存记录</span>}
        {store.history.map((record, index) => {
          const location = store.locations.get(record.pageId)
          const file = materials.find(item => item.id === location?.materialId)
          return <div key={index}><i className={'statusDot ' + (record.result === '成功' ? 'online' : 'offline')} />
            {clock(record.time)} 保存{record.result} · {file?.filename} · 第 {location?.number} 页
          </div>
        })}
        <hr />停止输入约 800ms 自动保存，也可使用 ⌘ / Ctrl + S 手动保存
      </div>}>
        <button className={narrow ? 'compactStatus' : 'globalStatus'} aria-label={saveText}>
          <i className={'statusDot ' + dot} />{!narrow && <span role="status">{saveText}</span>}
        </button>
      </Popover>
    </header>
    <div className="systemAlerts">{offline && <Alert type="error" showIcon title="后端连接失败，请检查服务是否运行。" action={<Button type="link" loading={checking} onClick={() => void retryConnection()}>重试连接</Button>} />}
    {conflict && <Alert type="error" showIcon title="笔记存在版本冲突，本地草稿已保留。" action={<Button type="link" onClick={() => { returnPosition.current = reader.current?.scrollTop ?? 0; setTargetUrl(conflict.url) }}>查看冲突</Button>} />}</div>
    {dragging && <div className="dropOverlay">松开以导入 PDF</div>}
    <main className="reader" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!readOnly) setDragging(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { setDragging(false); const file = event.dataTransfer.files[0]; if (!file) return; event.preventDefault(); if (!readOnly) prepareImport(file) }}>
      {resetting && <p role="status" className="loading">正在清空全部数据…</p>}
      {store.storageError && <p role="alert" className="errorBanner">{store.storageError}</p>}
      {directoryBusy && <p role="status">正在保存目录…</p>}
      {loading && <p className="loading" role="status">正在读取课件目录…</p>}
      {!selected && !loading && <div className="emptyState"><div className="emptyPage" aria-hidden="true"><span /><span /><span /></div><h1>从一份课件开始</h1><p>课件在左，理解在右。<br />逐页阅读，把重点写成自己的笔记。</p><button className="primary" disabled={readOnly || uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在校验并导入…' : '导入 PDF 课件'}</button><small>也可将 PDF 拖到这里 · 最大 100 MB</small>{materials.length > 0 && <p>或从左侧目录打开已有课件。</p>}</div>}
      {selected && !resetting && <><div className="documentHeading"><PdfIcon /><h1>{selected.filename.replace(/\.pdf$/i, '')}</h1><small className="pageCount">{selected.page_count}页</small></div>{documentLoading && <p className="loading" role="status">正在加载课件…</p>}{pdf && <Reader key={selected.id} materialId={selected.id} pages={pages} pdf={pdf} store={store} onNotice={message => toast.success({ title: message, duration: 4, key: 'page-settings' })} onFailure={message => toast.error({ title: message, duration: 0, key: 'page-settings' })} mode={mode} onMode={changeMode} reader={reader} onSettings={settings => setPages(old => old.map(page => { const next = settings.find(item => item.id === page.id); return next ? { ...page, category: next.category, display: next.display, settings_version: next.settings_version } : page }))} />}</>}
    </main></section>
    {target && targetMaterial && targetLocation && <ConflictPage key={target.url} material={targetMaterial} number={targetLocation.number} entry={target} store={store} onReturn={() => { setTargetUrl(''); if (reader.current) reader.current.scrollTop = returnPosition.current }} />}
    </div>
    <ImportDialog open={importOpen} directory={directory} course={destinationCourse} chapter={importChapter} file={importFile} busy={uploading || directoryBusy || loading} error={error} duplicate={duplicate?.path} onOpenExisting={() => void openExisting()} onCourse={id => { setImportCourse(id); setImportChapter('') }} onChapter={setImportChapter} onFile={file => { setImportFile(file); setDuplicate(null); setError('') }} onReload={() => { void loadMaterials(); setImportCourse(''); setImportChapter('') }} onClose={() => setImportOpen(false)} onSubmit={() => void upload(importFile ?? undefined)} onCreate={(name, isChapter) => isChapter ? mutateDirectory('/api/chapters', 'POST', { name, course_id: destinationCourse }) : mutateDirectory('/api/courses', 'POST', { name })} />

    {settingsOpen && <SystemSettings readOnly={readOnly} mode={displayMode} selectMode={selectMode} onClose={() => setSettingsOpen(false)}
      canReset={!readOnly && !uploading && !resetting && !directoryBusy && !loading}
      onReset={() => { setSettingsOpen(false); void resetAllData() }} />}
  </div></WorkspaceTheme>
}
