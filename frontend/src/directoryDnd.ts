import type { Data, KeyboardCoordinateGetter } from '@dnd-kit/core'

export function compatibleDrop(source: Data | undefined, target: Data | undefined) {
  if (!source || !target) return false
  if (source.kind === 'material') return ['material', 'group', 'chapter', 'course'].includes(target.kind)
  return source.kind === 'course' ? target.kind === 'course' && !target.fixed : source.course === target.course && target.kind === 'chapter'
}

export const directoryKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.code)) return
  event.preventDefault()
  const { active, over, collisionRect, droppableContainers, droppableRects } = context
  if (!active || !collisionRect) return
  const candidates = droppableContainers.getEnabled().filter(item => compatibleDrop(active.data.current, item.data.current) && (item.data.current?.kind !== 'group' || item.data.current?.empty))
    .map(item => ({ id: item.id, rect: droppableRects.get(item.id) }))
    .filter(item => item.rect !== undefined).sort((a, b) => a.rect!.top - b.rect!.top)
  const index = candidates.findIndex(item => item.id === (over?.id ?? active.id))
  if (index < 0) return
  const next = candidates[index + (event.code === 'ArrowDown' ? 1 : -1)]?.rect
  if (next) return { x: next.left + (next.width - collisionRect.width) / 2, y: next.top + (next.height - collisionRect.height) / 2 }
}
