import { Children, isValidElement, useState, type ReactNode } from 'react'
import { Alert, Badge, Button, Collapse, Input, Popconfirm, Segmented } from 'antd'
import { DeleteOutlined, PlusOutlined, RightOutlined, } from '@ant-design/icons'
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
type NoteView = Map<string, boolean>
type SectionSaveStatus = '未保存' | '保存失败'

function sectionSaveStatus(store: DraftStore, entries: (Entry | undefined)[]): SectionSaveStatus | undefined {
  if (entries.some(entry => entry && (entry.error || entry.conflict))) return '保存失败'
  if (entries.some(entry => entry && store.dirty(entry))) return '未保存'
}

function Fold({ title, info, saveStatus, children, view, defaultOpen = false }: { title: string; info: string; saveStatus?: SectionSaveStatus; children: ReactNode; view?: NoteView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => view?.get(title) ?? defaultOpen)
  function changeOpen(next: boolean) {
    view?.set(title, next)
    setOpen(next)
  }
  return <section className="noteSection"><Collapse ghost bordered={false} size="small" activeKey={open ? ['body'] : []} onChange={keys => changeOpen(keys.length > 0)} destroyOnHidden={false}
    expandIcon={({ isActive }) => <RightOutlined aria-hidden="true" rotate={isActive ? 90 : 0} />}
    items={[{ key: 'body', label: <span className="noteTitle"><strong>{title}</strong><span className="noteTitleMeta">
      {info && <small>{info}</small>}
      {saveStatus && <span role="img" aria-label={saveStatus} title={saveStatus}><Badge status={saveStatus === '保存失败' ? 'error' : 'warning'} /></span>}
    </span></span>, forceRender: true,
      children: <div inert={!open} aria-hidden={!open}>{children}</div> }]} /></section>
}
function Field({ label, value, onChange, onSave, view, viewKey = label, readOnly = false }: { label: string; value: string; onChange: (value: string) => void; onSave: () => void; view?: NoteView; viewKey?: string; readOnly?: boolean }) {
  const key = 'preview:' + viewKey
  const [preview, setPreview] = useState(() => view?.get(key) ?? false)
  function changePreview(next: boolean) {
    view?.set(key, next)
    setPreview(next)
  }
  return <div className="markdownField"><div className="fieldHeading"><span className="fieldCaption">{label === 'AI 总结' || label === '个人笔记' ? '支持 Markdown' : label}</span><Segmented size="small" aria-label={`${label}显示方式`} value={preview ? 'preview' : 'edit'} options={[{ label: '编辑', value: 'edit' }, { label: '预览', value: 'preview' }]} onChange={value => changePreview(value === 'preview')} /></div><div className="editorCanvas" data-preview={preview}>{preview ? <MarkdownPreview text={value} /> : <Input.TextArea variant="borderless" autoSize={{ minRows: 4, maxRows: 20 }} aria-label={label} readOnly={readOnly} value={value} placeholder={label === 'AI 总结' ? '粘贴总结，或记录这页的要点…' : label === '个人笔记' ? '写下你的理解、疑问或补充…' : '在这里输入内容…'} onChange={event => onChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() } }} />}</div></div>
}
function SaveState({ entry, store }: { entry: Entry; store: DraftStore }) {
  return <>{entry.recovered && <Alert type="info" showIcon title="已恢复本地草稿。" />}{entry.error && <Alert type="error" showIcon title={entry.value.deleted ? '删除问答未完成：' + entry.error : entry.error} />}{entry.conflict && <Alert className="conflictBox" type="warning" showIcon title="服务器已有新版本，你的草稿仍保留。请对比后选择：" description={<><pre>{entry.conflict.value.deleted ? '此问答已在另一窗口删除。' : Object.values(entry.conflict.value).filter(value => typeof value === 'string').join('\n\n')}</pre><Popconfirm title="丢弃本地草稿，使用服务器版本？" okText="确认" cancelText="取消" onConfirm={() => store.resolve(entry, false)}><Button>使用服务器版本</Button></Popconfirm>{!entry.conflict.value.deleted && <Popconfirm title="以当前草稿覆盖上方服务器版本？" okText="确认" cancelText="取消" onConfirm={() => store.resolve(entry, true)}><Button>保留草稿并重新保存</Button></Popconfirm>}<p>可先复制输入框内容备份；已删除问答不能覆盖恢复。</p></>} />}{entry.missing && <Popconfirm title="丢弃此草稿？请先复制需要保留的内容。" okText="确认" cancelText="取消" onConfirm={() => store.discard(entry)}><Button>丢弃失效草稿</Button></Popconfirm>}</>
}
function countedQA(entry: Entry) {
  return !entry.value.deleted || (entry.version > 0 && !entry.saved.deleted && !entry.conflict?.value.deleted && !entry.missing)
}

export function NoteEditor({ page, store, focusKind, view }: { page: Pick<Page, 'id' | 'number'>; store: DraftStore; focusKind?: Entry['kind']; view?: NoteView }) {
  const entries = Object.values(store.entries).filter(entry => entry.pageId === page.id)
  const note = entries.find(entry => entry.kind === 'note')
  const summary = entries.find(entry => entry.kind === 'summary')
  const qa = entries.filter(entry => entry.kind === 'qa' && (!entry.value.deleted || store.dirty(entry) || entry.pending || entry.conflict || entry.error))
  if (!note || !summary) return null
  function deleteQA(entry: Entry) {
    store.edit(entry, { ...entry.value, deleted: true })
    void store.save(entry)
  }
  return <div className="notePanel" aria-label={`第 ${page.number} 页笔记`}>
    <Fold view={view} defaultOpen title="AI 解释与总结" saveStatus={sectionSaveStatus(store, [summary])} info={summary.value.summary ? '' : '暂无内容'}><Field view={view} readOnly={summary.missing} label="AI 总结" value={summary.value.summary ?? ''} onChange={text => store.edit(summary, { summary: text })} onSave={() => void store.save(summary)} /><SaveState entry={summary} store={store} /></Fold>
    <Fold view={view} defaultOpen={focusKind === 'note'} title="个人笔记" saveStatus={sectionSaveStatus(store, [note])} info={note.value.note ? '' : '暂无内容'}><Field view={view} readOnly={note.missing} label="个人笔记" value={note.value.note ?? ''} onChange={text => store.edit(note, { note: text })} onSave={() => void store.save(note)} /><SaveState entry={note} store={store} /></Fold>
    <Fold view={view} defaultOpen={focusKind === 'qa'} title="追问与 AI 解答" saveStatus={sectionSaveStatus(store, qa)} info={`${qa.filter(countedQA).length} 条问答`}>{qa.map((entry, index) => <div className="qaEntry" data-entry={entry.url} key={entry.id}><div className="qaHeading"><strong>问答 {index + 1}</strong><Popconfirm title="确定删除本问答？" okText="删除" cancelText="取消" trigger={['click']}
      disabled={!!entry.value.deleted || !!entry.pending || !!entry.conflict || entry.missing} onConfirm={() => void deleteQA(entry)}>
      <Button danger type="text" aria-label="删除问答" disabled={!!entry.value.deleted || !!entry.pending || !!entry.conflict || entry.missing}>
        <DeleteOutlined aria-hidden="true" />
      </Button></Popconfirm></div><Field view={view} readOnly={!!entry.value.deleted || entry.missing} label={`问题 ${index + 1}`} viewKey={entry.id + ':question'} value={entry.value.question ?? ''} onChange={question => store.edit(entry, { ...entry.value, question })} onSave={() => void store.save(entry)} /><Field view={view} readOnly={!!entry.value.deleted || entry.missing} label={`回答 ${index + 1}`} viewKey={entry.id + ':answer'} value={entry.value.answer ?? ''} onChange={answer => store.edit(entry, { ...entry.value, answer })} onSave={() => void store.save(entry)} /><SaveState entry={entry} store={store} /></div>)}<Button type="dashed" className="addQA" onClick={() => { const entry = store.add(page.id, 'qa', crypto.randomUUID().replaceAll('-', ''), { question: '', answer: '', deleted: false }, 0); store.edit(entry, entry.value) }}><PlusOutlined /> 添加问答</Button></Fold>
  </div>
}

export function NotePreview({ page, store, view }: { page: Page; store: DraftStore; view?: NoteView }) {
  const entries = Object.values(store.entries).filter(entry => entry.pageId === page.id)
  const note = entries.find(entry => entry.kind === 'note')
  const summary = entries.find(entry => entry.kind === 'summary')
  const qaEntries = entries.filter(entry => entry.kind === 'qa')
  const qa = qaEntries.filter(countedQA)
  return <div className="notePanel" aria-label={`第 ${page.number} 页笔记预览`}>
    <Fold view={view} defaultOpen title="AI 解释与总结" saveStatus={sectionSaveStatus(store, [summary])} info={summary?.value.summary ? '' : '暂无内容'}><MarkdownPreview text={summary?.value.summary ?? ''} /></Fold>
    <Fold view={view} defaultOpen title="个人笔记" saveStatus={sectionSaveStatus(store, [note])} info={note?.value.note ? '' : '暂无内容'}><MarkdownPreview text={note?.value.note ?? ''} /></Fold>
    <Fold view={view} defaultOpen title="追问与 AI 解答" saveStatus={sectionSaveStatus(store, qaEntries)} info={`${qa.length} 条问答`}>{qa.map((entry, index) => <div className="qaEntry" key={entry.id}><strong>问题 {index + 1}</strong><MarkdownPreview text={entry.value.question ?? ''} /><strong>回答 {index + 1}</strong><MarkdownPreview text={entry.value.answer ?? ''} /></div>)}</Fold>
  </div>
}
