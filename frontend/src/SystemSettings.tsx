import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Descriptions, Modal, Radio, Select, Tooltip } from 'antd'
import { version } from '../package.json'
import { api } from './api'
import { overlayContainer, type DisplayMode } from './theme'

type Props = {
  mode: DisplayMode
  selectMode: (mode: DisplayMode) => void
  readOnly: boolean
  canReset: boolean
  onClose: () => void
  onReset: (backup: boolean) => void
  onRestore: (id: string) => void
}

function localTime(iso: string) {
  return new Date(iso).toLocaleString('sv-SE', { hour12: false })
}

export function SystemSettings({ mode, selectMode, readOnly, canReset, onClose, onReset, onRestore }: Props) {
  const [open, setOpen] = useState(true)
  const [check, setCheck] = useState(0)
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [started, setStarted] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [backup, setBackup] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backups, setBackups] = useState<string[] | null>(null)
  const [backupId, setBackupId] = useState('')
  const [backupError, setBackupError] = useState('')
  async function openRestore() {
    setBackups(null)
    setBackupId('')
    setBackupError('')
    setRestoring(true)
    try { setBackups(await api<string[]>('/api/backups')) }
    catch (cause) { setBackupError(cause instanceof Error ? cause.message : '无法读取备份列表。') }
  }
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
            <Button danger disabled={!canReset} onClick={() => { setBackup(false); setConfirming(true) }}>清空全部数据</Button>
          </span>
        </Tooltip>
        <Button disabled={!canReset} onClick={() => void openRestore()}>从备份恢复</Button>
      </div>
      <Descriptions size="small" column={1} items={[
        { key: 'build', label: '前端构建时间', children: localTime(__BUILD_TIME__) },
        { key: 'started', label: '后端启动时间', children: started ? localTime(started) : '—' },
        { key: 'version', label: '版本', children: 'v' + version },
      ]} />
    </Modal>
    <Modal open={confirming} title="清空全部数据？" getContainer={overlayContainer} okText="确认清空" cancelText="取消"
      okButtonProps={{ danger: true, disabled: !canReset }} onCancel={() => setConfirming(false)} onOk={() => onReset(backup)}>
      <p>清空课程、章节、课件、原始 PDF 和笔记。系统“未分类”保留为空分类。</p>
      <Checkbox checked={backup} onChange={event => setBackup(event.target.checked)}>清空前备份数据库和原始 PDF</Checkbox>
      <p>备份仅包含已保存的数据，未保存草稿会被清除。</p>
    </Modal>
    <Modal open={restoring} title="从备份恢复" getContainer={overlayContainer} okText="确认恢复" cancelText="取消"
      onCancel={() => setRestoring(false)} onOk={() => onRestore(backupId)}
      okButtonProps={{ danger: true, disabled: !canReset || !backupId }}>
      <p>恢复会用所选备份替换当前课程、课件和笔记，并清除浏览器草稿。</p>
      <Select aria-label="选择备份" placeholder="选择备份" value={backupId || undefined} onChange={setBackupId}
        style={{ width: '100%' }} loading={!backups && !backupError} options={backups?.map(id => ({ value: id, label: id }))} />
      {backups?.length === 0 && <p>暂无备份。</p>}
      {backupError && <Alert type="error" title={backupError} />}
    </Modal>
  </>
}
