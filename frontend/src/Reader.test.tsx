import { openMaterial } from './testInteractions'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({}), destroy: () => Promise.resolve() }) }))
vi.mock('./PdfPage', () => ({ PdfPage: ({ number }: { number: number }) => <div>PDF 第 {number} 页</div> }))
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture(displays = ['normal', 'normal', 'normal']) {
  let pages = displays.map((display, i) => ({ id: `p${i + 1}`, number: i + 1, note: '', version: 0, summary: '', summary_version: 0, qa: [], display, settings_version: 0 }))
  const material = { id: 'a', filename: '课件.pdf', page_count: pages.length, course_id: 'c', chapter_id: null, position: 0 }
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/status') return Response.json({ status: 'ok' })
    if (url === '/api/directory') return new Response(JSON.stringify({ revision: 0, courses: [{ id: 'c', name: '课程', position: 0 }], chapters: [], materials: [material] }))
    if (options?.method === 'PATCH') {
      const body = JSON.parse(options.body as string)
      pages = pages.map(page => body.pages.some((p: { id: string }) => p.id === page.id) ? { ...page, ...(body.display ? { display: body.display } : {}), settings_version: page.settings_version + 1 } : page)
      return new Response(JSON.stringify(pages.filter(page => body.pages.some((p: { id: string }) => p.id === page.id))))
    }
    if (options?.method === 'PUT') return new Response(JSON.stringify({ ...pages[0], note: JSON.parse(options.body as string).note, version: 1 }))
    return new Response(JSON.stringify(pages))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
async function open() {
  render(<App />)
  await openMaterial('课件.pdf')
  await screen.findByText('PDF 第 1 页', {}, { timeout: 3500 })
}
it('preserves unsaved drafts across all modes and provides strictly read-only review', async () => {
  const fetch = fixture()
  await open()
  fireEvent.change(screen.getAllByLabelText('个人笔记')[0], { target: { value: '草稿 **第一页**' } })
  expect(localStorage.length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  expect(screen.getByText('只读复习')).toBeTruthy()
  expect(screen.getByText('第一页')).toBeTruthy()
  expect(document.querySelectorAll('.notePanel textarea')).toHaveLength(0)
  expect(screen.queryByText('删除问答')).toBeNull()
  expect(screen.queryByRole('button', { name: /添加问答/ })).toBeNull()
  expect(screen.queryByLabelText('第 1 页分类')).toBeNull()
  expect(screen.queryByLabelText('课件.pdf的操作')).toBeNull()
  expect((screen.getByLabelText('创建课程') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByText('系统设置'))
  expect((screen.getByRole('button', { name: '清空全部数据' }) as HTMLButtonElement).disabled).toBe(true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  fireEvent.mouseEnter(screen.getByLabelText('清空全部数据（复习模式只读）'))
  expect((await screen.findByRole('tooltip')).textContent).toContain('只读')
  fireEvent.click(screen.getByRole('button', { name: /close|关闭/i }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByText('单页阅读'))
  expect(screen.queryByText('PDF 第 2 页')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '沉浸整理' }))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('草稿 **第一页**')
  expect(document.querySelector('.workspace')?.classList.contains('sidebarClosed')).toBe(true)
  fireEvent.click(screen.getByLabelText('展开目录'))
  expect(screen.getByLabelText('收起目录').getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByLabelText('收起目录'))
  fireEvent.click(screen.getByText('退出沉浸'))
  expect((screen.getAllByLabelText('个人笔记')[0] as HTMLTextAreaElement).value).toBe('草稿 **第一页**')
  expect(fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(0)
})
it('keeps review layout independent of fullscreen, and offers fallback if fullscreen is denied', async () => {
  fixture()
  const request = vi.fn().mockRejectedValue(new Error('denied'))
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request })
  await open()
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  fireEvent.click(screen.getByLabelText('全屏'))
  await screen.findByText('浏览器未进入全屏，仍可在当前窗口继续阅读或沉浸整理。')
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
  fireEvent.click(screen.getByText('单页阅读'))
  fireEvent.change(screen.getByLabelText('跳转页码'), { target: { value: '2' } })
  fireEvent.keyDown(screen.getByLabelText('跳转页码'), { key: 'Enter', code: 'Enter' })
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement })
  fireEvent(document, new Event('fullscreenchange'))
  expect(screen.getByLabelText('退出全屏')).toBeTruthy()
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  fireEvent(document, new Event('fullscreenchange'))
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
  expect((screen.getByRole('radio', { name: '单页阅读' }) as HTMLInputElement).checked).toBe(true)
  expect(document.querySelectorAll('.notePanel textarea')).toHaveLength(0)
})

it('restores the original page and offset when switching continuous and single layouts', async () => {
  fixture()
  await open()
  const reader = document.querySelector<HTMLElement>('.readerScroll')!
  vi.spyOn(reader, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 800 }) as DOMRect)
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.pageRow'))
  rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: index * 1000 - reader.scrollTop, bottom: index * 1000 + 900 - reader.scrollTop }) as DOMRect))
  reader.scrollTop = 1100
  fireEvent.scroll(reader)
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  expect(reader.scrollTop).toBe(1100)
  fireEvent.click(screen.getByText('单页阅读'))
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
  expect(screen.queryByText('PDF 第 1 页')).toBeNull()
  expect(reader.scrollTop).toBe(0)
  fireEvent.click(screen.getByText('连续阅读'))
  expect(reader.scrollTop).toBe(1100)
  expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
})

it('protects segmented arrows and turns pages from ordinary buttons', async () => {
  fixture()
  await open()
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  const singleButton = screen.getByText('单页阅读')
  fireEvent.click(singleButton)
  const layoutRadio = screen.getByRole('radio', { name: '单页阅读' })
  layoutRadio.focus()
  fireEvent.keyDown(layoutRadio, { key: 'ArrowDown' })
  expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
  layoutRadio.blur()
  for (const [key, number] of [['ArrowRight', 2], ['ArrowDown', 3], ['ArrowLeft', 2], ['ArrowUp', 1]] as const) {
    fireEvent.keyDown(document.body, { key })
    expect(screen.getByText(`PDF 第 ${number} 页`)).toBeTruthy()
  }
  fireEvent.click(screen.getByRole('tab', { name: '沉浸整理' }))
  const nextButton = screen.getByText('下一页')
  nextButton.focus()
  fireEvent.keyDown(nextButton, { key: 'ArrowDown' })
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
})

it('leaves arrows to text inputs, editable content, selectors, composition and modifier keys', async () => {
  fixture()
  await open()
  fireEvent.click(screen.getByRole('tab', { name: '沉浸整理' }))
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.setAttribute('contenteditable', 'true')
  editable.setAttribute('tabindex', '0')
  document.body.append(editable)
  try {
    for (const element of [screen.getByLabelText('AI 总结'), screen.getByLabelText('个人笔记'), screen.getByLabelText('跳转页码'), editable]) {
      element.focus()
      for (const key of element.getAttribute('role') === 'spinbutton' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        fireEvent(element, event)
        expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
        if (element === editable || element.tagName === 'TEXTAREA') expect(event.defaultPrevented).toBe(false)
      }
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
      element.blur()
    }
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      fireEvent.keyDown(document.body, { key: 'ArrowRight', ...options })
      expect(screen.getByText('PDF 第 1 页')).toBeTruthy()
    }
  } finally { editable.remove() }
  fireEvent.keyDown(document.body, { key: 'ArrowRight' })
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
})

it('does not use arrow page shortcuts in continuous organize or review layouts', async () => {
  fixture()
  await open()
  fireEvent.keyDown(document.body, { key: 'ArrowDown' })
  expect((screen.getByLabelText('跳转页码') as HTMLInputElement).value).toBe('1')
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  fireEvent.keyDown(document.body, { key: 'ArrowRight' })
  expect((screen.getByLabelText('跳转页码') as HTMLInputElement).value).toBe('1')
  expect(screen.getByText('PDF 第 2 页')).toBeTruthy()
})

it('resizes every page from the keyboard and restores the shared ratio after remount', async () => {
  fixture()
  await open()
  const divider = screen.getByRole('separator', { name: '第 1 页课件宽度' })
  fireEvent.keyDown(divider, { key: 'ArrowLeft' })
  expect(screen.getByRole('separator', { name: '第 2 页课件宽度' }).getAttribute('aria-valuenow')).toBe('58')
  cleanup()
  await open()
  expect(screen.getByRole('separator', { name: '第 1 页课件宽度' }).getAttribute('aria-valuenow')).toBe('58')
})

it('persists fold and expand states and exposes none of the removed controls', async () => {
  const fetch = fixture()
  await open()
  fireEvent.change(screen.getAllByLabelText('个人笔记')[0], { target: { value: '折叠保留草稿' } })
  fireEvent.click(screen.getByLabelText('折叠第 1 页'))
  await waitFor(() => expect(screen.getByLabelText('展开第 1 页')).toBeTruthy())
  expect(screen.getByText('PDF 第 1 页').closest('[inert]')?.closest('[data-collapsed]')?.getAttribute('data-collapsed')).toBe('true')
  const body = JSON.parse(fetch.mock.calls.find(call => call[1]?.method === 'PATCH')![1]!.body as string)
  expect(body).toEqual({ pages: [{ id: 'p1', version: 0 }], display: 'collapsed' })
  expect((screen.getAllByLabelText('个人笔记')[0] as HTMLTextAreaElement).value).toBe('折叠保留草稿')
  for (const text of [/筛选/, /批量操作/, /跳过.*页/]) expect(screen.queryByText(text)).toBeNull()
  expect(screen.queryByLabelText('第 1 页分类')).toBeNull()
  expect(screen.queryByLabelText('第 1 页显示状态')).toBeNull()
  cleanup()
  await open()
  expect(screen.getByLabelText('展开第 1 页')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('展开第 1 页'))
  await waitFor(() => expect(screen.getByLabelText('折叠第 1 页')).toBeTruthy())
  const calls = fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')
  expect(JSON.parse(calls[1][1]!.body as string).pages).toEqual([{ id: 'p1', version: 1 }])
})

it('persists folding in review and lets single-page navigation reach collapsed pages', async () => {
  const fetch = fixture(['normal', 'collapsed', 'collapsed'])
  await open()
  fireEvent.click(screen.getByRole('tab', { name: '复习' }))
  fireEvent.click(screen.getByLabelText('折叠第 1 页'))
  await waitFor(() => expect(screen.getByLabelText('展开第 1 页')).toBeTruthy())
  expect(fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1)
  fireEvent.click(screen.getByText('单页阅读'))
  expect(screen.getByLabelText('展开第 1 页')).toBeTruthy()
  fireEvent.click(screen.getByText('下一页'))
  expect(screen.getByLabelText('展开第 2 页')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('展开第 2 页'))
  await waitFor(() => expect(screen.getByLabelText('折叠第 2 页')).toBeTruthy())
  expect(screen.getByText('PDF 第 2 页').closest('[hidden]')).toBeNull()
  expect(document.querySelectorAll('.notePanel textarea')).toHaveLength(0)
})

it('keeps display and note drafts on failure and permits retry', async () => {
  const fetch = fixture()
  await open()
  fireEvent.change(screen.getAllByLabelText('个人笔记')[0], { target: { value: '失败仍保留' } })
  fetch.mockImplementationOnce(async () => Response.json({ error: '显示状态保存失败' }, { status: 500 }))
  fireEvent.click(screen.getByLabelText('折叠第 1 页'))
  await screen.findByText('显示状态保存失败')
  expect(screen.getByLabelText('折叠第 1 页')).toBeTruthy()
  expect((screen.getAllByLabelText('个人笔记')[0] as HTMLTextAreaElement).value).toBe('失败仍保留')
  fireEvent.click(screen.getByLabelText('折叠第 1 页'))
  await waitFor(() => expect(screen.getByLabelText('展开第 1 页')).toBeTruthy())
})

it('refreshes only display state on version conflict and preserves note drafts', async () => {
  const fetch = fixture()
  await open()
  fireEvent.change(screen.getAllByLabelText('个人笔记')[0], { target: { value: '本地笔记' } })
  const original = fetch.getMockImplementation()!
  let conflictSent = false
  fetch.mockImplementation(async (url, options) => {
    if (options?.method === 'PATCH' && !conflictSent) {
      conflictSent = true
      return Response.json({ error: '显示状态冲突' }, { status: 409 })
    }
    if (url === '/api/materials/a/pages') {
      return Response.json([{ id: 'p1', number: 1, display: 'collapsed', settings_version: 7, note: '服务器旧笔记' }])
    }
    return original(url, options)
  })
  fireEvent.click(screen.getByLabelText('折叠第 1 页'))
  await waitFor(() => expect((screen.getByLabelText('展开第 1 页') as HTMLButtonElement).disabled).toBe(false))
  expect((screen.getAllByLabelText('个人笔记')[0] as HTMLTextAreaElement).value).toBe('本地笔记')
  fireEvent.click(screen.getByLabelText('展开第 1 页'))
  await waitFor(() => expect(fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(2))
  expect(JSON.parse(fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')[1][1]!.body as string).pages).toEqual([{ id: 'p1', version: 7 }])
})

it('mounts only nearby editors in a long continuous document and saves an unmounted draft', async () => {
  let notify!: (changes: Partial<IntersectionObserverEntry>[]) => void
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof notify) { notify = callback }
    observe() {}
    disconnect() {}
  })
  const fetch = fixture(Array(200).fill('normal'))
  await open()
  const reader = document.querySelector<HTMLElement>('.readerScroll')!
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.pageRow'))
  expect(rows).toHaveLength(200)
  expect(reader.querySelectorAll('.notePanel')).toHaveLength(1)
  expect(screen.getByLabelText('跳转页码').closest('.breadcrumb')).toBeNull()
  rows.forEach((row, i) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() =>
    ({ top: i * 500 - reader.scrollTop, bottom: (i + 1) * 500 - reader.scrollTop }) as DOMRect))
  act(() => notify([{ target: rows[0], isIntersecting: true }, { target: rows[1], isIntersecting: true }]))
  const firstPage = within(rows[0])
  const draft = '# 长笔记\n\n' + '滚走后仍保存 **Markdown**\n\n'.repeat(600)
  fireEvent.click(firstPage.getByRole('button', { name: /个人笔记/ }))
  fireEvent.change(firstPage.getByLabelText('个人笔记'), { target: { value: draft } })
  reader.scrollTop = 99000
  fireEvent.scroll(reader)
  act(() => notify([
    { target: rows[0], isIntersecting: false }, { target: rows[1], isIntersecting: false },
    { target: rows[198], isIntersecting: true }, { target: rows[199], isIntersecting: true },
  ]))
  expect(firstPage.queryByLabelText('个人笔记')).toBeNull()
  expect(reader.querySelectorAll('.notePanel')).toHaveLength(2)
  expect(reader.scrollTop).toBe(99000)
  await waitFor(() => expect(fetch.mock.calls.some(([url, request]) =>
    url === '/api/pages/p1/note' && JSON.parse(request!.body as string).note === draft)).toBe(true), { timeout: 2500 })
  reader.scrollTop = 0
  fireEvent.scroll(reader)
  act(() => notify([
    { target: rows[198], isIntersecting: false }, { target: rows[199], isIntersecting: false },
    { target: rows[0], isIntersecting: true }, { target: rows[1], isIntersecting: true },
  ]))
  expect(firstPage.getByRole('button', { name: /个人笔记/ }).getAttribute('aria-expanded')).toBe('true')
  expect((firstPage.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe(draft)
})
