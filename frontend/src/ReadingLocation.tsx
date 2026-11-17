import { Breadcrumb, Dropdown, Tooltip, type MenuProps } from 'antd'
import { useRef, useState } from 'react'
import type { Directory, Material } from './api'
import { PdfIcon } from './ReadingControls'
import type { Mode } from './reading'

export function readingPath(mode: Mode, materialId?: string) {
  const path = mode === 'review' ? '/review' : '/note'
  return materialId ? path + '/' + materialId : path
}

export function readingRoute(path: string): { mode: Mode; materialId?: string } | undefined {
  const match = /^\/(note|review)(?:\/([a-zA-Z0-9-]+))?\/?$/.exec(path)
  if (match) return { mode: match[1] === 'review' ? 'review' : 'organize', materialId: match[2] }
}

export function ReadingLocation({ directory, selected, disabled, onSelect }: {
  directory: Directory
  selected: Material | null
  disabled: boolean
  onSelect: (material: Material) => void
}) {
  if (!selected) return <Breadcrumb className="breadcrumb" items={[{ title: '学习工作台' }]} />

  const selectedId = selected.id
  const course = directory.courses.find(item => item.id === selected.course_id)
  const chapters = directory.chapters.filter(item => item.course_id === selected.course_id)
  const chapter = chapters.find(item => item.id === selected.chapter_id)
  const materials = directory.materials.filter(item => item.course_id === selected.course_id)

  function options(chapterId: string | null) {
    return materials.filter(item => item.chapter_id === chapterId).map(item => ({
      key: item.id,
      label: item.title,
      icon: <PdfIcon />,
    }))
  }

  const groups: MenuProps['items'] = chapters.flatMap(item => {
    const children = options(item.id)
    return children.length ? [{ type: 'group' as const, key: item.id, label: item.name, children }] : []
  })
  function choice(name: string, level: string, items: MenuProps['items']) {
    return { key: level, title: <PathChoice name={name} level={level} disabled={disabled}
      menu={{ items, selectable: true, selectedKeys: [selectedId], onClick: ({ key }) => {
        const material = materials.find(item => item.id === key)
        if (material) onSelect(material)
      } }} /> }
  }

  return <Breadcrumb className="breadcrumb" items={[
    choice(course?.name ?? '未知课程', '课程', [...options(null), ...groups]),
    ...(chapter ? [choice(chapter.name, '章节', options(chapter.id))] : []),
    { key: '课件', title: <Tooltip title={selected.title}><span className="readingPathName" aria-current="page">{selected.title}</span></Tooltip> },
  ]} />
}

function PathChoice({ name, level, disabled, menu }: {
  name: string
  level: string
  disabled: boolean
  menu: MenuProps
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return <Dropdown disabled={disabled} trigger={['hover', 'click']}
    open={open && !disabled} onOpenChange={setOpen} autoFocus={button.current === document.activeElement}
    classNames={{ root: 'readingPathPopup' }} styles={{ menu: { padding: 'clamp(16px, 4vw, 20px)' }, item: { padding: '10px 12px' } }} menu={menu}>
    <button ref={button} type="button" className="readingPathChoice" disabled={disabled}
      aria-haspopup="menu" aria-expanded={open && !disabled} aria-label={`${level}：${name}`}>
      <span className="readingPathName">{name}</span>
    </button>
  </Dropdown>
}
