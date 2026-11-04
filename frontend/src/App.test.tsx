import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { readFileSync } from 'node:fs'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({}), destroy: () => Promise.resolve() }),
}))
vi.mock('./PdfPage', () => ({ PdfPage: ({ number }: { number: number }) => <div>PDF 第 {number} 页</div> }))

beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false } })

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const materials = [
  { id: 'a', filename: '第一份.pdf', page_count: 1, course_id: 'course', chapter_id: null, position: 0 },
  { id: 'b', filename: '第二份.pdf', page_count: 1, course_id: 'course', chapter_id: null, position: 1 },
]

const system = { id: 'system', name: '未分类', position: 0, is_system: true }
const directory = (items = materials) => ({ revision: 0, courses: [system, { id: 'course', name: '数据结构', position: 1 }], chapters: [], materials: items })

it('keeps unsaved notes bound to their page when switching materials and warns before closing', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const result = url === '/api/directory' ? directory() : [{ id: url.includes('/a/') ? 'page-a' : 'page-b', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result))
  }))
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  const firstInput = await screen.findByLabelText('个人笔记')
  fireEvent.change(firstInput, { target: { value: '只属于第一份' } })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByText('第二份.pdf'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe(''))
  fireEvent.click(screen.getByText('第一份.pdf'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('只属于第一份'))
  expect(screen.getByText('1 页未保存')).toBeTruthy()
})

it('imports a PDF and opens its stable page', async () => {
  let imported = false
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') imported = true
    const result = options?.method === 'POST' ? materials[0] : url === '/api/directory' ? directory(imported ? [materials[0]] : []) : [{ id: 'new-page', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result), { status: options?.method === 'POST' ? 201 : 200 })
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('从一份课件开始')
  const file = new File(['%PDF'], '第一份.pdf', { type: 'application/pdf' })
  fireEvent.click(screen.getByText('＋ 导入 PDF'))
  fireEvent.change(screen.getByLabelText('选择 PDF 课件'), { target: { files: [file] } })
  fireEvent.click(screen.getByText('确认导入'))
  await screen.findByLabelText('个人笔记')
  const upload = fetch.mock.calls.find(call => call[1]?.method === 'POST')
  expect((upload?.[1]?.body as FormData).get('file')).toBe(file)
  expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
})


it('opens the existing material on duplicate import without adding a directory entry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const result = options?.method === 'POST' ? { ...materials[0], duplicate: true, location: { course_name: '数据结构', chapter_name: null } } : url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: 'existing note', version: 1 }]
    return new Response(JSON.stringify(result))
  }))
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByText('＋ 导入 PDF'))
  fireEvent.change(screen.getByLabelText('选择 PDF 课件'), { target: { files: [new File(['%PDF'], 'renamed.pdf')] } })
  fireEvent.click(screen.getByText('确认导入'))
  await screen.findByText('课件已存在')
  expect(screen.getByText('所在位置：数据结构 / 第一份.pdf')).toBeTruthy()
  expect(screen.queryByLabelText('个人笔记')).toBeNull()
  fireEvent.click(screen.getByText('打开已有课件'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('existing note'))
  expect(screen.getByRole('navigation').querySelectorAll('.material')).toHaveLength(2)
})

it('does not reset when the user cancels confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const fetch = vi.fn(async () => new Response(JSON.stringify(directory())))
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByText('清空全部数据'))
  expect(confirm).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByText('第一份.pdf')).toBeTruthy()
})

it('clears materials and unsaved drafts after confirmed reset, including a late save response', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  let finishSave!: (response: Response) => void
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return await new Promise<Response>(resolve => { finishSave = resolve })
    const result = url === '/api/reset' ? { reset: true, directory: { revision: 1, courses: [system], chapters: [], materials: [] } } : url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]
    return new Response(JSON.stringify(result))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: 'erase my draft' } })
  fireEvent.click(screen.getByText('保存笔记'))
  fireEvent.click(screen.getByText('清空全部数据'))
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
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/reset') return new Response(JSON.stringify({ error: '清空失败' }), { status: 500 })
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  }))
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: 'keep on failure' } })
  fireEvent.click(screen.getByText('清空全部数据'))
  await screen.findByRole('alert')
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('keep on failure'))
  expect(screen.getByText('1 页未保存')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('清空失败')
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
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '移动中保持的草稿' } })
  fireEvent.change(screen.getByLabelText('移动第一份.pdf到章节'), { target: { value: 'group:chapter' } })
  await screen.findByText('目录已保存。')
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('移动中保持的草稿')
  expect(fetch.mock.calls.filter(call => call[0] === '/api/materials/a/pages')).toHaveLength(1)
  const mutation = fetch.mock.calls.find(call => call[0] === '/api/directory/order')!
  const body = JSON.parse(mutation[1]!.body as string)
  expect(body.revision).toBe(0)
  expect(body.material_ids.chapter).toEqual(['a'])
  expect(screen.getByText('1 页未保存')).toBeTruthy()
})

it('preserves the old directory and draft on stale order, then reloads the current directory', async () => {
  let reads = 0
  const initial = directory()
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/directory/order') return new Response(JSON.stringify({ error: '目录已在其他窗口更新，请重新加载目录后再操作；笔记草稿仍保留。' }), { status: 409 })
    if (url === '/api/directory') return new Response(JSON.stringify(reads++ ? { ...initial, revision: 2, materials: [...materials].reverse() } : initial))
    return new Response(JSON.stringify([{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '冲突仍保留' } })
  const menu = screen.getByLabelText('第一份.pdf的操作').parentElement!
  fireEvent.click(menu.querySelectorAll('button')[2])
  await screen.findByText(/目录已在其他窗口更新/)
  expect(screen.getByRole('navigation').querySelector('.material strong')?.textContent).toBe('第一份.pdf')
  fireEvent.click(screen.getByText('重新加载'))
  await waitFor(() => expect(screen.getByRole('navigation').querySelector('.material strong')?.textContent).toBe('第二份.pdf'))
  await waitFor(() => expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('冲突仍保留'))
})

it('shows saved note counts, cancels deletion, and clears only the confirmed material drafts', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  let finishSave!: (response: Response) => void
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/materials/a' && options?.method === 'DELETE') return new Response(JSON.stringify({ ...directory([materials[1]]), revision: 1 }))
    if (url === '/api/materials/a') return new Response(JSON.stringify({ ...materials[0], note_count: 3, page_ids: ['page-a'] }))
    if (options?.method === 'PUT') return await new Promise<Response>(resolve => { finishSave = resolve })
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '删除的草稿' } })
  const menu = screen.getByLabelText('第一份.pdf的操作').parentElement!
  fireEvent.click(menu.querySelector('.deleteAction')!)
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  expect(confirm.mock.calls[0][0]).toContain('3 条已保存笔记／问答')
  expect(confirm.mock.calls[0][0]).toContain('1 处未保存编辑')
  expect(fetch.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('删除的草稿')
  fireEvent.click(screen.getByText('保存笔记'))
  fireEvent.click(menu.querySelector('.deleteAction')!)
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
    if (options?.method === 'POST') return new Response(JSON.stringify(materials[0]))
    return new Response(JSON.stringify(url === '/api/directory' ? initial : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('第一份.pdf')
  fireEvent.click(screen.getByText('＋ 导入 PDF'))
  fireEvent.change(screen.getByLabelText('导入到课程'), { target: { value: 'course' } })
  fireEvent.change(screen.getByLabelText('导入到章节'), { target: { value: 'chapter' } })
  fireEvent.change(screen.getByLabelText('选择 PDF 课件'), { target: { files: [new File(['%PDF'], '新课件.pdf')] } })
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
    if (url === '/api/materials' && options?.method === 'POST') return new Response(JSON.stringify(materials[0]))
    return new Response(JSON.stringify(url === '/api/directory' ? (options ? directory() : initial) : []))
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  await screen.findByText('▾ 未分类')
  fireEvent.click(screen.getByText('＋ 导入 PDF'))
  expect((screen.getByLabelText('导入到课程') as HTMLSelectElement).value).toBe('system')
  expect((screen.getByText('确认导入') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('新课程名称'), { target: { value: '数据结构' } })
  fireEvent.click(screen.getByText('创建课程'))
  await waitFor(() => expect((screen.getByLabelText('导入到课程') as HTMLSelectElement).value).toBe('course'))
  const creation = fetch.mock.calls.find(call => call[0] === '/api/courses')!
  expect(JSON.parse(creation[1]!.body as string)).toEqual({ revision: 1, name: '数据结构' })
  fireEvent.click(screen.getByText('取消'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetch.mock.calls.some(call => call[0] === '/api/materials')).toBe(false)
})

it('keeps the open editor and draft after material deletion fails', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/materials/a' && options?.method === 'DELETE') return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 })
    if (url === '/api/materials/a') return new Response(JSON.stringify({ ...materials[0], note_count: 0, page_ids: ['page-a'] }))
    return new Response(JSON.stringify(url === '/api/directory' ? directory() : [{ id: 'page-a', number: 1, note: '', version: 0 }]))
  }))
  render(<App />)
  fireEvent.click(await screen.findByText('第一份.pdf'))
  fireEvent.change(await screen.findByLabelText('个人笔记'), { target: { value: '失败保留' } })
  fireEvent.click(screen.getByLabelText('第一份.pdf的操作').parentElement!.querySelector('.deleteAction')!)
  await screen.findByText('删除失败')
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('失败保留')
  expect(screen.getByText('1 页未保存')).toBeTruthy()
  expect(localStorage.length).toBeGreaterThan(0)
})

it('uses explicit light page and dialog colors independent of system theme', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(directory()))))
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles.css', 'utf8')
  document.head.append(style)
  try {
    render(<App />)
    await screen.findByText('第一份.pdf')
    fireEvent.click(screen.getByText('＋ 导入 PDF'))
    const dialog = screen.getByRole('dialog')
    expect(getComputedStyle(document.documentElement).getPropertyValue('color-scheme')).toBe('only light')
    expect(getComputedStyle(dialog).backgroundColor).toBe('rgb(255, 255, 255)')
    expect(getComputedStyle(dialog).color).toBe('rgb(32, 39, 51)')
    expect(getComputedStyle(screen.getByLabelText('导入到课程')).backgroundColor).toBe('rgb(255, 255, 255)')
  } finally { style.remove() }
})
