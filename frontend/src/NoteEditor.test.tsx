import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { NoteEditor, MarkdownPreview } from './NoteEditor'
import { DraftStore } from './drafts'
import type { Page } from './api'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles.css', 'utf8')

const page: Page = { id: 'page-2', number: 2, note: '', version: 0, summary: '', summary_version: 0, qa: [] }
let store: DraftStore
function Editor() {
  const [, refresh] = useState(0)
  useEffect(() => store.subscribe(() => refresh(value => value + 1)), [])
  return <NoteEditor page={page} store={store} />
}
function start(expandNote = true) {
  store = new DraftStore(); store.bind(page); render(<Editor />)
  if (expandNote) fireEvent.click(screen.getByRole('button', { name: /个人笔记/ }))
}
afterEach(() => { cleanup(); store?.dispose(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps edits made during a save dirty and uses the updated version on the next save', async () => {
  let resolve!: (value: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done })).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, note: 'newer', version: 2 })))
  vi.stubGlobal('fetch', fetch)
  start()
  const input = screen.getByLabelText('个人笔记')
  fireEvent.change(input, { target: { value: 'first' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  fireEvent.change(input, { target: { value: 'newer' } })
  resolve(new Response(JSON.stringify({ ...page, note: 'first', version: 1 })))
  await waitFor(() => expect(store.entries['/api/pages/page-2/note'].pending).toBe(false))
  expect((input as HTMLTextAreaElement).value).toBe('newer')
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await waitFor(() => expect(store.dirtyPages).toBe(0))
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ note: 'newer', version: 1 })
})

it('retains input after network failure and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, version: 1 }))))
  start()
  const heading = screen.getByRole('button', { name: /个人笔记/ })
  expect(within(heading).queryByRole('img', { name: '未保存' })).toBeNull()
  fireEvent.change(screen.getByLabelText('个人笔记'), { target: { value: '保留我的笔记' } })
  expect(within(heading).getByRole('img', { name: '未保存' })).toBeTruthy()
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await screen.findByText('网络断开')
  expect(within(heading).getByRole('img', { name: '保存失败' })).toBeTruthy()
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('保留我的笔记')
  expect(localStorage.length).toBe(1)
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await waitFor(() => expect(store.dirtyPages).toBe(0))
  expect(localStorage.length).toBe(0)
  expect(within(heading).queryByRole('img', { name: /未保存|保存失败/ })).toBeNull()
})

it('shows server conflict and keeps draft until the user chooses a version', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '另一窗口已修改此页', current: { ...page, note: '服务器内容', version: 1 } }), { status: 409 })))
  start()
  fireEvent.change(screen.getByLabelText('个人笔记'), { target: { value: '我的草稿' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await screen.findByText(/服务器已有新版本/)
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('我的草稿')
  fireEvent.click(screen.getByText('使用服务器版本'))
  fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('服务器内容')
  expect(localStorage.length).toBe(0)
})

it('folds three sections independently and adds multiple question/answer editors', () => {
  start(false)
  expect(screen.getByRole('button', { name: /AI 解释与总结/ }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: /个人笔记/ }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByRole('button', { name: /追问与 AI 解答/ }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: /AI 解释与总结/ }))
  expect(screen.getByLabelText('AI 总结').closest('[inert]')).toBeTruthy()
  expect(screen.getByLabelText('个人笔记').closest('[inert]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /个人笔记/ }))
  expect(screen.getByLabelText('个人笔记').closest('[inert]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /追问与 AI 解答/ }))
  fireEvent.click(screen.getByRole('button', { name: /添加问答/ }))
  fireEvent.click(screen.getByRole('button', { name: /添加问答/ }))
  fireEvent.change(screen.getByLabelText('问题 2'), { target: { value: '为什么？' } })
  fireEvent.change(screen.getByLabelText('回答 2'), { target: { value: '**答案**' } })
  fireEvent.click(within(screen.getByLabelText('回答 2显示方式')).getByText('预览'))
  expect(screen.getByText('答案').tagName).toBe('STRONG')
  expect(screen.getByText('2 条问答')).toBeTruthy()
})

it('renders GFM tables and code without executing HTML or loading any images', () => {
  const { container } = render(<MarkdownPreview text={'| 列 | 值 |\n|---|---|\n| a | b |\n\n```js\nconst x = 1\n```\n\n<script>alert(1)</script>\n\n<img src="https://remote/track">\n\n![外部](https://remote/p.png)\n\n[坏链接](javascript:alert(1))'} />)
  expect(container.querySelector('table')).toBeTruthy()
  expect(container.querySelector('pre code')?.textContent).toContain('const x = 1')
  expect(container.querySelector('script, img')).toBeNull()
  expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:')
})

it('preserves QA after cancelled deletion and retries a failed deletion', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('删除失败')).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a'.repeat(32), question: 'q', answer: 'a', position: 1, version: 2, deleted: true })))
  vi.stubGlobal('fetch', fetch)
  store = new DraftStore()
  store.bind({ ...page, qa: [{ id: 'a'.repeat(32), question: 'q', answer: 'a', position: 1, version: 1, deleted: false }] })
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: /追问与 AI 解答/ }))
  fireEvent.click(screen.getByLabelText('删除问答'))
  expect(screen.getByLabelText('问题 1')).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }))
  fireEvent.click(screen.getByLabelText('删除问答'))
  fireEvent.click(await screen.findByRole('button', { name: /删\s*除$/ }))
  await screen.findByText('删除问答未完成：删除失败')
  expect(screen.getByText('1 条问答')).toBeTruthy()
  expect((screen.getByLabelText('问题 1') as HTMLTextAreaElement).value).toBe('q')
  fireEvent.keyDown(screen.getByLabelText('问题 1'), { key: 's', ctrlKey: true })
  await waitFor(() => expect(screen.queryByLabelText('问题 1')).toBeNull())
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ question: 'q', answer: 'a', deleted: true, version: 1 })
})


it('saves an edited summary by shortcut without adding footer controls', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...page, summary: 'edited', summary_version: 1 })))
  vi.stubGlobal('fetch', fetch)
  start()
  const input = screen.getByLabelText('AI 总结')
  fireEvent.focus(input)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'edited' } })
  expect(store.dirtyPages).toBe(1)
  fireEvent.keyDown(input, { key: 's', metaKey: true })
  await waitFor(() => expect(store.dirtyPages).toBe(0))
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ summary: 'edited', version: 0 })
  expect(screen.queryByRole('button', { name: '保存总结' })).toBeNull()
  expect((input as HTMLTextAreaElement).value).toBe('edited')
})

it('does not show save controls just because a loaded note has existing text', () => {
  store = new DraftStore(); store.bind({ ...page, note: 'existing', version: 2 })
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: /个人笔记/ }))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('existing')
  expect(screen.queryByText('保存笔记')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows recovered draft status without requiring another edit', () => {
  store = new DraftStore(); store.bind(page)
  store.edit(store.entries['/api/pages/page-2/note'], { note: 'recovered' }); store.dispose()
  start()
  expect(screen.getByText('已恢复本地草稿。')).toBeTruthy()
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('recovered')
  expect(store.dirtyPages).toBe(1)
})

it('labels and colors language code blocks while keeping plain, unknown, and inline code readable', () => {
  const { container } = render(<MarkdownPreview text={'```python\ndef hello():\n    return "world"\n```\n\n```js\nconst x = 3;\n```\n\n```unknown-language\n<script>literal code</script>\n```\n\n```\nplain text\n```\n\nInline `code`.'} />)
  expect(Array.from(container.querySelectorAll('.codeLanguage')).map(node => node.textContent)).toEqual(['python', 'js', 'unknown-language', '纯文本'])
  expect(container.querySelectorAll('.codeBlock')).toHaveLength(4)
  expect(container.querySelector('code.language-python .hljs-keyword')?.textContent).toBe('def')
  expect(container.querySelector('code.language-python .hljs-string')?.textContent).toBe('"world"')
  expect(container.querySelector('code.language-js .hljs-number')?.textContent).toBe('3')
  expect(container.querySelector('code.language-unknown-language')?.textContent).toContain('<script>literal code</script>')
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('p > code')?.textContent).toBe('code')
  const style = document.createElement('style'); style.textContent = styles; document.head.append(style)
  const keyword = container.querySelector('.hljs-keyword')!, string = container.querySelector('.hljs-string')!
  expect(getComputedStyle(keyword).color).toBe('var(--code-keyword)')
  expect(getComputedStyle(string).color).toBe('var(--positive)')
  style.remove()
})

it('retains editor identity and content across repeated collapse toggles', () => {
  start()
  const input = screen.getByLabelText('个人笔记')
  fireEvent.change(input, { target: { value: '折叠保留草稿' } })
  const heading = screen.getByRole('button', { name: /个人笔记/ })
  fireEvent.click(heading)
  expect(input.closest('[inert]')).toBeTruthy()
  fireEvent.click(heading)
  expect(screen.getByLabelText('个人笔记')).toBe(input)
  expect((input as HTMLTextAreaElement).value).toBe('折叠保留草稿')
  expect(input.closest('[inert]')).toBeNull()
})
