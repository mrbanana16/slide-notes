import { chooseOption, directoryAction, openMaterial } from './testInteractions'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist'
import { createHash } from 'node:crypto'
import App from '../src/App'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 1, getPermissions: () => Promise.resolve(null) }),
    destroy: () => Promise.resolve(),
  })),
}))
vi.mock('../src/PdfPage', () => ({ PdfPage: ({ number }: { number: number }) => <div>PDF 第 {number} 页</div> }))

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  vi.stubGlobal('crypto', {
    randomUUID: crypto.randomUUID.bind(crypto),
    subtle: { digest: async (_algorithm: string, bytes: ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes)).digest() },
  })
  vi.stubGlobal('File', class extends File {
    arrayBuffer() {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  })
})

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const materials = [
  { id: 'a', filename: '第一份.pdf', page_count: 1, course_id: 'course', chapter_id: null, position: 0 },
  { id: 'b', filename: '第二份.pdf', page_count: 1, course_id: 'course', chapter_id: null, position: 1 },
]

const system = { id: 'system', name: '未分类', position: 0, is_system: true }
const directory = (items = materials) => ({ revision: 0, courses: [system, { id: 'course', name: '数据结构', position: 1 }], chapters: [], materials: items })
const duplicateLookup = '/api/materials/duplicates?sha256='

it('keeps unsaved notes bound to their page when switching materials and warns before closing', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return Response.json({ error: '保存暂不可用' }, { status: 503 })
    const result = url === '/api/directory' ? directory() : [{ id: url.includes('/a/') ? 'page-a' : 'page-b', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result))
  }))
  render(<App />)
  await openMaterial('第一份.pdf')
  const firstInput = await screen.findByLabelText('个人笔记')
  fireEvent.change(firstInput, { target: { value: '只属于第一份' } })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  await openMaterial('第二份.pdf')
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe(''))
  await openMaterial('第一份.pdf')
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('只属于第一份'))
  expect(screen.getByRole('button', { name: /^(1 页未保存|保存失败)$/ })).toBeTruthy()
})

it('imports a PDF and opens its stable page', async () => {
  let imported = false
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith(duplicateLookup)) return Response.json(null)
    if (options?.method === 'POST') imported = true
    const result = options?.method === 'POST' ? materials[0] : url === '/api/directory' ? directory(imported ? [materials[0]] : []) : [{ id: 'new-page', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result), { status: options?.method === 'POST' ? 201 : 200 })
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('从一份课件开始')
  const file = new File(['%PDF'], '第一份.pdf', { type: 'application/pdf' })
  fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText('确认导入').closest('button')?.disabled).toBe(false))
  fireEvent.click(screen.getByText('确认导入'))
  await screen.findByLabelText('个人笔记')
  const upload = fetch.mock.calls.find(call => call[1]?.method === 'POST')
  expect((upload?.[1]?.body as FormData).get('file')).toBe(file)
  expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
})

it.each([
  ['PasswordException', '此 PDF 需要打开密码，请先解除密码保护后重新选择。', '- 页'],
  ['InvalidPDFException', 'PDF 已损坏或格式无效，无法读取。', '- 页'],
  ['empty', 'PDF 中没有页面。', '0 页'],
] as const)('checks %s immediately and shows the page count in the selected file row', async (kind, message, pageLabel) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith(duplicateLookup) ? null : directory())))
  if (kind === 'empty') {
    vi.mocked(getDocument).mockImplementationOnce(() => ({
      promise: Promise.resolve({ numPages: 0, getPermissions: () => Promise.resolve(null) }),
      destroy: () => Promise.resolve(),
    } as unknown as ReturnType<typeof getDocument>))
  } else {
    vi.mocked(getDocument).mockImplementationOnce(() => ({
      promise: Promise.reject(Object.assign(new Error(message), { name: kind })),
      destroy: () => Promise.resolve(),
    } as unknown as ReturnType<typeof getDocument>))
  }
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF'], '待检查.pdf')] } })
  await screen.findByText(message)
  expect(screen.getByText(/待检查\.pdf/).parentElement?.textContent).toContain(pageLabel)
  expect(screen.getByText('确认导入').closest('button')?.disabled).toBe(true)
})

it('opens the existing material on duplicate import without adding a directory entry', async () => {
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => {
    const result = url.startsWith(duplicateLookup) ? { ...materials[0], duplicate: true, location: { course_name: '数据结构', chapter_name: null } } : url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: 'existing note', version: 1 }]
    return new Response(JSON.stringify(result))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF'], 'renamed.pdf')] } })
  await screen.findByText('课件已存在')
  expect(fetch.mock.calls.some(([url]) => url === duplicateLookup + createHash('sha256').update('%PDF').digest('hex'))).toBe(true)
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  expect(screen.getByText(/所在位置：数据结构 \/ 第一份\.pdf/)).toBeTruthy()
  expect(screen.queryByLabelText('个人笔记')).toBeNull()
  fireEvent.click(screen.getByText('打开已有课件'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('existing note'))
  expect(screen.getByRole('navigation', { name: '课程结构' }).querySelectorAll('.material')).toHaveLength(2)
})

it('offers a copy immediately for an external duplicate file drop', async () => {
  const copy = { ...materials[0], id: 'copy', filename: '第一份（副本 1）.pdf' }
  let created = false
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith(duplicateLookup)) return Response.json({ ...materials[0], duplicate: true })
    if (options?.method === 'POST') {
      if ((options.body as FormData).get('create_copy') === 'true') {
        created = true
        return Response.json(copy, { status: 201 })
      }
      return Response.json({ ...materials[0], duplicate: true })
    }
    return Response.json(url === '/api/directory' ? directory(created ? [...materials, copy] : materials) : [])
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['%PDF'], '第一份.pdf')] } })
  await screen.findByText('课件已存在')
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '创建副本' }))
  await screen.findByRole('heading', { name: '第一份（副本 1）' })
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

it('shows a missing original in the reading area and retries the same material after replacement', async () => {
  const page = { id: 'p1', number: 1, note: 'kept note', version: 1 }
  const first = vi.mocked(getDocument)
  first.mockImplementationOnce(() => ({
    promise: Promise.reject(Object.assign(new Error('Gone'), { status: 410 })),
    destroy: () => Promise.resolve(),
  } as ReturnType<typeof getDocument>))
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return Response.json({ restored: true })
    return Response.json(url === '/api/directory' ? directory() : [page])
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  await within(screen.getByRole('main')).findByText('原始 PDF 丢失或无法读取，已保存的笔记仍在。')
  expect(screen.getByRole('button', { name: '重新导入原文件' })).toBeTruthy()
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF'], '第一份.pdf')] } })
  expect((await screen.findByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('kept note')
  expect(fetch.mock.calls.some(([url, options]) => url === '/api/materials/a/file' && options?.method === 'PUT')).toBe(true)
})

it('does not reset when the user cancels confirmation', async () => {
  const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(directory())))
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByText('系统设置'))
  fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(fetch.mock.calls.some(([url]) => url === '/api/reset')).toBe(false)
  expect(screen.getByText('第一份.pdf')).toBeTruthy()
})

it('clears materials and unsaved drafts after confirmed reset, including a late save response', async () => {
  let finishSave!: (response: Response) => void
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return await new Promise<Response>(resolve => { finishSave = resolve })
    const result = url === '/api/reset' ? { reset: true, directory: { revision: 1, courses: [system], chapters: [], materials: [] } } : url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: 'erase my draft' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  fireEvent.click(screen.getByText('系统设置'))
  fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))
  fireEvent.click(screen.getByRole('button', { name: '确认清空' }))
  await screen.findByText('全部数据已清空，可以重新导入课件。')
  finishSave(new Response(JSON.stringify({ id: 'page-a', number: 1, note: 'erase my draft', version: 1 })))
  await waitFor(() => expect(screen.queryByText('1 页未保存')).toBeNull())
  expect(screen.queryByText('第一份.pdf')).toBeNull()
  expect(screen.getByText('从一份课件开始')).toBeTruthy()
  const resetCall = fetch.mock.calls.find(call => call[0] === '/api/reset')
  expect(JSON.parse(resetCall?.[1]?.body as string)).toEqual({ confirmation: 'DELETE_ALL_DATA' })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it('keeps the current draft if reset fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return Response.json({ error: '保存暂不可用' }, { status: 503 })
    if (url === '/api/reset') return new Response(JSON.stringify({ error: '清空失败' }), { status: 500 })
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  }))
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: 'keep on failure' } })
  fireEvent.click(screen.getByText('系统设置'))
  fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))
  fireEvent.click(screen.getByRole('button', { name: '确认清空' }))
  await screen.findByText('清空失败')
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('keep on failure'))
  expect(screen.getByRole('button', { name: /^(1 页未保存|保存失败)$/ })).toBeTruthy()
})

it('moves the open material without reloading its pages or losing an unsaved draft', async () => {
  const initial = { ...directory(), chapters: [{ id: 'chapter', course_id: 'course', name: '第一章', position: 0 }] }
  const moved = { ...initial, revision: 1, materials: initial.materials.map(m => m.id === 'a' ? { ...m, chapter_id: 'chapter' } : m) }
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/directory/order') return new Response(JSON.stringify(moved))
    if (options?.method === 'PUT') return new Response(JSON.stringify({ error: '离线' }), { status: 500 })
    return new Response(JSON.stringify(url === '/api/directory' ? initial : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '移动中保持的草稿' } })
  await directoryAction('第一份.pdf', '移动到')
  await chooseOption('移动第一份.pdf到章节', '第一章')
  fireEvent.click(screen.getByRole('button', { name: /移\s*动/ }))
  await screen.findByText('目录已保存。')
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('移动中保持的草稿')
  expect(fetch.mock.calls.filter(call => call[0] === '/api/materials/a/pages')).toHaveLength(1)
  const mutation = fetch.mock.calls.find(call => call[0] === '/api/directory/order')!
  const body = JSON.parse(mutation[1]!.body as string)
  expect(body.revision).toBe(0)
  expect(body.material_ids.chapter).toEqual(['a'])
  expect(screen.getByRole('button', { name: /^(1 页未保存|保存失败)$/ })).toBeTruthy()
})

it('preserves the old directory and draft on stale order, then reloads the current directory', async () => {
  let reads = 0
  const initial = directory()
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT' && url !== '/api/directory/order') return Response.json({ error: '保存失败' }, { status: 503 })
    if (url === '/api/directory/order') return new Response(JSON.stringify({ error: '目录已在其他窗口更新，请重新加载目录后再操作；笔记草稿仍保留。' }), { status: 409 })
    if (url === '/api/directory') return new Response(JSON.stringify(reads++ ? { ...initial, revision: 2, materials: [...materials].reverse() } : initial))
    return new Response(JSON.stringify([{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '冲突仍保留' } })
  await directoryAction('第一份.pdf', '下移')
  await screen.findByText(/目录已在其他窗口更新/)
  expect(screen.getByRole('navigation', { name: '课程结构' }).querySelector('.material strong')?.textContent).toBe('第一份.pdf')
  fireEvent.click(screen.getByText('重新加载'))
  await waitFor(() => expect(screen.getByRole('navigation', { name: '课程结构' }).querySelector('.material strong')?.textContent).toBe('第二份.pdf'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('冲突仍保留'))
})

it('shows saved note counts, cancels deletion, and clears only the confirmed material drafts', async () => {
  let finishSave!: (response: Response) => void
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/materials/a' && options?.method === 'DELETE') return new Response(JSON.stringify({ ...directory([materials[1]]), revision: 1 }))
    if (url === '/api/materials/a') return new Response(JSON.stringify({ ...materials[0], note_count: 3, page_ids: ['page-a'] }))
    if (options?.method === 'PUT') return await new Promise<Response>(resolve => { finishSave = resolve })
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '删除的草稿' } })
  await directoryAction('第一份.pdf', '删除课件')
  const description = await screen.findByText(/3 条已保存笔记／问答/)
  expect(description.textContent).toContain('1 处未保存编辑')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fetch.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('删除的草稿')
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await directoryAction('第一份.pdf', '删除课件')
  fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
  await screen.findByText('课件及其关联笔记已删除。')
  finishSave(new Response(JSON.stringify({ id: 'page-a', number: 1, note: '迟到保存', version: 1 })))
  await waitFor(() => expect(screen.queryByText('1 页未保存')).toBeNull())
  expect(screen.queryByText('第一份.pdf')).toBeNull()
  expect(screen.getByText('第二份.pdf')).toBeTruthy()
  expect(localStorage.length).toBe(0)
})

it('imports to the selected course and optional chapter only after explicit confirmation', async () => {
  const initial = { ...directory(), chapters: [{ id: 'chapter', course_id: 'course', name: '第一章', position: 0 }] }
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith(duplicateLookup)) return Response.json(null)
    if (options?.method === 'POST') return new Response(JSON.stringify(materials[0]))
    return new Response(JSON.stringify(url === '/api/directory' ? initial : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
  await chooseOption('导入到课程', '数据结构')
  await chooseOption('导入到章节', '第一章')
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF'], '新课件.pdf')] } })
  await waitFor(() => expect(screen.getByText('确认导入').closest('button')?.disabled).toBe(false))
  expect(fetch.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false)
  fireEvent.click(screen.getByText('确认导入'))
  await screen.findByLabelText('个人笔记')
  const form = fetch.mock.calls.find(call => call[1]?.method === 'POST')![1]!.body as FormData
  expect(form.get('course_id')).toBe('course')
  expect(form.get('chapter_id')).toBe('chapter')
})

it('creates a first course inside the import dialog and selects it for upload', async () => {
  const initial = { revision: 1, courses: [system], chapters: [], materials: [] }
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/courses') return new Response(JSON.stringify({ ...directory([]), revision: 2 }), { status: 201 })
    if (url === '/api/chapters') return Response.json({ ...directory([]), revision: 3, chapters: [{ id: 'created', course_id: 'course', name: '绪论', position: 0 }] })

    if (url === '/api/materials' && options?.method === 'POST') return new Response(JSON.stringify(materials[0]))
    return new Response(JSON.stringify(url === '/api/directory' ? (options ? directory() : initial) : []))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByLabelText('收起未分类')
  fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
  fireEvent.mouseDown(screen.getByLabelText('导入到课程'))
  expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('新课程名称'), { target: { value: '数据结构' } })
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => expect(screen.getByLabelText('导入到课程').closest('.destinationChoice')?.textContent).toContain('数据结构'))
  const creation = fetch.mock.calls.find(call => call[0] === '/api/courses')!
  expect(JSON.parse(creation[1]!.body as string)).toEqual({ revision: 1, name: '数据结构' })
  fireEvent.mouseDown(screen.getByLabelText('导入到章节'))
  fireEvent.change(screen.getByLabelText('新章节名称'), { target: { value: '绪论' } })
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => expect(screen.getByLabelText('导入到章节').closest('.destinationChoice')?.textContent).toContain('绪论'))
  expect(JSON.parse(fetch.mock.calls.find(call => call[0] === '/api/chapters')![1]!.body as string)).toEqual({ revision: 2, course_id: 'course', name: '绪论' })
  fireEvent.click(screen.getByText('取消'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fetch.mock.calls.some(call => call[0] === '/api/materials')).toBe(false)
})

it('keeps the open editor and draft after material deletion fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/status') return Response.json({ status: 'ok' })
    if (options?.method === 'PUT') return Response.json({ error: '保存暂不可用' }, { status: 503 })
    if (url === '/api/materials/a' && options?.method === 'DELETE') return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 })
    if (url === '/api/materials/a') return new Response(JSON.stringify({ ...materials[0], note_count: 0, page_ids: ['page-a'] }))
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  }))
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '失败保留' } })
  await directoryAction('第一份.pdf', '删除课件')
  fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
  await screen.findByText('删除失败')
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('失败保留')
  expect(screen.getByRole('button', { name: /^(1 页未保存|保存失败)$/ })).toBeTruthy()
  expect(localStorage.length).toBeGreaterThan(0)
})

it('allows theme changes while disconnected, retries status and restores the preference on reload', async () => {
  let online = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/status' && online) return Response.json({ status: 'ok', started_at: '2026-11-05T00:00:00Z' })
    throw new TypeError('Failed to fetch')
  }))
  const app = render(<App />)
  fireEvent.click(screen.getByText('系统设置'))
  expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeTruthy()
  await screen.findByText('连接失败，请检查后端服务')
  fireEvent.click(screen.getByLabelText('深色'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  online = true
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByText('在线')
  app.unmount()
  render(<App />)
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('follows live system changes unless an explicit display mode is selected', async () => {
  const media = Object.assign(new EventTarget(), { matches: true })
  vi.stubGlobal('matchMedia', (query: string) => query.includes('color-scheme') ? media : Object.assign(new EventTarget(), { matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/status'
    ? { status: 'ok', started_at: '2026-11-05T00:00:00Z' } : url === '/api/directory' ? directory() : [{ id: 'p1', number: 1, note: '', version: 0 }])))
  render(<App />)
  await openMaterial('第一份.pdf')
  const editor = await screen.findByLabelText('个人笔记') as HTMLTextAreaElement
  fireEvent.change(editor, { target: { value: '切换时保留草稿' } })
  expect(document.documentElement.dataset.theme).toBe('dark')
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')) })
  expect(document.documentElement.dataset.theme).toBe('light')
  fireEvent.click(screen.getByText('系统设置'))
  fireEvent.click(screen.getByLabelText('浅色'))
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(document.documentElement.dataset.theme).toBe('light')
  fireEvent.click(screen.getByLabelText('跟随系统'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByLabelText('个人笔记')).toBe(editor)
  expect(editor.value).toBe('切换时保留草稿')
})

it('hydrates the stored dark theme directly and batches a later change in one view transition', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => Object.assign(new EventTarget(), { media: query, matches: false, onchange: null, addListener() {}, removeListener() {} }))
  localStorage.setItem('slide-notes:display-mode', 'dark')
  const start = vi.fn((update: () => void) => ({ finished: Promise.resolve().then(update), skipTransition: vi.fn() }))
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
  try {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/status'
      ? { status: 'ok', started_at: '2026-11-05T00:00:00Z' } : directory())))
    render(<App />)
    await screen.findByText('第一份.pdf')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('系统设置'))
    fireEvent.click(screen.getByLabelText('浅色'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute('data-theme-switch')).toBe(false)
  } finally {
    Reflect.deleteProperty(document, 'startViewTransition')
  }
})

it('opens the narrow directory as a drawer and keeps the selected page on screen', async () => {
  vi.stubGlobal('matchMedia', (media: string) => Object.assign(new EventTarget(), {
    media, matches: media === '(max-width: 740px)', addListener() {}, removeListener() {},
  }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/directory' ? directory()
    : [{ id: 'p1', number: 1, note: '已保存', version: 1 }])))
  render(<App />)
  await screen.findByText('从一份课件开始')
  expect(screen.queryByRole('navigation', { name: '课程结构' })).toBeNull()
  fireEvent.click(screen.getByLabelText('展开目录'))
  await openMaterial('第一份.pdf')
  await screen.findByText('PDF 第 1 页')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByLabelText('暂无保存记录')).toBeTruthy()
})

it('keeps a background conflict visible after another save succeeds and returns to the original material', async () => {
  let finish!: (r: Response) => void
  const a = { id: 'page-a', number: 1, note: '', version: 0, display: 'normal' }
  const b = { id: 'page-b', number: 1, note: '', version: 0 }
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return url.includes('page-a') ? new Promise<Response>(r => { finish = r }) : Response.json({ ...b, version: 1 })
    return Response.json(url === '/api/directory' ? directory() : [url.includes('/a/') ? a : b])
  }))
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '本地版本' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await openMaterial('第二份.pdf')
  await screen.findByLabelText('个人笔记')
  await act(async () => finish(Response.json({ error: '冲突', current: { ...a, note: '远端版本', version: 1 } }, { status: 409 })))
  fireEvent.change(screen.getByLabelText('个人笔记'), { target: { value: '另一页成功' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await screen.findByText('保存成功')
  expect(screen.getByLabelText('保存冲突')).toBeTruthy()
  fireEvent.click(screen.getByText('查看冲突'))
  const recovery = screen.getByLabelText('冲突页整理')
  expect(within(recovery).getByText('第一份.pdf · 第 1 页')).toBeTruthy()
  expect(within(recovery).getByText('远端版本')).toBeTruthy()
  fireEvent.click(within(recovery).getByText('返回原阅读位置'))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('另一页成功')
})

it('checks backend health every five seconds and retries failed saves after reconnecting', async () => {
  let online = true
  let checks = 0
  let saves = 0
  const page = { id: 'page-a', number: 1, note: '', version: 0 }
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/status') {
      checks++
      return Response.json({ status: online ? 'ok' : 'unavailable' }, { status: online ? 200 : 503 })
    }
    if (options?.method === 'PUT') {
      saves++
      if (!online) throw new TypeError('保存时连接中断')
      return Response.json({ ...page, note: JSON.parse(options.body as string).note, version: 1 })
    }
    return Response.json(url === '/api/directory' ? directory() : [page])
  }))
  vi.useFakeTimers()
  try {
    await act(async () => { render(<App />) })
    await act(async () => { fireEvent.click(screen.getByLabelText('第一份.pdf').closest('.ant-tree-node-content-wrapper')!) })
    const input = screen.getByLabelText('个人笔记')
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    await advance(5000)
    expect(checks).toBe(1)
    online = false
    await advance(5000)
    expect(screen.getByText(/重连成功后将自动尝试保存.*将在 5 s 后重试连接/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试连接' })).toBeNull()
    await act(async () => {
      fireEvent.change(input, { target: { value: '离线草稿' } })
      fireEvent.keyDown(input, { key: 's', ctrlKey: true })
    })
    expect(saves).toBe(0)
    await advance(1000)
    expect(screen.getByText(/将在 4 s 后重试连接/)).toBeTruthy()
    await advance(4000)
    expect(checks).toBe(3)
    expect(saves).toBe(0)
    expect(screen.getByRole('button', { name: '1 页未保存' })).toBeTruthy()
    expect(screen.getByText(/将在 5 s 后重试连接/)).toBeTruthy()
    online = true
    await advance(5000)
    expect(checks).toBe(4)
    expect(saves).toBe(1)
    expect(screen.queryByText(/后端连接失败，请检查服务是否运行/)).toBeNull()
    expect(screen.queryByText('保存时连接中断')).toBeNull()
    expect(screen.getByRole('button', { name: /已自动保存/ })).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('离线草稿')
    await advance(5000)
    expect(checks).toBe(5)
    expect(saves).toBe(1)
    online = false
    await act(async () => {
      fireEvent.change(input, { target: { value: '连接刚断开的草稿' } })
      fireEvent.keyDown(input, { key: 's', ctrlKey: true })
    })
    expect(saves).toBe(2)
    expect(screen.getByText(/将在 5 s 后重试连接/)).toBeTruthy()
    await advance(5000)
    expect(saves).toBe(2)
    online = true
    await advance(5000)
    expect(saves).toBe(3)
    expect(screen.queryByText('保存时连接中断')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('ignores dragged PDF text but accepts an external file drop', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith(duplicateLookup) ? null : directory())))
  render(<App />)
  await screen.findByText('第一份.pdf')
  const main = document.querySelector('main')!
  fireEvent.dragOver(main, { dataTransfer: { types: ['text/plain'], files: [] } })
  expect(screen.queryByText('松开以导入 PDF')).toBeNull()
  fireEvent.drop(main, { dataTransfer: { types: ['text/plain'], files: [] } })
  expect(screen.queryByRole('dialog')).toBeNull()
  const file = new File(['%PDF'], '外部.pdf', { type: 'application/pdf' })
  fireEvent.dragOver(main, { dataTransfer: { types: ['Files'], files: [] } })
  expect(screen.getByText('松开以导入 PDF')).toBeTruthy()
  fireEvent.drop(main, { dataTransfer: { types: ['Files'], files: [file] } })
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

it('retries a failed QA save from both the toast and save log', async () => {
  const qa = { id: 'a'.repeat(32), question: '问题', answer: '旧回答', position: 1, version: 1, deleted: false }
  let attempts = 0
  let finishRetry!: () => void
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/status') return Response.json({ status: 'ok' })
    if (options?.method === 'PUT') {
      if (url.endsWith('/note')) return Response.json({ error: '页面已不存在' }, { status: 404 })
      if (++attempts === 3 || attempts === 1) return Response.json({ error: '问答暂时无法保存' }, { status: 500 })
      if (attempts === 2) await new Promise<void>(done => { finishRetry = done })
      return Response.json({ ...qa, answer: '新回答', version: attempts === 2 ? 2 : 3 })
    }
    return Response.json(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0, qa: [qa] }])
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await openMaterial('第一份.pdf')
  fireEvent.click(await screen.findByRole('button', { name: /追问与 AI 解答/ }))
  const answer = screen.getByLabelText('回答 1')
  vi.useFakeTimers()
  try {
    await act(async () => {
      fireEvent.change(answer, { target: { value: '新回答' } })
      fireEvent.keyDown(answer, { key: 's', ctrlKey: true })
    })
    const toast = document.querySelector<HTMLElement>('.ant-notification-notice')!
    expect(within(toast).getByText('保存失败')).toBeTruthy()
    await act(async () => {
      const note = screen.getByLabelText('个人笔记')
      fireEvent.change(note, { target: { value: '已移除页的草稿' } })
      fireEvent.keyDown(note, { key: 's', ctrlKey: true })
    })
    const notification = document.querySelector<HTMLElement>('.ant-notification')!
    expect(within(notification).getByText('页面已不存在')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })
    expect(within(notification).getByText('页面已不存在')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(within(notification).queryByText('页面已不存在')).toBeNull()
    await act(async () => { fireEvent.click(within(toast).getByRole('button', { name: '重试' })) })
    expect(attempts).toBe(2)
    expect(within(toast).getByText('问答暂时无法保存')).toBeTruthy()
    expect(within(answer.closest('.qaEntry')!).getByText('问答暂时无法保存')).toBeTruthy()
    await act(async () => { finishRetry() })
    expect(document.querySelector('.ant-notification-notice-error')).toBeNull()
    expect(screen.queryByText('问答暂时无法保存')).toBeNull()
    await act(async () => {
      fireEvent.change(answer, { target: { value: '再次编辑' } })
      fireEvent.keyDown(answer, { key: 's', ctrlKey: true })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存失败' }))
      await vi.advanceTimersByTimeAsync(300)
    })
    const log = document.querySelector<HTMLElement>('.saveLog')!
    expect(within(log).getAllByText(/保存失败（手动）/).length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(within(log).getByRole('button', { name: '重试' })) })
    expect(attempts).toBe(4)
    expect(document.querySelector('.ant-notification-notice-error')).toBeNull()
    expect(JSON.parse(fetch.mock.calls.filter(call => call[1]?.method === 'PUT').at(-1)![1]!.body as string))
      .toEqual({ question: '问题', answer: '再次编辑', deleted: false, version: 2 })
    expect(within(log).queryByRole('button', { name: '重试' })).toBeNull()
    expect((answer as HTMLTextAreaElement).value).toBe('再次编辑')
  } finally { vi.useRealTimers() }
})

it('keeps a file error inside its import dialog and clears it on cancel', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith(duplicateLookup)) return Response.json(null)
    if (options?.method === 'POST') {
      const file = (options.body as FormData).get('file') as File
      if (file.name === 'bad.pdf') return Response.json({ error: 'PDF 已损坏' }, { status: 400 })
      return Response.json(materials[0], { status: 201 })
    }
    return Response.json(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }])
  }))
  render(<App />)
  await screen.findByText('第一份.pdf')
  async function submit(name: string) {
    fireEvent.click(screen.getByRole('button', { name: /^导入 PDF$/ }))
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF'], name)] } })
    await waitFor(() => expect(screen.getByText('确认导入').closest('button')?.disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
  }
  await submit('bad.pdf')
  expect(within(await screen.findByRole('dialog')).getByText('PDF 已损坏')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '重新加载目录' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('PDF 已损坏')).toBeNull()
  await submit('good.pdf')
  await screen.findByText('PDF 第 1 页')
  expect(screen.queryByText('PDF 已损坏')).toBeNull()
})

it('shows the full filename in a tooltip in the directory and toolbar', async () => {
  const filename = '用于核对目录和顶栏悬浮提示的长课件名称 lecture - Linear regression.pdf'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/directory'
    ? directory([{ ...materials[0], filename }]) : [{ id: 'page-a', number: 1, note: '', version: 0 }])))
  render(<App />)
  const directoryName = await screen.findByText(filename)
  fireEvent.mouseEnter(directoryName.closest('.treeText')!)
  expect((await screen.findByRole('tooltip')).textContent).toBe(filename)
  fireEvent.mouseLeave(directoryName.closest('.treeText')!)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())

  fireEvent.click(directoryName.closest('.ant-tree-node-content-wrapper')!)
  const breadcrumb = document.querySelector<HTMLElement>('.breadcrumb')!
  const toolbarName = await within(breadcrumb).findByText(filename)
  fireEvent.mouseEnter(toolbarName)
  expect((await screen.findByRole('tooltip')).textContent).toBe(filename)
})
