import { ReadOutlined, UploadOutlined, SettingOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons'
import { Alert, Badge, Breadcrumb, Divider as AntDivider, Empty, Spin, Tabs, Tag, Typography, Tooltip, Button, Drawer, Modal, notification, Popover } from 'antd'
import { Divider, PdfIcon, useLayoutSize } from './ReadingControls'
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api, ApiError, type Material, type Page, type Directory as DirectoryData } from './api'
import { ConflictPage } from './ConflictPage'
import { Reader } from './Reader'
import type { Mode } from './reading'
import { DraftStore, type SaveRecord } from './drafts'
import { Directory } from './Directory'
import { ImportDialog } from './ImportDialog'
import { materialPath } from './directoryOrder'
import { WorkspaceTheme, overlayContainer, useDisplayMode, useMediaPreference } from './theme'
import { SystemSettings } from './SystemSettings'
import './styles.css'

GlobalWorkerOptions.workerSrc = workerUrl

const ERROR_DURATION = 5
const CONNECTION_CHECK_MS = 5000
type OperationError = { message: string; reload?: boolean }
type ImportResult = Material & { duplicate?: boolean; location?: { course_name: string; chapter_name: string | null } }
const MAX_PDF_BYTES = 100 * 1024 * 1024

function RetrySaveButton({ store, url }: { store: DraftStore; url: string }) {
  const enabled = useSyncExternalStore(store.subscribe, () => !store.offline && store.canRetry(url))
  return <Button className="retrySave" type="link" size="small" disabled={!enabled} onClick={() => store.retry(url)}>重试</Button>
}

export default function App() {
  const { mode: displayMode, selectMode } = useDisplayMode()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [directory, setDirectory] = useState<DirectoryData>({ revision: 0, courses: [], chapters: [], materials: [] })
  const materials = directory.materials
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [uploadDuplicate, setUploadDuplicate] = useState<ImportResult | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importCheck, setImportCheck] = useState<{ file: File; error?: string; match?: ImportResult | null; pageCount?: number; encrypted?: boolean } | null>(null)
  const checkedImport = importFile && importCheck?.file === importFile ? importCheck : null
  const duplicate = uploadDuplicate ?? checkedImport?.match
  const checkingFile = !!importFile && !checkedImport
  const duplicatePath = duplicate && (duplicate.location
    ? [duplicate.location.course_name, duplicate.location.chapter_name, duplicate.filename].filter(Boolean).join(' / ')
    : materialPath(directory, duplicate))
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
  const [error, setError] = useState<OperationError | null>(null)
  const [importError, setImportError] = useState<OperationError | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [originalUnavailable, setOriginalUnavailable] = useState(false)
  const [replacingOriginal, setReplacingOriginal] = useState(false)
  const originalInput = useRef<HTMLInputElement>(null)
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
    } catch {
      toast.error({ title: '浏览器未进入全屏，仍可在当前窗口继续阅读或沉浸整理。', key: 'fullscreen-error', duration: ERROR_DURATION })
    }
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
  const toolbar = useRef<HTMLElement>(null)
  const pageNavigator = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const header = toolbar.current
    if (!header || typeof ResizeObserver === 'undefined') return
    const update = () => reader.current?.style.setProperty('--toolbar-height', `${header.offsetHeight || 64}px`)
    const observer = new ResizeObserver(update)
    observer.observe(header)
    update()
    return () => observer.disconnect()
  }, [])
  const dirtyCount = store.dirtyPages

  async function loadMaterials(reportError = setError) {
    const generation = loadGeneration.current
    setLoading(true)
    try {
      const result = await api<DirectoryData>('/api/directory')
      if (generation !== loadGeneration.current) return
      applyDirectory(result); reportError(null)
      return result
    }
    catch (cause) { if (generation === loadGeneration.current) reportError({ message: cause instanceof Error ? cause.message : '课件列表加载失败。', reload: true }) }
    finally { if (generation === loadGeneration.current) setLoading(false) }
  }
  useEffect(() => { void loadMaterials() }, [])
  useEffect(() => {
    if (!importFile) return
    const file = importFile
    const controller = new AbortController()
    let pdfTask: ReturnType<typeof getDocument> | undefined
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setImportCheck({ file, error: '请选择 PDF 文件。' })
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setImportCheck({ file, error: '文件超过 100 MB 限制。' })
      return
    }
    async function check() {
      try {
        const bytes = await file.arrayBuffer()
        if (controller.signal.aborted) return
        pdfTask = getDocument({ data: new Uint8Array(bytes), password: '' })
        const digestPromise = crypto.subtle.digest('SHA-256', bytes)
        const [pdfResult, duplicateResult, digestResult] = await Promise.allSettled([
          pdfTask.promise,
          digestPromise.then(value => {
            const hash = Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')
            return api<ImportResult | null>(`/api/materials/duplicates?sha256=${hash}`, { signal: controller.signal })
          }),
          digestPromise,
        ])
        if (controller.signal.aborted) {
          void pdfTask.destroy()
          return
        }
        const errorCause = pdfResult.status === 'rejected' ? pdfResult.reason : null
        const errorName = errorCause instanceof Error ? errorCause.name : ''
        const error = errorName === 'PasswordException'
          ? '此 PDF 需要打开密码，请先解除密码保护后重新选择。'
          : errorName === 'InvalidPDFException'
            ? 'PDF 已损坏或格式无效，无法读取。'
            : pdfResult.status === 'fulfilled' && pdfResult.value.numPages === 0
              ? 'PDF 中没有页面。'
              : errorCause ? '文件无法读取，请确认文件完整后重新选择。' : undefined
        const pageCount = pdfResult.status === 'fulfilled' ? pdfResult.value.numPages : undefined
        const encrypted = pdfResult.status === 'fulfilled' && (await pdfResult.value.getPermissions()) !== null
        void pdfTask.destroy()
        setImportCheck({
          file,
          error: error ?? (duplicateResult.status === 'rejected' || digestResult.status === 'rejected'
            ? '无法检查课件是否重复，请重试。'
            : undefined),
          match: duplicateResult.status === 'fulfilled' ? duplicateResult.value : undefined,
          pageCount,
          encrypted,
        })
      } catch {
        if (!controller.signal.aborted) setImportCheck(old => old?.file === file
          ? { ...old, error: old.error ?? '无法检查文件是否重复，请确认文件可读取后重试。' }
          : { file, error: '无法检查文件，请确认文件可读取后重试。' })
      }
    }
    void check()
    return () => {
      controller.abort()
      if (pdfTask) void pdfTask.destroy()
    }
  }, [importFile])
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
    setOriginalUnavailable(false)
    setError(null)
    setDocumentLoading(true)
    if (reader.current) reader.current.scrollTop = 0
    const task = getDocument({ url: `/api/materials/${selected.id}/file`, cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' })
    void Promise.all([api<Page[]>(`/api/materials/${selected.id}/pages`), task.promise]).then(([nextPages, doc]) => {
      if (stopped || generation !== loadGeneration.current) return
      setPages(nextPages)
      store.bindPages(nextPages, selected.id)
      setPdf(doc)
    }).catch(cause => {
      if (stopped || generation !== loadGeneration.current) return
      if (cause?.status === 410 || ['InvalidPDFException', 'PasswordException'].includes(cause?.name)) setOriginalUnavailable(true)
      else setError({ message: cause instanceof Error ? cause.message : '课件加载失败。', reload: true })
    })
      .finally(() => { if (!stopped && generation === loadGeneration.current) setDocumentLoading(false) })
    return () => { stopped = true; void task.destroy() }
  }, [selected?.id, documentRetry])

  async function replaceOriginal(file: File) {
    if (!selected || readOnly || operation.current) return
    operation.current = true
    setReplacingOriginal(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      await api(`/api/materials/${selected.id}/file`, { method: 'PUT', body: form })
      setDocumentRetry(n => n + 1)
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : '原始 PDF 恢复失败。' })
    } finally {
      operation.current = false
      setReplacingOriginal(false)
    }
  }

  function applyDirectory(next: DirectoryData) {
    setDirectory(next)
    setSelected(old => old ? next.materials.find(m => m.id === old.id) ?? null : null)
  }
  async function mutateDirectory(url: string, method: string, body: object): Promise<boolean> {
    if (operation.current || readOnly) return false
    operation.current = true
    setDirectoryBusy(true); setError(null); setImportError(null); setNotice('')
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
      const reportError = importOpen ? setImportError : setError
      reportError({ message: cause instanceof Error ? cause.message : '目录保存失败，请重试。', reload: cause instanceof ApiError && cause.status === 409 })
      return false
    } finally { operation.current = false; setDirectoryBusy(false) }
  }
  function prepareImport(file?: File) {
    if (operation.current || readOnly) return
    setImportError(null); setNotice('')
    setUploadDuplicate(null)
    setImportFile(file ?? null)
    setImportCourse(selected?.course_id ?? directory.courses[0]?.id ?? '')
    setImportChapter(selected?.chapter_id ?? '')
    setDrawer(false)
    setImportOpen(true)
  }
  async function deleteMaterial(material: Material) {
    if (operation.current || readOnly) return
    operation.current = true; setDirectoryBusy(true); setError(null)
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
    } catch (cause) { setError({ message: cause instanceof Error ? cause.message : '删除失败，请重试。', reload: cause instanceof ApiError && cause.status === 409 }) }
    finally { if (paused) store.pause(false); operation.current = false; setDirectoryBusy(false) }
  }
  async function openExisting() {
    if (!duplicate || operation.current) return
    const current = await loadMaterials(setImportError)
    const material = current?.materials.find(m => m.id === duplicate.id)
    if (!material) { setImportError({ message: '课件目录未能加载或课件已被删除，请重新加载目录。', reload: true }); return }
    setSelected(material); closeImport()
  }
  async function upload(file?: File, createCopy = false) {
    if (!file || checkingFile || checkedImport?.error || operation.current || readOnly) return
    if (!file.name.toLowerCase().endsWith('.pdf')) { setImportError({ message: '请选择 PDF 文件。' }); return }
    if (file.size > MAX_PDF_BYTES) { setImportError({ message: '文件超过 100 MB 限制。' }); return }
    operation.current = true
    setUploading(true)
    setNotice('')
    setImportError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (createCopy) form.append('create_copy', 'true')
      const course = importCourse || directory.courses[0]?.id
      if (!course) throw new Error('请先创建并选择课程。')
      form.append('course_id', course)
      if (importChapter) form.append('chapter_id', importChapter)
      const material = await api<ImportResult>('/api/materials', { method: 'POST', body: form })
      if (material.duplicate) {
        setUploadDuplicate(material)
        return
      }
      if (!await loadMaterials(setImportError)) return
      closeImport()
      setSelected(material)
    } catch (cause) { setImportError({ message: cause instanceof Error ? cause.message : '导入失败，请重试。' }) }
    finally { operation.current = false; setUploading(false) }
  }

  function closeImport() {
    setImportOpen(false)
    setImportError(null)
    setImportCheck(null)
    setImportFile(null)
    setUploadDuplicate(null)
  }

  async function replaceAllData(backup: boolean, restoreId?: string) {
    if (operation.current || readOnly) return
    operation.current = true
    store.pause(true)
    loadGeneration.current += 1
    setResetting(true)
    setError(null)
    setNotice('')
    try {
      if (restoreId) await store.waitForPending()
      const result = await api<{ backup_id?: string; directory: DirectoryData }>(restoreId ? `/api/backups/${restoreId}/restore` : '/api/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoreId ? { confirmation: 'RESTORE_BACKUP' } : { confirmation: 'DELETE_ALL_DATA', ...(backup ? { backup } : {}) }),
      })
      setSelected(null)
      setPdf(null)
      setPages([])
      setDirectory(result.directory)
      closeImport()
      store.clear()
      setLoading(false)
      setDocumentLoading(false)
      setNotice(restoreId ? '备份已恢复。' : result.backup_id ? '备份已创建，全部数据已清空。' : '全部数据已清空，可以重新导入课件。')
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : '数据操作失败，请重试。' })
      setDocumentLoading(false)
      if (documentLoading) setDocumentRetry(n => n + 1)
    } finally { operation.current = false; store.pause(false); setResetting(false) }
  }

  const directoryPanel = <>
      <div className="brand"><ReadOutlined className="brandMark" aria-hidden="true" /><div><strong>slide-notes</strong><small>把理解留在每一页</small></div></div>
      <div className="directoryImport"><Button type="primary" disabled={readOnly || uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在导入…' : <><UploadOutlined aria-hidden="true" /> 导入 PDF</>}</Button></div>
      <Directory readOnly={readOnly} data={directory} selected={selected?.id} busy={loading || uploading || resetting || directoryBusy} onSelect={material => { setSelected(material); setDrawer(false) }} mutate={mutateDirectory} onDelete={deleteMaterial} />
      <div className="sidebarBottom"><Button type="text" onClick={() => { setDrawer(false); setSettingsOpen(true) }}><SettingOutlined aria-hidden="true" /> 系统设置</Button></div>
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
  useEffect(() => {
    const result = (event: Event) => {
      const detail = (event as CustomEvent<SaveRecord & { error: string; deleting: boolean }>).detail
      if (detail.result === '成功') {
        toast.destroy('save-error:' + detail.url)
        if (!detail.automatic) toast.success({ title: detail.deleting ? '问答已删除。' : '保存成功', duration: 3 })
        return
      }
      const message = detail.deleting ? '删除问答未完成：' + detail.error : detail.error
      if (detail.result === '失败' && store.canRetry(detail.url)) {
        toast.error({
          key: 'save-error:' + detail.url,
          title: <>保存失败 <RetrySaveButton store={store} url={detail.url} /></>,
          description: message,
          duration: 0,
          closable: true,
        })
      } else toast.error({ title: message || '保存失败，请检查版本冲突后重试。', duration: ERROR_DURATION })
    }
    window.addEventListener('slide-notes:save-result', result)
    return () => window.removeEventListener('slide-notes:save-result', result)
  }, [store, toast])
  const [retrySeconds, setRetrySeconds] = useState<number | null>(null)
  const offline = retrySeconds !== null
  const returnPosition = useRef(0)
  const [targetUrl, setTargetUrl] = useState('')
  const entries = Object.values(store.entries)
  const conflict = entries.find(entry => entry.conflict)
  const target = store.entries[targetUrl]
  const targetLocation = target && store.locations.get(target.pageId)
  const targetMaterial = materials.find(material => material.id === targetLocation?.materialId)
  const latest = store.history[0]
  const failed = entries.some(entry => (!entry.pending && entry.error) || entry.conflict)
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
  const recoverConnection = useEffectEvent(() => {
    void loadMaterials().then(result => {
      if (result && selected && !pdf) setDocumentRetry(n => n + 1)
    })
    store.setOffline(false)
    for (const entry of Object.values(store.entries)) void store.save(entry, true)
  })
  useEffect(() => {
    let nextCheck = Date.now() + CONNECTION_CHECK_MS
    let disconnected = false
    let stopped = false
    let controller: AbortController | undefined
    let timeout: number | undefined

    function updateCountdown() {
      setRetrySeconds(controller ? 0 : Math.max(0, Math.ceil((nextCheck - Date.now()) / 1000)))
    }
    function reportOffline() {
      disconnected = true
      store.setOffline(true)
      updateCountdown()
    }
    async function checkConnection() {
      controller = new AbortController()
      const request = controller
      timeout = window.setTimeout(() => request.abort(), 4000)
      if (disconnected) updateCountdown()
      try {
        const result = await api<{ status: string }>('/api/status', { cache: 'no-store', signal: request.signal })
        if (result?.status !== 'ok') throw new Error('Invalid status')
        if (!stopped && disconnected) {
          disconnected = false
          setRetrySeconds(null)
          recoverConnection()
        }
      } catch {
        if (!stopped) reportOffline()
      } finally {
        window.clearTimeout(timeout)
        controller = undefined
        if (!stopped && disconnected) updateCountdown()
      }
    }
    const timer = window.setInterval(() => {
      if (controller) return
      nextCheck = Date.now() + CONNECTION_CHECK_MS
      void checkConnection()
    }, CONNECTION_CHECK_MS)
    const countdown = window.setInterval(() => {
      if (disconnected && !controller) updateCountdown()
    }, 1000)
    window.addEventListener('slide-notes:offline', reportOffline)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.clearInterval(countdown)
      window.clearTimeout(timeout)
      controller?.abort()
      window.removeEventListener('slide-notes:offline', reportOffline)
    }
  }, [store])
  useEffect(() => {
    if (notice) toast.success({ title: notice, key: 'operation', duration: 4 })
  }, [notice])
  useEffect(() => {
    if (!error || offline) return
    toast.error({
      title: error.message, key: error.reload ? 'operation-reload' : 'operation-error', duration: error.reload ? 0 : ERROR_DURATION,
      actions: error.reload && <Button onClick={() => void loadMaterials().then(result => { if (result && selected) setDocumentRetry(n => n + 1) })}>重新加载</Button>,
    })
  }, [error, offline])
  return <WorkspaceTheme mode={displayMode}><div className={'workspace ' + (sidebarVisible && !narrow ? '' : 'sidebarClosed')}
    style={{ '--course-width': width.value + 'px' } as CSSProperties}>
    {modalHolder}{toastHolder}
    {narrow ? <Drawer title="课程目录" placement="left" open={drawer} onClose={() => setDrawer(false)} getContainer={overlayContainer}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' }, wrapper: { maxWidth: '90vw' } }}>
      <div className="courseSidebar drawerSidebar">{directoryPanel}</div>
    </Drawer> : <aside className="courseSidebar" aria-label="课件目录" inert={!sidebarVisible || !!targetMaterial}>{directoryPanel}<Divider label="目录宽度" size={width} /></aside>}
    <div className="readingFrame"><section className="readerScroll" ref={reader} inert={!!targetMaterial}>
    <header ref={toolbar} className="toolbar">
      <Tooltip title={directoryVisible ? '收起目录' : '展开目录'}>
      <Button type="text" className="sidebarToggle" aria-expanded={directoryVisible}
        aria-label={directoryVisible ? '收起目录' : '展开目录'} onClick={() => toggleDirectory()}>{directoryVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}</Button></Tooltip>
      <div className="readingLocation"><Breadcrumb className="breadcrumb" items={selected ? [
        { title: directory.courses.find(c => c.id === selected.course_id)?.name },
        ...(selected.chapter_id ? [{ title: directory.chapters.find(c => c.id === selected.chapter_id)?.name }] : []),
        { title: <Tooltip title={selected.filename}><Typography.Text ellipsis>{selected.filename}</Typography.Text></Tooltip> },
      ] : [{ title: '学习工作台' }]} /><div ref={pageNavigator} className="pageNavigatorHost" /></div>
      <Tooltip title={full ? '退出全屏' : '全屏'}>
      <Button type="text" className="fullIcon" aria-label={full ? '退出全屏' : '全屏'} title={full ? '退出全屏' : '全屏'} onClick={() => void fullscreen()}>
        {full ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      </Button></Tooltip>
      <Tabs className="modeSwitcher" aria-label="工作模式" activeKey={mode} onChange={value => changeMode(value as Mode)}
        animated={{ inkBar: true, tabPane: false }} items={([['organize', '整理'], ['review', '复习'], ['immerse', '沉浸整理']] as const).map(([key, label]) => ({ key, label, disabled: uploading || resetting || directoryBusy || importOpen }))} />
      <Popover trigger={['hover', 'click', 'focus']} placement="bottomRight" content={<div className="saveLog">
        {store.history.length === 0 && <span>本次尚无保存记录</span>}
        {store.history.length > 0 && <div className="saveTimeline">{store.history.map((record, index) => {
          const location = store.locations.get(record.pageId)
          const file = materials.find(item => item.id === location?.materialId)
          const retry = record.result === '失败' && store.canRetry(record.url) && store.history.find(item => item.url === record.url) === record
          const status = record.result === '成功' ? 'success' : record.result === '冲突' ? 'warning' : 'error'
          return <div className="saveTimelineItem" key={index}><Badge status={status} />
            <div className="saveTimelineText"><div className="saveTimelineTitle">{clock(record.time)} 保存{record.result}{!record.automatic && '（手动）'}{retry && <> <RetrySaveButton store={store} url={record.url} /></>}</div>
              <div className="saveTimelineMeta">{file?.filename ?? '课件'} · 第 {location?.number ?? '—'} 页</div></div>
          </div>
        })}</div>}
        <AntDivider /><div className="saveTimelineHint">停止输入将自动保存，也可使用 ⌘ / Ctrl + S 手动保存</div>
      </div>}>
        <Button type="text" className={narrow ? 'compactStatus' : 'globalStatus'} aria-label={saveText}>
          <Badge status={dot === 'online' ? 'success' : dot === 'offline' ? 'error' : dot === 'idle' ? 'default' : 'warning'} />{!narrow && <span role="status">{saveText}</span>}
        </Button>
      </Popover>
    </header>
    <div className="systemAlerts">{offline && <Alert type="error" showIcon title={<>后端连接失败，请检查服务是否运行，重连成功后将自动尝试保存。{retrySeconds
      ? `将在 ${retrySeconds} s 后重试连接…` : '正在重试连接…'}</>} />}
    {selected && originalUnavailable && !resetting && <Alert type="warning" showIcon title="请重新导入原始 PDF 以恢复阅读。"
      action={<Button disabled={readOnly} loading={replacingOriginal} onClick={() => originalInput.current?.click()}>重新导入原文件</Button>} />}
    {selected && originalUnavailable && !resetting && <input ref={originalInput} type="file" accept="application/pdf,.pdf" hidden onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (file) void replaceOriginal(file)
    }} />}
    {conflict && <Alert type="error" showIcon title="笔记存在版本冲突，本地草稿已保留。" action={<Button type="link" onClick={() => { returnPosition.current = reader.current?.scrollTop ?? 0; setTargetUrl(conflict.url) }}>查看冲突</Button>} />}</div>
    {dragging && <div className="dropOverlay">松开以导入 PDF</div>}
    <main className="reader" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!readOnly) setDragging(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { setDragging(false); const file = event.dataTransfer.files[0]; if (!file) return; event.preventDefault(); if (!readOnly) prepareImport(file) }}>
      {resetting && <p role="status" className="loading">正在处理数据，请稍候…</p>}
      {store.storageError && <p role="alert" className="errorBanner">{store.storageError}</p>}
      {directoryBusy && <p role="status">正在保存目录…</p>}
      {loading && <p className="loading" role="status">正在读取课件目录…</p>}
      {!selected && !loading && <div className="emptyState"><Empty image={<ReadOutlined />} description={false} /><h1>从一份课件开始</h1><p>课件在左，理解在右。<br />逐页阅读，把重点写成自己的笔记。</p><Button type="primary" disabled={readOnly || uploading || resetting || directoryBusy || loading} onClick={() => prepareImport()}>{uploading ? '正在校验并导入…' : '导入 PDF 课件'}</Button><small>也可将 PDF 拖到这里 · 最大 100 MB</small>{materials.length > 0 && <p>或从左侧目录打开已有课件。</p>}</div>}
      {selected && !resetting && <><div className="documentHeading"><PdfIcon /><h1>{selected.filename.replace(/\.pdf$/i, '')}</h1><Tag>{selected.page_count}页</Tag></div>{documentLoading && <div className="loading" role="status"><Spin size="small" /> 正在加载课件…</div>}{pdf && <Reader key={selected.id} materialId={selected.id} pages={pages} pdf={pdf} store={store} onFailure={message => toast.error({ title: message, duration: ERROR_DURATION, key: 'page-settings' })} mode={mode} onMode={changeMode} reader={reader} pageNavigator={pageNavigator} onSettings={settings => setPages(old => old.map(page => { const next = settings.find(item => item.id === page.id); return next ? { ...page, display: next.display, settings_version: next.settings_version } : page }))} />}</>}
      {selected && originalUnavailable && !resetting && <Empty className="originalUnavailable" description="原始 PDF 丢失或无法读取，已保存的笔记仍在。" />}
    </main></section>
    {target && targetMaterial && targetLocation && <ConflictPage key={target.url} material={targetMaterial} number={targetLocation.number} entry={target} store={store} onReturn={() => { setTargetUrl(''); if (reader.current) reader.current.scrollTop = returnPosition.current }} />}
    </div>
    <ImportDialog open={importOpen} directory={directory} course={destinationCourse} chapter={importChapter} file={importFile} busy={uploading || directoryBusy || loading}
      checking={checkingFile} checkError={checkedImport?.error} pageCount={checkedImport?.pageCount} encrypted={checkedImport?.encrypted ?? false} error={importError?.message ?? ''} duplicate={duplicatePath ?? undefined}
      onOpenExisting={() => void openExisting()} onCopy={() => void upload(importFile ?? undefined, true)} onCourse={id => { setImportCourse(id); setImportChapter('') }} onChapter={setImportChapter} onFile={file => { setImportFile(file); setUploadDuplicate(null); setImportError(null) }}
      onReload={importError?.reload ? () => { void loadMaterials(setImportError); setImportCourse(''); setImportChapter('') } : undefined} onClose={closeImport} onSubmit={() => void upload(importFile ?? undefined)} onCreate={(name, isChapter) => isChapter ? mutateDirectory('/api/chapters', 'POST', { name, course_id: destinationCourse }) : mutateDirectory('/api/courses', 'POST', { name })} />

    {settingsOpen && <SystemSettings readOnly={readOnly} mode={displayMode} selectMode={selectMode} onClose={() => setSettingsOpen(false)}
      canReset={!readOnly && !uploading && !resetting && !directoryBusy && !loading}
      onReset={backup => { setSettingsOpen(false); void replaceAllData(backup) }}
      onRestore={id => { setSettingsOpen(false); void replaceAllData(false, id) }} />}
  </div></WorkspaceTheme>
}
