import type { Directory } from './api'
import { movedOrder, type Order } from './directoryOrder'

export function treeDropOrder(data: Directory, active: string, target: string, position: number): Order | null {
  const course = data.courses.find(item => item.id === active)
  const chapter = data.chapters.find(item => item.id === active)
  const material = data.materials.find(item => item.id === active)
  const targetMaterial = data.materials.find(item => item.id === target)
  if (course || chapter) {
    if (!position) return null
  } else if (!material || (targetMaterial ? position === 0 : position !== 0)) return null
  const order = movedOrder(data, active, target)
  if (!order) return null
  if (position) {
    const ids = course ? order.course_ids : chapter ? order.chapter_ids[chapter.course_id] : order.material_ids[targetMaterial!.chapter_id ?? targetMaterial!.course_id]
    ids.splice(ids.indexOf(active), 1)
    ids.splice(ids.indexOf(target) + (position > 0 ? 1 : 0), 0, active)
  }
  return order
}
