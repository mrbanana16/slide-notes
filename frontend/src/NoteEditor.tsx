import { Children, isValidElement, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Page } from './api'
import { DraftStore, type Entry } from './drafts'

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children)[0]
  const language = isValidElement<{ className?: string }>(code)
    ? /\blanguage-([^\s]+)/.exec(code.props.className ?? '')?.[1]
    : undefined
  return <div className="codeBlock"><div className="codeLanguage">{language || '纯文本'}</div><pre>{children}</pre></div>
}

export function MarkdownPreview({ text }: { text: string }) {
  return <div className="markdownPreview"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} skipHtml components={{ pre: CodeBlock, img: ({ alt }) => <span className="imageOmitted">[图片未加载：{alt || '图片'}]</span>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text || '暂无内容'}</Markdown></div>
}
function Fold({ title, info, children, defaultOpen = false }: { title: string; info: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="noteSection"><button className="foldHeading" aria-expanded={open} onClick={() => setOpen(!open)}><strong>{title}</strong><small>{info}</small><span aria-hidden="true">{open ? '▾' : '▸'}</span></button><div hidden={!open}>{children}</div></section>
}
function Field({ label, value, onChange, onSave, readOnly = false }: { label: string; value: string; onChange: (value: string) => void; onSave: () => void; readOnly?: boolean }) {
  const [preview, setPreview] = useState(false)
  return <div className="markdownField"><div className="fieldHeading"><label>{label}</label><button aria-label={`${label}${preview ? '编辑' : '预览'}`} aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '编辑' : '预览'}</button></div>{preview ? <MarkdownPreview text={value} /> : <textarea aria-label={label} readOnly={readOnly} value={value} placeholder="支持 Markdown、表格和代码块…" onChange={event => onChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() } }} />}</div>
}
function SaveState({ entry, store, label }: { entry: Entry; store: DraftStore; label: string }) {
  const dirty = store.dirty(entry)
  if (!entry.edited && !dirty && !entry.recovered && !entry.error) return null
  return <><div className="noteFooter"><span role="status" className={entry.error && !entry.pending ? 'saveError' : dirty || entry.conflict ? 'unsaved' : 'saved'}>{entry.pending ? '保存中…' : entry.conflict ? '版本冲突' : entry.error ? '保存失败' : dirty ? '未保存' : '已保存'}</span><button disabled={!dirty || entry.pending || !!entry.conflict || entry.missing} onClick={() => void store.save(entry)}>{entry.error ? '重试保存' : `保存${label}`}</button></div>{entry.recovered && <p className="recoveryNotice">已恢复本地草稿。</p>}{entry.error && <p role="alert" className="error">{entry.error}</p>}{entry.conflict && <div className="conflictBox"><p>服务器已有新版本，你的草稿仍保留。请对比后选择：</p><pre>{entry.conflict.value.deleted ? '此问答已在另一窗口删除。' : Object.values(entry.conflict.value).filter(value => typeof value === 'string').join('\n\n')}</pre><button onClick={() => { if (window.confirm('丢弃本地草稿，使用服务器版本？')) store.resolve(entry, false) }}>使用服务器版本</button>{!entry.conflict.value.deleted && <button onClick={() => { if (window.confirm('以当前草稿覆盖上方服务器版本？')) store.resolve(entry, true) }}>保留草稿并重新保存</button>}<p>可先复制输入框内容备份；已删除问答不能覆盖恢复。</p></div>}{entry.missing && <button onClick={() => { if (window.confirm('丢弃此草稿？请先复制需要保留的内容。')) store.discard(entry) }}>丢弃失效草稿</button>}</>
}
export function NoteEditor({ page, store }: { page: Page; store: DraftStore }) {
  const entries = Object.values(store.entries).filter(entry => entry.pageId === page.id)
  const note = entries.find(entry => entry.kind === 'note')
  const summary = entries.find(entry => entry.kind === 'summary')
  const qa = entries.filter(entry => entry.kind === 'qa' && (!entry.value.deleted || store.dirty(entry) || entry.pending || entry.conflict || entry.error))
  if (!note || !summary) return null
  return <div className="notePanel" aria-label={`第 ${page.number} 页笔记`}>
    <Fold defaultOpen title="AI 解释与总结" info={summary.value.summary ? '已有内容' : '暂无内容'}><p className="sectionHint">手动整理或粘贴 AI 总结</p><Field readOnly={summary.missing} label="AI 总结" value={summary.value.summary ?? ''} onChange={text => store.edit(summary, { summary: text })} onSave={() => void store.save(summary)} /><SaveState entry={summary} store={store} label="总结" /></Fold>
    <Fold title="个人笔记" info={note.value.note ? '已有内容' : '暂无内容'}><Field readOnly={note.missing} label="个人笔记" value={note.value.note ?? ''} onChange={text => store.edit(note, { note: text })} onSave={() => void store.save(note)} /><SaveState entry={note} store={store} label="笔记" /></Fold>
    <Fold title="追问与 AI 解答" info={`${qa.filter(entry => !entry.value.deleted).length} 条问答`}>{qa.map((entry, index) => <div className="qaEntry" key={entry.id}><div className="qaHeading"><strong>问答 {index + 1}</strong><button disabled={!!entry.value.deleted || !!entry.conflict || entry.missing} onClick={() => { if (window.confirm('删除这条问答及其草稿？')) store.edit(entry, { ...entry.value, deleted: true }) }}>删除问答</button></div>{entry.value.deleted && <p>正在删除；失败时可重试。</p>}<Field readOnly={!!entry.value.deleted || entry.missing} label={`问题 ${index + 1}`} value={entry.value.question ?? ''} onChange={question => store.edit(entry, { ...entry.value, question })} onSave={() => void store.save(entry)} /><Field readOnly={!!entry.value.deleted || entry.missing} label={`回答 ${index + 1}`} value={entry.value.answer ?? ''} onChange={answer => store.edit(entry, { ...entry.value, answer })} onSave={() => void store.save(entry)} /><SaveState entry={entry} store={store} label="问答" /></div>)}<button className="addQA" onClick={() => { const entry = store.add(page.id, 'qa', crypto.randomUUID().replaceAll('-', ''), { question: '', answer: '', deleted: false }, 0); store.edit(entry, entry.value) }}>＋ 添加问答</button></Fold>
  </div>
}

export function NotePreview({ page, store }: { page: Page; store: DraftStore }) {
  const entries = Object.values(store.entries).filter(entry => entry.pageId === page.id)
  const note = entries.find(entry => entry.kind === 'note')
  const summary = entries.find(entry => entry.kind === 'summary')
  const qa = entries.filter(entry => entry.kind === 'qa' && !entry.value.deleted)
  return <div className="notePanel" aria-label={`第 ${page.number} 页笔记预览`}>
    <Fold defaultOpen title="AI 解释与总结" info={summary?.value.summary ? '已有内容' : '暂无内容'}><MarkdownPreview text={summary?.value.summary ?? ''} /></Fold>
    <Fold defaultOpen title="个人笔记" info={note?.value.note ? '已有内容' : '暂无内容'}><MarkdownPreview text={note?.value.note ?? ''} /></Fold>
    <Fold defaultOpen title="追问与 AI 解答" info={`${qa.length} 条问答`}>{qa.map((entry, index) => <div className="qaEntry" key={entry.id}><strong>问题 {index + 1}</strong><MarkdownPreview text={entry.value.question ?? ''} /><strong>回答 {index + 1}</strong><MarkdownPreview text={entry.value.answer ?? ''} /></div>)}</Fold>
  </div>
}
