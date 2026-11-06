import { chooseOption, directoryAction } from './testInteractions'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Directory } from './Directory'
import type { Directory as DirectoryData } from './api'
import { treeDropOrder } from './directoryTree'

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
  await directoryAction('一.pdf', '下移')
  expect(mutate.mock.calls[0][2].material_ids.c1).toEqual(['m2', 'm1'])
  await waitFor(() => expect((screen.getByLabelText('一.pdf的操作') as HTMLButtonElement).disabled).toBe(false))
  await directoryAction('一.pdf', '移动到')
  await chooseOption('移动一.pdf到章节', '第二章')
  fireEvent.click(screen.getByRole('button', { name: /移\s*动/ }))
  expect(mutate.mock.calls[1][2].material_ids.ch2).toEqual(['m1'])
  expect(mutate.mock.calls[1][2].revision).toBe(7)
  expect(screen.getByRole('tree')).toBeTruthy()
})
it('creates in a dialog, renames inline, and cancels with Escape', async () => {
  const { mutate } = setup()
  fireEvent.click(screen.getByLabelText('创建课程'))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新课程' } })
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
  expect(mutate).toHaveBeenCalledWith('/api/courses', 'POST', { name: '新课程', course_id: undefined })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await directoryAction('课程一', '重命名')
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新名称' } })
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
  await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/courses/c1', 'PATCH', { name: '新名称' }))

})
it('disables mutation and selection while directory persistence is running', () => {
  setup(true)
  expect((screen.getByLabelText('创建课程') as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByLabelText('一.pdf').closest('[role="treeitem"]')?.getAttribute('aria-disabled')).toBe('true')
  expect((screen.getByLabelText('一.pdf的操作') as HTMLButtonElement).disabled).toBe(true)
})
it('collapses containers without losing the underlying directory or current material', async () => {
  const { mutate } = setup()
  fireEvent.click(screen.getByLabelText('收起课程一'))
  expect(screen.queryByText('一.pdf')).toBeNull()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  await waitFor(() => expect(document.querySelector('.ant-tree-treenode-motion')).toBeNull())
  fireEvent.click(screen.getByLabelText('展开课程一').closest('.ant-tree-switcher')!)
  expect((await screen.findByLabelText('一.pdf')).getAttribute('aria-current')).toBe('page')
  expect(mutate).not.toHaveBeenCalled()
})
it('renders a real Tree without a direct-course label or an empty-material placeholder', () => {
  setup()
  expect(screen.getByRole('tree')).toBeTruthy()
  expect(screen.queryByText('课程直属')).toBeNull()
  expect(screen.queryByText('暂无课件')).toBeNull()
  expect(screen.getAllByRole('treeitem').length).toBe(7)
})
it('maps Tree gaps precisely and only allows valid container drops', () => {
  expect(treeDropOrder(data, 'm1', 'm2', -1)?.material_ids.c1).toEqual(['m1', 'm2'])
  expect(treeDropOrder(data, 'm1', 'm2', 1)?.material_ids.c1).toEqual(['m2', 'm1'])
  expect(treeDropOrder(data, 'm2', 'm1', -1)?.material_ids.c1).toEqual(['m2', 'm1'])
  expect(treeDropOrder(data, 'm3', 'c2', 0)?.transfers).toEqual([{ material_id: 'm3', from_course_id: 'c1', to_course_id: 'c2' }])
  expect(treeDropOrder(data, 'm1', 'ch2', 0)?.material_ids.ch2).toEqual(['m1'])
  for (const [source, target, position] of [['ch1', 'c2', 0], ['c1', 'c2', 0], ['m1', 'ch1', 1], ['m1', 'm2', 0]] as const) expect(treeDropOrder(data, source, target, position)).toBeNull()
})

it('shows source and destination and submits a cross course move only after confirmation', async () => {
  const { mutate } = setup()
  await directoryAction('一.pdf', '移动到')
  fireEvent.mouseDown(screen.getByLabelText('移动一.pdf到章节'))
  const targets = await screen.findAllByText('课程直属', { selector: '.ant-select-item-option-content' })
  fireEvent.click(targets[1])
  fireEvent.click(screen.getByRole('button', { name: /移\s*动/ }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('从：课程一 / 一.pdf')).toBeTruthy()
  expect(within(dialog).getByText('到：课程二 / 一.pdf')).toBeTruthy()
  expect(mutate).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }))
  expect(mutate).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  await directoryAction('一.pdf', '移动到')
  fireEvent.mouseDown(screen.getByLabelText('移动一.pdf到章节'))
  fireEvent.click((await screen.findAllByText('课程直属', { selector: '.ant-select-item-option-content' }))[1])
  fireEvent.click(screen.getByRole('button', { name: /移\s*动/ }))
  fireEvent.click(screen.getByText('确认转移'))
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(mutate.mock.calls[0][2].transfers).toEqual([{ material_id: 'm1', from_course_id: 'c1', to_course_id: 'c2' }])
  await waitFor(() => expect((screen.getByLabelText('一.pdf的操作') as HTMLButtonElement).disabled).toBe(false))
})

it('hides destructive and reorder controls for the pinned system course', async () => {
  const current = { ...data, courses: [{ id: 'system', name: '未分类', position: 0, is_system: true }, ...data.courses] }
  render(<Directory data={current} selected="m1" busy={false} mutate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} />)
  await directoryAction('未分类', '添加章节')
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
  expect(screen.queryByLabelText('拖动未分类')).toBeNull()
  fireEvent.click(screen.getByLabelText('课程一的操作'))
  expect((await screen.findByRole('menuitem', { name: /上移/ })).getAttribute('aria-disabled')).toBe('true')
})

it('closes a directory menu on outside input and groups move targets by course', async () => {
  setup()
  fireEvent.click(screen.getByLabelText('一.pdf的操作'))
  await screen.findByRole('menu')
  fireEvent.mouseDown(document.body)
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  await directoryAction('一.pdf', '移动到')
  fireEvent.mouseDown(screen.getByLabelText('移动一.pdf到章节'))
  expect((await screen.findAllByText('课程一')).length).toBeGreaterThan(0)
  expect(await screen.findByText('第一章', { selector: '.ant-select-item-option-content' })).toBeTruthy()
  expect(await screen.findByText('第二章', { selector: '.ant-select-item-option-content' })).toBeTruthy()
})
