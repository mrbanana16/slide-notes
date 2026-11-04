import type { Directory } from './api'

export type Transfer = { material_id: string; from_course_id: string; to_course_id: string }
export type Order = { transfers: Transfer[]; revision: number; course_ids: string[]; chapter_ids: Record<string, string[]>; material_ids: Record<string, string[]> }
export function directoryOrder(data: Directory): Order {
  const chapter_ids: Record<string, string[]> = {}
  const material_ids: Record<string, string[]> = {}
  for (const course of data.courses) {
    chapter_ids[course.id] = data.chapters.filter(c => c.course_id === course.id).map(c => c.id)
    material_ids[course.id] = data.materials.filter(m => m.course_id === course.id && !m.chapter_id).map(m => m.id)
  }
  for (const chapter of data.chapters) material_ids[chapter.id] = data.materials.filter(m => m.chapter_id === chapter.id).map(m => m.id)
  return { transfers: [], revision: data.revision, course_ids: data.courses.map(c => c.id), chapter_ids, material_ids }
}
export function movedOrder(data: Directory, active: string, target: string, after = false): Order | null {
  if (active === target) return null
  const order = directoryOrder(data)
  let from: string[] | undefined
  let to: string[] | undefined
  let targetId = target
  if (data.courses.some(c => c.id === active)) {
    if (data.courses.find(c => c.id === active)?.is_system || !data.courses.some(c => c.id === target && !c.is_system)) return null
    from = to = order.course_ids
  } else if (data.chapters.some(c => c.id === active)) {
    const source = data.chapters.find(c => c.id === active)!
    if (!data.chapters.some(c => c.id === target && c.course_id === source.course_id)) return null
    from = to = order.chapter_ids[source.course_id]
  } else {
    const source = data.materials.find(m => m.id === active)
    if (!source) return null
    const materialTarget = data.materials.find(m => m.id === target)
    const parent = target.startsWith('group:') ? target.slice(6) : materialTarget ? materialTarget.chapter_id ?? materialTarget.course_id : data.chapters.find(c => c.id === target)?.id ?? data.courses.find(c => c.id === target)?.id
    const courseId = data.chapters.find(c => c.id === parent)?.course_id ?? parent
    if (!parent || !courseId || !data.courses.some(c => c.id === courseId)) return null
    if (courseId !== source.course_id) order.transfers = [{ material_id: source.id, from_course_id: source.course_id, to_course_id: courseId }]
    from = order.material_ids[source.chapter_id ?? source.course_id]
    to = order.material_ids[parent]
    if (target.startsWith('group:')) targetId = ''
  }
  if (!from || !to) return null
  const oldIndex = from.indexOf(active)
  const originalTarget = to.indexOf(targetId)
  from.splice(oldIndex, 1)
  const index = to.indexOf(targetId)
  const insertion = index < 0 ? to.length : index + (after || (from === to && oldIndex < originalTarget) ? 1 : 0)
  to.splice(insertion, 0, active)
  return order
}

export function projectOrder(data: Directory, order: Order): Directory {
  const chapters = data.courses.flatMap(course => order.chapter_ids[course.id].map((id, position) => ({ ...data.chapters.find(c => c.id === id)!, position })))
  const materials = Object.entries(order.material_ids).flatMap(([parent, ids]) => ids.map((id, position) => ({ ...data.materials.find(m => m.id === id)!, position, course_id: chapters.find(c => c.id === parent)?.course_id ?? parent, chapter_id: chapters.some(c => c.id === parent) ? parent : null })))
  return { ...data, courses: order.course_ids.map((id, position) => ({ ...data.courses.find(c => c.id === id)!, position })), chapters, materials }
}
export function materialPath(data: Directory, material: { course_id: string; chapter_id: string | null; filename?: string }) {
  return [data.courses.find(c => c.id === material.course_id)?.name ?? '未知课程', material.chapter_id ? data.chapters.find(c => c.id === material.chapter_id)?.name : null, material.filename].filter(Boolean).join(' / ')
}
