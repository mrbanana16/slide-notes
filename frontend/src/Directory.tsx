import { Input, Modal, Tooltip } from 'antd'
import { overlayContainer } from './theme'
import { useRef, useEffect, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type CollisionDetection } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import type { Directory as DirectoryData, Material } from './api'
import { compatibleDrop, directoryKeyboardCoordinates } from './directoryDnd'
import { TransferDialog } from './TransferDialog'
import { directoryOrder, movedOrder, projectOrder, type Order } from './directoryOrder'

type Props = {
  readOnly?: boolean; data: DirectoryData; selected: string | undefined; busy: boolean
  onSelect: (material: Material) => void
  mutate: (url: string, method: string, body: object) => Promise<boolean>
  onDelete: (material: Material) => Promise<void>
}
function Row({ id, name, kind, course, busy, fixed = false, children, leading, onClick, selected, pages, blocked }: {
  id: string; name: string; kind: string; course?: string; busy: boolean; fixed?: boolean; children: ReactNode
  leading?: ReactNode; onClick?: () => void; selected?: boolean; pages?: number; blocked?: boolean
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging, isOver } = useSortable({ id, data: { kind, course, fixed }, disabled: { draggable: busy || fixed, droppable: busy } })
  return <div ref={setNodeRef} className={`directoryRow ${kind}Row ${isDragging ? 'dragSource' : ''} ${isOver ? 'dropTarget' : ''}`}>
    {leading}<button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-disabled={blocked || undefined} disabled={blocked}
      aria-label={name} title={name} className={kind === 'material' ? 'material' + (selected ? ' selected' : '') : 'containerName'}
      aria-current={selected ? 'page' : undefined} onClick={onClick}>
      {pages === undefined ? name : <span><strong>{name}</strong><small>{pages} 页</small></span>}
    </button>{children}
  </div>
}
function Group({ id, course, busy, empty, children }: { id: string; course: string; busy: boolean; empty: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'group:' + id, data: { kind: 'group', course, empty }, disabled: busy })
  return <div ref={setNodeRef} className={`materialGroup ${isOver ? 'groupTarget' : ''}`}>{children}</div>
}
type NameDialog = { title: string; initial: string; url: string; method: string; field: string; course_id?: string }
export function Directory({ data: savedData, selected, busy: externalBusy, onSelect, mutate, onDelete, readOnly = false }: Props) {
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    function dismiss(event: PointerEvent | FocusEvent | KeyboardEvent) {
      const menu = nav.current?.querySelector<HTMLDetailsElement>('.directoryActions[open]')
      if (!menu) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        menu.querySelector('summary')?.focus()
      } else if (event.target instanceof Node && menu.contains(event.target)) return
      menu.open = false
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [])
  const [optimistic, setOptimistic] = useState<DirectoryData | null>(null)
  const [saving, setSaving] = useState(false)
  const [transfer, setTransfer] = useState<Order | null>(null)
  const data = optimistic ?? savedData
  const busy = externalBusy || saving
  async function saveOrder(next: Order) {
    if (busy) return
    setSaving(true)
    const projected = projectOrder(savedData, next)
    setOptimistic(projected)
    setClosed(old => {
      const expanded = new Set(old)
      for (const material of projected.materials) {
        const previous = savedData.materials.find(m => m.id === material.id)
        if (previous?.course_id !== material.course_id || previous?.chapter_id !== material.chapter_id) {
          expanded.delete(material.course_id)
          if (material.chapter_id) expanded.delete(material.chapter_id)
        }
      }
      return expanded
    })
    try { await mutate('/api/directory/order', 'PUT', next) }
    finally { setOptimistic(null); setSaving(false) }
  }
  function submitOrder(next: Order) {
    if (next.transfers.length) setTransfer(next)
    else void saveOrder(next)
  }
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }, coordinateGetter: directoryKeyboardCoordinates, scrollBehavior: 'auto' }))
  const toggle = (id: string) => setClosed(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const collision: CollisionDetection = args => closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(container => {
    return compatibleDrop(args.active.data.current, container.data.current)
  }) })
  const order = directoryOrder(data)
  const [dialog, setDialog] = useState<NameDialog | null>(null)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [modal, modalHolder] = Modal.useModal()
  function openName(config: NameDialog) {
    setText(config.initial); setInvalid(false); setDialog(config)
  }
  function create(kind: 'courses' | 'chapters', course_id?: string) {
    openName({ title: kind === 'courses' ? '创建课程' : '添加章节', initial: '', url: '/api/' + kind, method: 'POST', field: 'name', course_id })
  }
  async function submitName() {
    if (!dialog || !text.trim() || busy) return
    if (await mutate(dialog.url, dialog.method, { [dialog.field]: text.trim(), course_id: dialog.course_id })) setDialog(null)
    else setInvalid(true)
  }
  function shift(id: string, ids: string[], direction: number) {
    const target = ids[ids.indexOf(id) + direction]
    const next = target && movedOrder(data, id, target)
    if (next) submitOrder(next)
  }
  function controls(kind: string, id: string, name: string, ids: string[]) {
    if (readOnly) return null
    const fixed = kind === 'courses' && data.courses.find(c => c.id === id)?.is_system
    if (fixed) return null
    return <details name="directory-actions" className="directoryActions"><summary aria-label={`${name}的操作`}>⋯</summary><div>
      {!fixed && <><button disabled={busy} onClick={() => openName({ title: '重命名', initial: name, url: '/api/' + kind + '/' + id, method: 'PATCH', field: kind === 'materials' ? 'filename' : 'name' })}>重命名</button>
      <button disabled={busy || ids.indexOf(id) === 0} onClick={() => shift(id, ids, -1)}>上移</button>
      <button disabled={busy || ids.indexOf(id) === ids.length - 1} onClick={() => shift(id, ids, 1)}>下移</button></>}
      {kind === 'materials' ? <><label>移动到课程／章节<select aria-label={`移动${name}到章节`} disabled={busy} value={'group:' + (data.materials.find(m => m.id === id)?.chapter_id ?? data.materials.find(m => m.id === id)?.course_id)} onChange={event => {
        const next = movedOrder(data, id, event.target.value)
        if (next) submitOrder(next)
      }}>{data.courses.map(course => <optgroup key={course.id} label={course.name}><option value={'group:' + course.id}>课程直属</option>{data.chapters.filter(c => c.course_id === course.id).map(c => <option key={c.id} value={'group:' + c.id}>{c.name}</option>)}</optgroup>)}</select></label>
      <button disabled={busy} className="deleteAction" onClick={() => void onDelete(data.materials.find(m => m.id === id)!)}>删除课件</button></> : !fixed && <button disabled={busy} className="deleteAction" onClick={() => {
        modal.confirm({ title: '删除“' + name + '”？', content: '仅可删除空课程或空章节。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
          getContainer: overlayContainer, onOk: () => mutate('/api/' + kind + '/' + id, 'DELETE', {}) })

      }}>删除{kind === 'courses' ? '课程' : '章节'}</button>}
    </div></details>
  }
  const materialList = (course: string, chapter: string | null) => {
    const parent = chapter ?? course
    const items = data.materials.filter(m => m.course_id === course && m.chapter_id === chapter)
    return <Group id={parent} course={course} busy={busy || readOnly} empty={!items.length}>{items.map(material => <Row key={material.id} id={material.id} kind="material" course={course} name={material.filename} busy={busy || readOnly} selected={selected === material.id} pages={material.page_count} blocked={busy} onClick={() => onSelect(material)}>
      {controls('materials', material.id, material.filename, order.material_ids[parent])}
    </Row>)}{!items.length && <p className="groupEmpty">暂无课件</p>}</Group>
  }
  const visibleIds = data.courses.flatMap(c => [c.id, ...(closed.has(c.id) ? [] : [...order.material_ids[c.id], ...data.chapters.filter(ch => ch.course_id === c.id).flatMap(ch => [ch.id, ...(closed.has(ch.id) ? [] : order.material_ids[ch.id])])])])
  const activeName = data.courses.find(c => c.id === active)?.name ?? data.chapters.find(c => c.id === active)?.name ?? data.materials.find(m => m.id === active)?.filename
  return <>
    <div className="directoryHeading">课程目录 <button disabled={busy || readOnly} onClick={() => void create('courses')} aria-label="创建课程">＋ 课程</button></div>
    {modalHolder}
    <Modal open={!!dialog} title={dialog?.title} getContainer={overlayContainer} onCancel={() => { if (!busy) setDialog(null) }}
      onOk={() => void submitName()} okText="保存" cancelText="取消" okButtonProps={{ disabled: busy || !text.trim() }}>
      <Input placeholder={dialog?.title === '创建课程' ? '课程名称' : dialog?.title === '添加章节' ? '章节名称' : '新名称'} aria-label="名称" maxLength={200} value={text} disabled={busy} onChange={e => setText(e.target.value)} onPressEnter={e => { if (!e.nativeEvent.isComposing) void submitName() }} />
      {invalid && <p role="alert">保存失败，请检查名称或重新加载目录。</p>}
    </Modal>
    <nav ref={nav} aria-label="课程结构"><DndContext sensors={sensors} collisionDetection={collision} accessibility={{ screenReaderInstructions: { draggable: '按空格开始拖动，方向键移动，空格放下，Esc 取消。也可在操作菜单中移动。' }, announcements: {
      onDragStart: () => '已开始拖动目录条目。', onDragOver: ({ over }) => over ? '已到达可放置位置。' : '当前无可放置位置。', onDragEnd: () => '拖动结束，请查看目录保存结果。', onDragCancel: () => '已取消拖动。',
    } }} onDragStart={({ active }) => setActive(String(active.id))} onDragCancel={() => setActive(null)} onDragEnd={({ active, over }) => {
      setActive(null)
      if (over) { const next = movedOrder(data, String(active.id), String(over.id)); if (next) submitOrder(next) }
    }}><SortableContext items={visibleIds} strategy={() => null}>
      {data.courses.map(course => <section className="courseSection" key={course.id}>
        <Row id={course.id} name={course.name} kind="course" course={course.id} busy={busy || readOnly} fixed={course.is_system} onClick={() => toggle(course.id)} blocked={busy}
          leading={<button className="expandArrow" aria-expanded={!closed.has(course.id)} aria-label={(closed.has(course.id) ? '展开' : '收起') + course.name} onClick={() => toggle(course.id)}>{closed.has(course.id) ? '▸' : '▾'}</button>}>
          {controls('courses', course.id, course.name, order.course_ids.filter(id => !data.courses.find(c => c.id === id)?.is_system))}
          {!readOnly && <Tooltip title="添加章节" placement="top"><button className="addChapter" aria-label={'为' + course.name + '添加章节'} disabled={busy} onClick={() => create('chapters', course.id)}>＋</button></Tooltip>}</Row>
        {!closed.has(course.id) && <div className="courseContents"><div className="directLabel">课程直属</div>{materialList(course.id, null)}{data.chapters.filter(c => c.course_id === course.id).map(chapter => <section className="chapterSection" key={chapter.id}>
          <Row id={chapter.id} name={chapter.name} kind="chapter" course={course.id} busy={busy || readOnly} onClick={() => toggle(chapter.id)} blocked={busy}
          leading={<button className="expandArrow" aria-expanded={!closed.has(chapter.id)} aria-label={(closed.has(chapter.id) ? '展开' : '收起') + chapter.name} onClick={() => toggle(chapter.id)}>{closed.has(chapter.id) ? '▸' : '▾'}</button>}>{controls('chapters', chapter.id, chapter.name, order.chapter_ids[course.id])}</Row>
          {!closed.has(chapter.id) && materialList(course.id, chapter.id)}
        </section>)}</div>}
      </section>)}
    </SortableContext><DragOverlay dropAnimation={null}>{active ? <div className="directoryDragPreview">{activeName}</div> : null}</DragOverlay></DndContext></nav>
    {transfer && <TransferDialog data={savedData} order={transfer} onCancel={() => setTransfer(null)} onConfirm={() => { const next = transfer; setTransfer(null); void saveOrder(next) }} />}
    {!data.courses.length && <p className="directoryEmpty">先创建课程，再导入课件。</p>}
  </>
}
