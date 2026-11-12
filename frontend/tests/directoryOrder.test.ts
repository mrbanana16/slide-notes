import { expect, it } from 'vitest'
import { directoryOrder, movedOrder, projectOrder } from '../src/directoryOrder'
import type { Directory } from '../src/api'

const data: Directory = {
  revision: 7,
  courses: [{ id: 'c1', name: '课程一', position: 0 }, { id: 'c2', name: '课程二', position: 1 }],
  chapters: [{ id: 'ch1', name: '第一章', course_id: 'c1', position: 0 }, { id: 'ch2', name: '第二章', course_id: 'c1', position: 1 }],
  materials: [
    { id: 'm1', filename: '一.pdf', course_id: 'c1', chapter_id: null, position: 0, page_count: 1 },
    { id: 'm2', filename: '二.pdf', course_id: 'c1', chapter_id: null, position: 1, page_count: 1 },
    { id: 'm3', filename: '三.pdf', course_id: 'c1', chapter_id: 'ch1', position: 0, page_count: 1 },
  ],
}
it('reorders in both directions without mutating the server snapshot', () => {
  expect(movedOrder(data, 'm1', 'm2')?.material_ids.c1).toEqual(['m2', 'm1'])
  expect(movedOrder(data, 'm2', 'm1')?.material_ids.c1).toEqual(['m2', 'm1'])
  expect(movedOrder(data, 'c1', 'c2')?.course_ids).toEqual(['c2', 'c1'])
  expect(movedOrder(data, 'ch1', 'ch2')?.chapter_ids.c1).toEqual(['ch2', 'ch1'])
  expect(directoryOrder(data).material_ids.c1).toEqual(['m1', 'm2'])
})
it('moves between chapters and empty groups, preserving all stable ids and revision', () => {
  const order = movedOrder(data, 'm1', 'group:ch2')!
  expect(order.material_ids.ch2).toEqual(['m1'])
  expect(order.material_ids.c1).toEqual(['m2'])
  expect(order.revision).toBe(7)
  expect(movedOrder(data, 'm3', 'group:c1')?.material_ids.c1).toEqual(['m1', 'm2', 'm3'])
  expect(movedOrder(data, 'm1', 'm3')?.material_ids.ch1).toEqual(['m1', 'm3'])
})
it('rejects incompatible drag targets', () => {
  for (const [active, target] of [['ch1', 'c2'], ['c1', 'm1'], ['unknown', 'm1'], ['m1', 'm1']]) expect(movedOrder(data, active, target)).toBeNull()
})

it('moves a material to another course header with explicit transfer details', () => {
  const next = movedOrder(data, 'm1', 'c2')!
  expect(next.transfers).toEqual([{ material_id: 'm1', from_course_id: 'c1', to_course_id: 'c2' }])
  expect(next.material_ids.c1).toEqual(['m2'])
  expect(next.material_ids.c2).toEqual(['m1'])
  const projected = projectOrder(data, next)
  expect(projected.materials.find(m => m.id === 'm1')).toMatchObject({ id: 'm1', course_id: 'c2', chapter_id: null })
  expect(data.materials[0].course_id).toBe('c1')
})
it('keeps the system course pinned and allows material drops into it', () => {
  const system = { id: 'system', name: '未分类', position: 0, is_system: true }
  const current = { ...data, courses: [system, ...data.courses] }
  expect(movedOrder(current, 'system', 'c1')).toBeNull()
  expect(movedOrder(current, 'c1', 'system')).toBeNull()
  expect(movedOrder(current, 'm1', 'system')?.material_ids.system).toEqual(['m1'])
})
