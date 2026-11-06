import { treeDropOrder } from './directoryTree'
import { directoryAction } from './testInteractions'
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
  await directoryAction('a.pdf', '下移')
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
  await act(async () => { finish(true) })
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
})

it('restores the previous order only when persistence fails', async () => {
  let finish!: (value: boolean) => void
  render(<Directory data={initial} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={() => new Promise<boolean>(resolve => { finish = resolve })} />)
  await directoryAction('a.pdf', '下移')
  expect(materialNames()).toEqual(['b.pdf', 'a.pdf'])
  await act(async () => { finish(false) })
  expect(materialNames()).toEqual(['a.pdf', 'b.pdf'])
})

it('persists an actual Tree drag gap drop and clears native dragging state', async () => {
  const mutate = vi.fn().mockResolvedValue(true)
  render(<Directory data={initial} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={mutate} />)
  const source = screen.getByLabelText('a.pdf').closest('.ant-tree-treenode')!
  const target = screen.getByLabelText('b.pdf').closest('.ant-tree-treenode')!
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40, x: 0, y: 100, toJSON: () => ({}) })
  const transfer = { setData: vi.fn(), getData: vi.fn(), types: [] }
  fireEvent.dragStart(source, { clientX: 80, clientY: 60, dataTransfer: transfer })
  fireEvent.dragEnter(target, { clientX: 80, clientY: 139, dataTransfer: transfer })
  fireEvent.dragOver(target, { clientX: 80, clientY: 139, dataTransfer: transfer })
  fireEvent.drop(target, { clientX: 80, clientY: 139, dataTransfer: transfer })
  fireEvent.dragEnd(source)
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  expect((mutate.mock.calls[0][2] as Order).material_ids.c).toEqual(['b', 'a'])
  expect(document.querySelector('.dragging')).toBeNull()
})

it('keeps the pinned course undraggable and permits material transfers into it', () => {
  const data = { ...initial, courses: [{ id: 'system', name: '未分类', position: 0, is_system: true }, ...initial.courses] }
  render(<Directory data={data} selected="a" busy={false} onSelect={vi.fn()} onDelete={vi.fn()} mutate={vi.fn()} />)
  expect(screen.getByLabelText('未分类').closest('.ant-tree-treenode')?.getAttribute('draggable')).not.toBe('true')
  expect(screen.getByLabelText('a.pdf').closest('.ant-tree-treenode')?.getAttribute('draggable')).toBe('true')
  expect(treeDropOrder(data, 'c', 'system', -1)).toBeNull()
  expect(treeDropOrder(data, 'a', 'system', 0)?.transfers).toEqual([{ material_id: 'a', from_course_id: 'c', to_course_id: 'system' }])
})
