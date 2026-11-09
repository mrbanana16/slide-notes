import { PlusOutlined, EllipsisOutlined, RightOutlined, EditOutlined, ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, FolderOpenOutlined, FolderOutlined, FilePdfOutlined } from '@ant-design/icons'
import { Button, Dropdown, Input, Modal, Select, Tooltip, Tree, type TreeProps } from 'antd'
import { overlayContainer, useMediaPreference } from './theme'
import { useState } from 'react'
import type { Directory as DirectoryData, Material } from './api'
import { treeDropOrder } from './directoryTree'
import { TransferDialog } from './TransferDialog'
import { directoryOrder, movedOrder, projectOrder, type Order } from './directoryOrder'

type Props = {
  readOnly?: boolean; data: DirectoryData; selected: string | undefined; busy: boolean
  onSelect: (material: Material) => void
  mutate: (url: string, method: string, body: object) => Promise<boolean>
  onDelete: (material: Material) => Promise<void>
}
type NameDialog = { title: string; initial: string; url: string; method: string; field: string; course_id?: string }
export function Directory({ data: savedData, selected, busy: externalBusy, onSelect, mutate, onDelete, readOnly = false }: Props) {
  const reducedMotion = useMediaPreference('(prefers-reduced-motion: reduce)')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [moving, setMoving] = useState<Material | null>(null)
  const [destination, setDestination] = useState('')
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
  const toggle = (id: string) => setClosed(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
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

    const rename = () => openName({ title: '重命名', initial: name, url: '/api/' + kind + '/' + id, method: 'PATCH', field: kind === 'materials' ? 'filename' : 'name' })
    const remove = () => {
      if (kind === 'materials') void onDelete(data.materials.find(m => m.id === id)!)
      else modal.confirm({ title: '删除“' + name + '”？', content: '仅可删除空课程或空章节。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
        getContainer: overlayContainer, onOk: () => mutate('/api/' + kind + '/' + id, 'DELETE', {}) })
    }
    return <Dropdown trigger={['click']} open={menuId === id} onOpenChange={open => setMenuId(open ? id : null)}
      menu={{ items: [
        ...(kind === 'courses' ? [{ key: 'chapter', label: '添加章节', icon: <PlusOutlined />, disabled: busy, onClick: () => create('chapters', id) }] : []),
        ...(!fixed ? [{ key: 'rename', label: '重命名', icon: <EditOutlined />, disabled: busy, onClick: rename },
        { key: 'up', label: '上移', icon: <ArrowUpOutlined />, disabled: busy || ids.indexOf(id) === 0, onClick: () => shift(id, ids, -1) },
        { key: 'down', label: '下移', icon: <ArrowDownOutlined />, disabled: busy || ids.indexOf(id) === ids.length - 1, onClick: () => shift(id, ids, 1) },
        ...(kind === 'materials' ? [{ key: 'move', label: '移动到…', icon: <FolderOpenOutlined />, disabled: busy, onClick: () => {
          const material = data.materials.find(m => m.id === id)!
          setMoving(material); setDestination('group:' + (material.chapter_id ?? material.course_id))
        } }] : []),
        { key: 'delete', label: '删除' + (kind === 'materials' ? '课件' : kind === 'courses' ? '课程' : '章节'), icon: <DeleteOutlined />, danger: true, disabled: busy, onClick: remove }] : []),
      ], onClick: () => setMenuId(null) }}>
      <Button type="text" className="directoryActions" data-open={menuId === id} aria-label={`${name}的操作`} icon={<EllipsisOutlined />} disabled={busy} />
    </Dropdown>
  }

  const materials = (course: string, chapter: string | null) => data.materials.filter(item => item.course_id === course && item.chapter_id === chapter).map(item => ({
    key: item.id, title: item.filename, kind: 'materials', course, isLeaf: true, disabled: busy,
  }))
  const treeData = data.courses.map(course => ({
    key: course.id, title: course.name, kind: 'courses', course: course.id, isLeaf: false, disabled: busy,
    children: [...materials(course.id, null), ...data.chapters.filter(item => item.course_id === course.id).map(item => ({
      key: item.id, title: item.name, kind: 'chapters', course: course.id, isLeaf: false, disabled: busy, children: materials(course.id, item.id),
    }))],
  }))
  type DirectoryNode = (typeof treeData)[number] | ReturnType<typeof materials>[number] | (typeof treeData)[number]['children'][number]
  const expandedKeys = [...data.courses, ...data.chapters].filter(item => !closed.has(item.id)).map(item => item.id)
  const onDrop: TreeProps<DirectoryNode>['onDrop'] = info => {
    if (busy || readOnly) return
    const position = info.dropToGap ? info.dropPosition - Number(info.node.pos.split('-').at(-1)) : 0
    const next = treeDropOrder(data, String(info.dragNode.key), String(info.node.key), position)
    if (next) submitOrder(next)
  }
  const titleRender = (node: DirectoryNode) => {
    const id = String(node.key)
    const item = data.materials.find(item => item.id === id)
    if (!item && !data.courses.some(entry => entry.id === id) && !data.chapters.some(entry => entry.id === id)) return <span className="treeText">{node.title}</span>
    const ids = node.kind === 'courses' ? order.course_ids.filter(id => !data.courses.find(course => course.id === id)?.is_system)
      : node.kind === 'chapters' ? order.chapter_ids[node.course] : order.material_ids[item!.chapter_id ?? item!.course_id]
    return <div className="treeRow">
      <span className={item ? 'treeName material' : 'treeName'} title={item ? '' : String(node.title)} aria-label={String(node.title)} aria-current={selected === id ? 'page' : undefined}>
        {item ? <FilePdfOutlined aria-hidden="true" /> : closed.has(id) ? <FolderOutlined aria-hidden="true" /> : <FolderOpenOutlined aria-hidden="true" />}
        {item ? <><Tooltip title={item.filename}><span className="treeText"><strong>{item.filename}</strong></span></Tooltip><small>{item.page_count} 页</small></>
          : <span className="treeText">{node.title}</span>}
      </span>
      <span className="treeActions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} draggable={false} onDragStart={event => { event.preventDefault(); event.stopPropagation() }}>{controls(node.kind, id, String(node.title), ids)}</span>
    </div>
  }
  return <>
    <div className="directoryHeading">课程目录 <Tooltip title="创建课程"><Button type="text" disabled={busy || readOnly} onClick={() => void create('courses')} aria-label="创建课程"><PlusOutlined /></Button></Tooltip></div>
    {modalHolder}
    <Modal open={!!moving} title={'移动“' + moving?.filename + '”'} getContainer={overlayContainer} okText="移动" cancelText="取消"
      onCancel={() => setMoving(null)} okButtonProps={{ disabled: busy }} onOk={() => {
        if (!moving || busy) return
        const next = movedOrder(data, moving.id, destination)
        setMoving(null)
        if (next) submitOrder(next)
      }}>
      <Select aria-label={moving ? `移动${moving.filename}到章节` : '移动目标'} style={{ width: '100%' }} value={destination} onChange={setDestination} disabled={busy}
        options={data.courses.map(course => ({ label: course.name, options: [
          { value: 'group:' + course.id, label: '课程直属' },
          ...data.chapters.filter(c => c.course_id === course.id).map(c => ({ value: 'group:' + c.id, label: c.name })),
        ] }))} />
    </Modal>
    <Modal open={!!dialog} title={dialog?.title} getContainer={overlayContainer} onCancel={() => { if (!busy) setDialog(null) }}
      onOk={() => void submitName()} okText="保存" cancelText="取消" okButtonProps={{ disabled: busy || !text.trim() }}>
      <Input placeholder={dialog?.title === '创建课程' ? '课程名称' : dialog?.title === '添加章节' ? '章节名称' : '新名称'} aria-label="名称" maxLength={200} value={text} disabled={busy} onChange={e => setText(e.target.value)} onPressEnter={e => { if (!e.nativeEvent.isComposing) void submitName() }} />
      {invalid && <p role="alert">保存失败，请检查名称或重新加载目录。</p>}
    </Modal>
    <nav aria-label="课程结构"><Tree<DirectoryNode> blockNode className="directoryTree" treeData={treeData} titleRender={titleRender}
      motion={reducedMotion ? { motionEnter: false, motionLeave: false, motionAppear: false } : undefined}
      selectedKeys={selected ? [selected] : []} expandedKeys={expandedKeys} autoExpandParent={false}
      onExpand={keys => setClosed(new Set([...data.courses, ...data.chapters].filter(item => !keys.includes(item.id)).map(item => item.id)))}
      switcherIcon={props => <span className={`treeChevron${props.expanded ? ' expanded' : ''}`}><RightOutlined aria-label={(props.expanded ? '收起' : '展开') + props.title} /></span>}
      onSelect={(_, info) => {
        if (busy) return
        const item = data.materials.find(item => item.id === info.node.key)
        if (item) onSelect(item)
        else toggle(String(info.node.key))
      }}
      draggable={readOnly || busy ? false : { icon: false, nodeDraggable: node => !data.courses.find(item => item.id === node.key)?.is_system }}
      allowDrop={({ dragNode, dropNode, dropPosition }) => !busy && !readOnly && !!treeDropOrder(data, String(dragNode.key), String(dropNode.key), dropPosition)}
      onDragEnter={info => setClosed(new Set([...data.courses, ...data.chapters].filter(item => !info.expandedKeys.includes(item.id)).map(item => item.id)))}
      onDrop={onDrop} /></nav>
    {transfer && <TransferDialog data={savedData} order={transfer} onCancel={() => setTransfer(null)} onConfirm={() => { const next = transfer; setTransfer(null); void saveOrder(next) }} />}
  </>
}
