import { useEffect, useRef, useState } from 'react'
import type { Directory } from './api'

export function ImportDialog({ directory, course, chapter, file, busy, error, duplicate, onOpenExisting, onCourse, onChapter, onFile, onReload, onClose, onSubmit, onCreate }: {
  directory: Directory; course: string; chapter: string; file: File | null; busy: boolean; error: string; duplicate?: string; onOpenExisting: () => void
  onCourse: (id: string) => void; onChapter: (id: string) => void; onFile: (file: File | null) => void
  onReload: () => void; onClose: () => void; onSubmit: () => void; onCreate: (name: string) => Promise<boolean>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  return <dialog ref={dialog} className="importDialog" aria-labelledby="importTitle" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="importTitle">导入 PDF 课件</h2>
    <p>选择课程与章节，笔记将随课件一起归档。</p>
    <label>课程<select autoFocus aria-label="导入到课程" disabled={busy} value={course} onChange={event => onCourse(event.target.value)}><option value="" disabled>请选择课程</option>{directory.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>章节（可选）<select aria-label="导入到章节" disabled={busy || !course} value={chapter} onChange={event => onChapter(event.target.value)}><option value="">课程直属（无章节）</option>{directory.chapters.filter(c => c.course_id === course).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <form className="inlineCreate" onSubmit={event => { event.preventDefault(); void onCreate(name).then(ok => { if (ok) setName('') }) }}><input aria-label="新课程名称" placeholder="也可在此创建课程" maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /><button disabled={busy || !name.trim()}>创建课程</button></form>
    <button className="chooseFile" disabled={busy} onClick={() => fileInput.current?.click()}>{file ? file.name : '选择 PDF 文件'}</button>
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" aria-label="选择 PDF 课件" hidden onChange={event => onFile(event.target.files?.[0] ?? null)} />
    <small>最大 100 MB，也可先将 PDF 拖入工作区。</small>
    {duplicate && <div className="duplicateNotice" role="status"><strong>课件已存在</strong><p>所在位置：{duplicate}</p><p>未创建新课件，也未改变原归属。</p><button disabled={busy} onClick={onOpenExisting}>打开已有课件</button></div>}
    {error && <p role="alert" className="error">{error} <button disabled={busy} onClick={onReload}>重新加载目录</button></p>}
    <div className="dialogFooter"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !file || !course || !!duplicate} onClick={onSubmit}>{busy ? '正在处理…' : '确认导入'}</button></div>
  </dialog>
}
