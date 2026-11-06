import { useEffect, useState } from 'react'
import { Badge, Button, Descriptions, Modal, Radio, Tooltip } from 'antd'
import { api } from './api'
import { overlayContainer, type DisplayMode } from './theme'

type Props = {
  mode: DisplayMode
  selectMode: (mode: DisplayMode) => void
  readOnly: boolean
  canReset: boolean
  onClose: () => void
  onReset: () => void
}

function localTime(iso: string) {
  return new Date(iso).toLocaleString('sv-SE', { hour12: false })
}

export function SystemSettings({ mode, selectMode, readOnly, canReset, onClose, onReset }: Props) {
  const [open, setOpen] = useState(true)
  const [check, setCheck] = useState(0)
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [started, setStarted] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    let active = true
    setStatus('checking')
    setStarted('')
    void api<{ status: string; started_at: string }>('/api/status', { cache: 'no-store', signal: controller.signal })
      .then(result => {
        if (!active) return
        if (result?.status !== 'ok' || !Number.isFinite(Date.parse(result.started_at))) throw new Error('Invalid status')
        setStarted(result.started_at)
        setStatus('online')
      })
      .catch(() => { if (active) setStatus('offline') })
      .finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [check])
  return <>
    <Modal open={open} afterClose={onClose} title="系统设置" getContainer={overlayContainer} footer={null} onCancel={() => setOpen(false)}>
      <div className="settingsRow"><strong>后端运行状态</strong>
        <span role="status"><Badge status={status === 'online' ? 'success' : status === 'offline' ? 'error' : 'warning'} /> {status === 'online' ? '在线' : status === 'offline' ? '连接失败，请检查后端服务' : '检测中…'}</span>
        <Button disabled={status === 'checking'} onClick={() => setCheck(n => n + 1)}>刷新</Button>
      </div>
      <div className="settingsRow"><strong id="display-label">显示模式</strong>
        <Radio.Group aria-labelledby="display-label" value={mode} onChange={event => selectMode(event.target.value)}
          options={[{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }]} />
      </div>
      <div className="settingsRow">
        <Tooltip title={readOnly ? '当前为复习模式，数据处于只读状态' : null} trigger={['hover', 'focus']}>
          <span className="resetTooltipTarget" tabIndex={readOnly ? 0 : undefined} aria-label={readOnly ? '清空全部数据（复习模式只读）' : undefined}>
            <Button danger disabled={!canReset} onClick={() => setConfirming(true)}>清空全部数据</Button>
          </span>
        </Tooltip>
      </div>
      <Descriptions size="small" column={1} items={[
        { key: 'build', label: '前端构建时间', children: localTime(__BUILD_TIME__) },
        { key: 'started', label: '后端启动时间', children: started ? localTime(started) : '—' },
      ]} />
    </Modal>
    <Modal open={confirming} title="清空全部数据？" getContainer={overlayContainer} okText="确认清空" cancelText="取消"
      okButtonProps={{ danger: true, disabled: !canReset }} onCancel={() => setConfirming(false)} onOk={onReset}>
      所有普通课程、章节、课件、原始 PDF、已保存笔记和当前未保存内容都将永久删除，无法撤销。系统“未分类”保留为空分类。
    </Modal>
  </>
}
