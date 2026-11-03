import { useRef, useState } from 'react'
import { api, type Page } from './api'

export type Draft = { text: string; saved: string; version: number }

export function NoteEditor({ page, draft, onChange, onSaved }: {
  page: Page; draft: Draft; onChange: (text: string) => void; onSaved: (text: string, version: number) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const dirty = draft.text !== draft.saved
  async function save() {
    if (pending.current || !dirty) return
    pending.current = true
    setSaving(true)
    setError('')
    const text = draft.text
    try {
      const result = await api<Page>(`/api/pages/${page.id}/note`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: text, version: draft.version }),
      })
      onSaved(text, result.version)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally { pending.current = false; setSaving(false) }
  }
  return <section className="notePanel" aria-label={`第 ${page.number} 页个人笔记`}>
    <div className="noteHeading"><label htmlFor={`note-${page.id}`}>个人笔记</label><span role="status" className={dirty || error ? 'unsaved' : 'saved'}>{saving ? '保存中…' : error ? '保存失败' : dirty ? '未保存' : '已保存'}</span></div>
    <textarea id={`note-${page.id}`} value={draft.text} placeholder="记下这一页的重点、理解或疑问…" onChange={event => onChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save() } }} />
    {error && <p role="alert" className="error">{error}</p>}
    <div className="noteFooter"><span>支持纯文本及 Markdown 源码</span><button onClick={() => void save()} disabled={!dirty || saving}>{saving ? '保存中…' : error ? '重试保存' : '保存笔记'}</button></div>
  </section>
}
