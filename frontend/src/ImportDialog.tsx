import { InboxOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { Alert, Button, Input, Modal, Select, Upload } from 'antd'
import type { Directory } from './api'
import { PdfIcon } from './ReadingControls'
import { overlayContainer } from './theme'

type ChoiceProps = {
  kind: string; value: string; options: { value: string; label: string }[]; disabled: boolean
  onSelect: (value: string) => void; onCreate: (name: string) => Promise<boolean>
}
function DestinationChoice({ kind, value, options, disabled, onSelect, onCreate }: ChoiceProps) {
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  return <div className="destinationChoice"><span>{kind}</span>
    <Select aria-label={'导入到' + kind} value={value} options={options} disabled={disabled} open={open}
      onOpenChange={setOpen} onChange={v => { onSelect(v); setOpen(false) }}
      getPopupContainer={node => node.parentElement!}
      popupRender={menu => <>{menu}<form className="createDestination" onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
        onSubmit={async e => { e.preventDefault(); if (name.trim() && await onCreate(name.trim())) { setName(''); setOpen(false) } }}>
        <Input aria-label={'新' + kind + '名称'} placeholder={'也可在这里创建新' + kind + '...'} value={name} maxLength={200}
          disabled={disabled} onChange={e => setName(e.target.value)} />
        <Button htmlType="submit" disabled={disabled || !name.trim()}>创建</Button>
      </form></>} />
  </div>
}

type Props = {
  open: boolean; directory: Directory; course: string; chapter: string; file: File | null; busy: boolean; error: string; duplicate?: string
  onOpenExisting: () => void; onCourse: (id: string) => void; onChapter: (id: string) => void; onFile: (file: File) => void
  onReload?: () => void; onClose: () => void; onSubmit: () => void; onCreate: (name: string, chapter: boolean) => Promise<boolean>
}
export function ImportDialog({ open, directory, course, chapter, file, busy, error, duplicate, onOpenExisting, onCourse, onChapter, onFile, onReload, onClose, onSubmit, onCreate }: Props) {
  const options = (items: { id: string; name: string }[]) => items.map(item => ({ value: item.id, label: item.name }))
  return <Modal title="导入 PDF 课件" open={open} destroyOnHidden getContainer={overlayContainer} onCancel={onClose}
    closable={!busy} mask={{ closable: !busy }} keyboard={!busy} cancelText="取消" okText="确认导入"
    onOk={onSubmit} okButtonProps={{ disabled: busy || !file || !course || !!duplicate }} cancelButtonProps={{ disabled: busy }}
    >
    <div className="importFields">
      <Upload.Dragger accept="application/pdf,.pdf" multiple={false} maxCount={1} disabled={busy} showUploadList={false}
        aria-label="选择 PDF 课件" beforeUpload={next => { onFile(next); return false }}>
        {file ? <div className="selectedFile"><PdfIcon /><span><strong>{file.name}</strong><small>{file.size < 1048576 ? (file.size / 1024).toFixed(2) + ' KB' : (file.size / 1048576).toFixed(2) + ' MB'} · {new Date(file.lastModified).toLocaleString('sv-SE').slice(0,16)} 修改</small></span></div>
          : <><p className="ant-upload-drag-icon"><InboxOutlined aria-hidden="true" /></p><p className="ant-upload-text">选择PDF文件</p><p className="ant-upload-hint">目前仅支持PDF格式课件，大小上限为100MB</p></>}
      </Upload.Dragger>
      <DestinationChoice kind="课程" value={course} options={options(directory.courses)} disabled={busy} onSelect={onCourse} onCreate={name => onCreate(name, false)} />
      <DestinationChoice key={course} kind="章节" value={chapter} options={[{ value: '', label: '课程直属（无章节）' }, ...options(directory.chapters.filter(c => c.course_id === course))]} disabled={busy || !course} onSelect={onChapter} onCreate={name => onCreate(name, true)} />
      {duplicate && <Alert type="info" showIcon title="课件已存在" description={<>所在位置：{duplicate}</>} action={<Button onClick={onOpenExisting}>打开已有课件</Button>} />}
      {error && <Alert type="error" showIcon title={error} action={onReload && <Button disabled={busy} onClick={onReload}>重新加载目录</Button>} />}
    </div>
  </Modal>
}
