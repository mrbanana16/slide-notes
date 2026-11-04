import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Directory } from './Directory'
import type { Directory as DirectoryData } from './api'
import { compatibleDrop, directoryKeyboardCoordinates } from './directoryDnd'

const data: DirectoryData = {
  revision: 7,
  courses: [{ id: 'c1', name: '课程一', position: 0 }, { id: 'c2', name: '课程二', position: 1 }],
  chapters: [{ id: 'ch1', name: '第一章', course_id: 'c1', position: 0 }, { id: 'ch2', name: '第二章', course_id: 'c1', position: 1 }],
  materials: [
    { id: 'm1', filename: '一.pdf', course_id: 'c1', chapter_id: null, position: 0, page_count: 1 },
    { id: 'm2', filename: '二.pdf', course_id: 'c1', chapter_id: null, position: 1, page_count: 1 },
    { id: 'm3', filename: '三.pdf', course_id: 'c1', chapter_id: 'ch1', position: 0, page_count: 1 },
  ],
}
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true }; HTMLDialogElement.prototype.close = function () { this.open = false } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup(busy = false) {
  const mutate = vi.fn().mockResolvedValue(true), onSelect = vi.fn(), onDelete = vi.fn()
  render(<Directory data={data} selected="m1" busy={busy} mutate={mutate} onSelect={onSelect} onDelete={onDelete} />)
  return { mutate, onSelect, onDelete }
}
it('offers keyboard accessible reorder and chapter move with all stable ids', async () => {
  const { mutate, onSelect } = setup()
  fireEvent.click(screen.getByText('一.pdf'))
  expect(onSelect).toHaveBeenCalledWith(data.materials[0])
  const menu = screen.getByLabelText('一.pdf的操作').parentElement!
  fireEvent.click(within(menu).getByText('下移'))
  expect(mutate.mock.calls[0][2].material_ids.c1).toEqual(['m2', 'm1'])
  await waitFor(() => expect((screen.getByLabelText('移动一.pdf到章节') as HTMLSelectElement).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('移动一.pdf到章节'), { target: { value: 'group:ch2' } })
  expect(mutate.mock.calls[1][2].material_ids.ch2).toEqual(['m1'])
  expect(mutate.mock.calls[1][2].revision).toBe(7)
  expect(screen.getByLabelText('拖动一.pdf').getAttribute('tabindex')).toBe('0')
})
it('creates and renames with explicit names, and honors cancellation of removal', () => {
  const { mutate, onDelete } = setup()
  vi.spyOn(window, 'prompt').mockReturnValueOnce('新课程').mockReturnValueOnce('新名称').mockReturnValueOnce(null)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByLabelText('创建课程'))
  expect(mutate).toHaveBeenCalledWith('/api/courses', 'POST', { name: '新课程', course_id: undefined })
  const menu = screen.getByLabelText('课程一的操作').parentElement!
  fireEvent.click(within(menu).getByText('重命名'))
  expect(mutate).toHaveBeenCalledWith('/api/courses/c1', 'PATCH', { name: '新名称' })
  fireEvent.click(within(menu).getByText('添加章节'))
  fireEvent.click(within(menu).getByText('删除课程'))
  expect(mutate).toHaveBeenCalledTimes(2)
  fireEvent.click(within(screen.getByLabelText('一.pdf的操作').parentElement!).getByText('删除课件'))
  expect(onDelete).toHaveBeenCalledWith(data.materials[0])
})
it('disables mutation and selection while directory persistence is running', () => {
  setup(true)
  expect((screen.getByLabelText('创建课程') as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('拖动一.pdf') as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('移动一.pdf到章节') as HTMLSelectElement).disabled).toBe(true)
})
it('collapses containers without losing the underlying directory or current material', () => {
  const { mutate } = setup()
  fireEvent.click(screen.getByText('▾ 课程一'))
  expect(screen.queryByText('一.pdf')).toBeNull()
  fireEvent.click(screen.getByText('▸ 课程一'))
  expect(screen.getByText('一.pdf').closest('button')?.getAttribute('aria-current')).toBe('page')
  expect(mutate).not.toHaveBeenCalled()
})
it('filters drop targets and keyboard navigation to the same resource kind and course', () => {
  expect(compatibleDrop({ kind: 'chapter', course: 'c1' }, { kind: 'material', course: 'c1' })).toBe(false)
  expect(compatibleDrop({ kind: 'material', course: 'c1' }, { kind: 'group', course: 'c2' })).toBe(true)
  const entries = [
    { id: 'ch1', data: { current: { kind: 'chapter', course: 'c1' } } },
    { id: 'm1', data: { current: { kind: 'material', course: 'c1' } } },
    { id: 'ch2', data: { current: { kind: 'chapter', course: 'c1' } } },
    { id: 'other', data: { current: { kind: 'chapter', course: 'c2' } } },
  ]
  const args = { active: 'ch1', currentCoordinates: { x: 0, y: 0 }, context: {
    active: entries[0], over: { id: 'ch1' }, collisionRect: { left: 0, top: 0, width: 100, height: 30 },
    droppableContainers: { getEnabled: () => entries },
    droppableRects: new Map(entries.map((entry, index) => [entry.id, { left: 0, top: index * 30, width: 100, height: 30 }])),
  } }
  expect(directoryKeyboardCoordinates(new KeyboardEvent('keydown', { code: 'ArrowDown' }), args as unknown as Parameters<typeof directoryKeyboardCoordinates>[1])).toEqual({ x: 0, y: 60 })
})

it('shows source and destination and submits a cross course move only after confirmation', async () => {
  const { mutate } = setup()
  fireEvent.change(screen.getByLabelText('移动一.pdf到章节'), { target: { value: 'group:c2' } })
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('从：课程一 / 一.pdf')).toBeTruthy()
  expect(within(dialog).getByText('到：课程二 / 一.pdf')).toBeTruthy()
  expect(mutate).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByText('取消'))
  expect(mutate).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.change(screen.getByLabelText('移动一.pdf到章节'), { target: { value: 'group:c2' } })
  fireEvent.click(screen.getByText('确认转移'))
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(mutate.mock.calls[0][2].transfers).toEqual([{ material_id: 'm1', from_course_id: 'c1', to_course_id: 'c2' }])
  await waitFor(() => expect((screen.getByLabelText('移动一.pdf到章节') as HTMLSelectElement).disabled).toBe(false))
})

it('hides destructive and reorder controls for the pinned system course', () => {
  const current = { ...data, courses: [{ id: 'system', name: '未分类', position: 0, is_system: true }, ...data.courses] }
  render(<Directory data={current} selected="m1" busy={false} mutate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} />)
  const menu = screen.getByLabelText('未分类的操作').parentElement!
  expect(within(menu).queryByText('删除课程')).toBeNull()
  expect(within(menu).queryByText('重命名')).toBeNull()
  expect(within(menu).queryByText('上移')).toBeNull()
  expect((screen.getByLabelText('拖动未分类') as HTMLButtonElement).disabled).toBe(true)
  const regular = screen.getByLabelText('课程一的操作').parentElement!
  expect((within(regular).getByText('上移') as HTMLButtonElement).disabled).toBe(true)
})
