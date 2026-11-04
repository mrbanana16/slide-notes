import { useEffect, useRef } from 'react'
import type { Directory } from './api'
import { materialPath, projectOrder, type Order } from './directoryOrder'

export function TransferDialog({ data, order, onCancel, onConfirm }: { data: Directory; order: Order; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  const projected = projectOrder(data, order)
  return <dialog ref={dialog} className="importDialog" aria-labelledby="transferTitle" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="transferTitle">转移课件所属课程？</h2>
    <p>此次移动会改变课件的所属课程，原始页面与笔记一起保留。</p>
    {order.transfers.map(transfer => <div className="transferDetails" key={transfer.material_id}><strong>{data.materials.find(m => m.id === transfer.material_id)?.filename}</strong><p>从：{materialPath(data, data.materials.find(m => m.id === transfer.material_id)!)}</p><p>到：{materialPath(projected, projected.materials.find(m => m.id === transfer.material_id)!)}</p></div>)}
    <div className="dialogFooter"><button autoFocus onClick={onCancel}>取消</button><button className="primary" onClick={onConfirm}>确认转移</button></div>
  </dialog>
}
