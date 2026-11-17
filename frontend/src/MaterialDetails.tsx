import { FolderOpenOutlined, UploadOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Input, Modal } from 'antd'
import { api, ApiError, type Material, type MaterialDetails as Details } from './api'
import { PdfIcon } from './ReadingControls'
import { overlayContainer } from './theme'

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

export function MaterialDetails({ material, busy, onClose, onRename, onRestoreOriginal }: {
  material: Material
  busy: boolean
  onClose: () => void
  onRename: (title: string) => Promise<boolean>
  onRestoreOriginal: (file: File) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const [details, setDetails] = useState<Details | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [fileAction, setFileAction] = useState<'reveal' | 'restore' | null>(null)
  const [fileError, setFileError] = useState('')
  const originalInput = useRef<HTMLInputElement>(null)
  const fileAvailable = details !== null && details.size_bytes !== null

  useEffect(() => {
    const controller = new AbortController()
    api<Details>(`/api/materials/${material.id}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDetails(result) })
      .catch(cause => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : '无法读取文件详情。')
      })
    return () => controller.abort()
  }, [material.id, attempt])

  async function saveTitle() {
    const title = draft?.trim()
    if (draft === null || saving) return
    if (title === material.title) { setDraft(null); return }
    if (!title) { setSaveError('请输入文件标题。'); return }
    if (busy) { setSaveError('目录正在更新，请稍后重新编辑标题。'); return }
    setSaving(true)
    try {
      if (await onRename(title)) setDraft(null)
      else setSaveError('标题保存失败，请点击标题后再次移开焦点以重试。')
    } finally { setSaving(false) }
  }

  function checkFileAgain() {
    setDetails(null)
    setLoadError('')
    setAttempt(previous => previous + 1)
  }

  async function revealFile() {
    setFileAction('reveal')
    setFileError('')
    try {
      await api(`/api/materials/${material.id}/file/reveal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 410) checkFileAgain()
      else setFileError(cause instanceof Error ? cause.message : '无法打开原文件目录。')
    } finally { setFileAction(null) }
  }

  async function restoreFile(file: File) {
    setFileAction('restore')
    setFileError('')
    try {
      await onRestoreOriginal(file)
      checkFileAgain()
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : '原始 PDF 恢复失败。')
    } finally { setFileAction(null) }
  }

  return <Modal open={open} title="文件详情" footer={null} onCancel={() => setOpen(false)} afterClose={onClose}
    getContainer={overlayContainer} styles={{ header: { paddingBlockEnd: 12 } }}>
    <div className="materialDetailsHeading">
      <PdfIcon />
      <Input.TextArea className="materialTitleInput" aria-label="文件标题" aria-invalid={!!saveError}
        value={draft ?? material.title} maxLength={200} autoSize readOnly={busy || saving}
        onChange={event => { setDraft(event.target.value); setSaveError('') }}
        onBlur={() => void saveTitle()}
        onPressEnter={event => {
          if (event.nativeEvent.isComposing) return
          event.preventDefault()
          event.currentTarget.blur()
        }} />
    </div>
    <dl className="materialDetailsList">
      <dt>原文件状态</dt><dd className="materialFileStatus">
        <span role="status"><Badge status={details ? (fileAvailable ? 'success' : 'error') : loadError ? 'error' : 'warning'}
          text={details ? (fileAvailable ? '正常' : '缺失') : loadError ? '查找失败' : '正在查找'} /></span>
        {fileAvailable && <Button type="link" size="small" icon={<FolderOpenOutlined />} loading={fileAction === 'reveal'}
          onClick={() => void revealFile()}>打开目录</Button>}
        {details && !fileAvailable && <Button size="small" icon={<UploadOutlined />} disabled={busy}
          loading={fileAction === 'restore'} onClick={() => originalInput.current?.click()}>重新导入</Button>}
        <input hidden ref={originalInput} type="file" accept="application/pdf,.pdf" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void restoreFile(file)
        }} />
      </dd>
      {details && <>
        <dt>原始文件名</dt><dd>{details.original_title ?? '未记录'}</dd>
        <dt>文件大小</dt><dd>{details.size_bytes === null ? '文件不可用' : formatFileSize(details.size_bytes)}</dd>
        <dt>目录路径</dt><dd>{[details.location.course_name, details.location.chapter_name].filter(Boolean).join(' / ')}</dd>
        <dt>导入时间</dt><dd>{details.imported_at ? new Date(details.imported_at).toLocaleString('zh-CN') : '未记录'}</dd>
        <dt>已保存笔记条数</dt><dd>{details.note_count} 条</dd>
        <dd className="materialNoteBreakdown">
          <dl className="materialDetailsList">
            <dt>AI 解释与总结</dt><dd>{details.note_counts.ai_summary} 条</dd>
            <dt>个人笔记</dt><dd>{details.note_counts.personal_note} 条</dd>
            <dt>问答总条数</dt><dd>{details.note_counts.qa} 条</dd>
          </dl>
        </dd>
      </>}
    </dl>
    {saveError && <Alert showIcon type="error" title={saveError} />}
    {fileError && <Alert showIcon type="error" title={fileError} />}
    {loadError && <Alert showIcon type="error" title={loadError} action={<Button onClick={checkFileAgain}>重试</Button>} />}
  </Modal>
}
