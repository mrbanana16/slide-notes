import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Directory } from './Directory'
import { projectOrder, type Order } from './directoryOrder'
import type { Directory as DirectoryData } from './api'

const initial: DirectoryData = {
  revision: 1, courses: [{ id: 'c', name: '测试课程', position: 0 }], chapters: [],
  materials: [{ id: 'a', filename: 'a.pdf', page_count: 1, course_id: 'c', chapter_id: null, position: 0 }, { id: 'b', filename: 'b.pdf', page_count: 1, course_id: 'c', chapter_id: null, position: 1 }],
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function materialNames() { return [...screen.getByRole('navigation').querySelectorAll('.material strong')].map(node => node.textContent) }

function installRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const row = this.classList.contains('directoryRow') ? this : this.closest('.directoryRow')
    const text = row?.textContent ?? ''
    const overlay = this.classList.contains('directoryDragPreview') ? this.parentElement : this
    const top = row?.classList.contains('materialRow') ? (text.includes('a.pdf') ? 50 : 100) : overlay?.style.position === 'fixed' ? Number.parseFloat(overlay.style.top) || 0 : 0
    return { x: 0, y: top, left: 0, top, right: 200, bottom: top + 40, width: 200, height: 40, toJSON: () => ({}) }
  })
}

it('keeps the new order visible during delayed persistence and after success', async () => {
  let finish!: (value: boolean) => void
  function Harness() {
    const [data, setData] = useState(initial)
    return <Directory data={data} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={async (_url, _method, body) => {
      const success = await new Promise<boolean>(resolve => { finish = resolve })
      if (success) setData({ ...projectOrder(data, body as Order), revision: data.revision + 1 })
      return success
    }} />
  }
  render(<Harness />)
  fireEvent.click(screen.getByLabelText('a.pdf的操作').parentElement!.querySelectorAll('button')[2])
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
  await act(async () => { finish(true) })
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
})

it('restores the previous order only when persistence fails', async () => {
  let finish!: (value: boolean) => void
  render(<Directory data={initial} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={() => new Promise<boolean>(resolve => { finish = resolve })} />)
  fireEvent.click(screen.getByLabelText('a.pdf的操作').parentElement!.querySelectorAll('button')[2])
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
  await act(async () => { finish(false) })
  expect(materialNames()).toEqual(['a.pdf', 'b.pdf'])
})

it('reorders through the actual keyboard drag sensor without leaving a stale overlay', async () => {
  installRects()
  const mutate = vi.fn(async () => true)
  render(<Directory data={initial} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={mutate} />)
  const handle = screen.getByLabelText('拖动a.pdf')
  handle.focus()
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' })
  await waitFor(() => expect(document.querySelector('.directoryDragPreview')).not.toBeNull())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  fireEvent.keyDown(document, { code: 'Space', key: ' ' })
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  expect((mutate.mock.calls as unknown as [string, string, Order][])[0][2].material_ids.c).toEqual(['b', 'a'])
  await waitFor(() => expect(document.querySelector('.directoryDragPreview')).toBeNull())
})

it('persists a mouse pointer drop in its destination with no remaining drag preview', async () => {
  installRects()
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true })
  let finish!: (value: boolean) => void
  function Harness() {
    const [data, setData] = useState(initial)
    return <Directory data={data} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={async (_url, _method, body) => {
      const success = await new Promise<boolean>(resolve => { finish = resolve })
      if (success) setData({ ...projectOrder(data, body as Order), revision: data.revision + 1 })
      return success
    }} />
  }
  render(<Harness />)
  fireEvent.pointerDown(screen.getByLabelText('拖动a.pdf'), { clientX: 80, clientY: 70, button: 0 })
  fireEvent.pointerMove(document, { clientX: 80, clientY: 90 })
  await waitFor(() => expect(document.querySelector('.directoryDragPreview')).not.toBeNull())
  fireEvent.pointerMove(document, { clientX: 80, clientY: 125 })
  fireEvent.pointerUp(document, { clientX: 80, clientY: 125 })
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
  await waitFor(() => expect(document.querySelector('.directoryDragPreview')).toBeNull())
  await act(async () => { finish(true) })
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
})
