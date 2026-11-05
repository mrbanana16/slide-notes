import { Modal } from 'antd'
import { overlayContainer } from './theme'
import type { Directory } from './api'
import { materialPath, projectOrder, type Order } from './directoryOrder'

export function TransferDialog({ data, order, onCancel, onConfirm }: { data: Directory; order: Order; onCancel: () => void; onConfirm: () => void }) {
  const projected = projectOrder(data, order)
  return <Modal open title="转移课件所属课程？" getContainer={overlayContainer} onCancel={onCancel} onOk={onConfirm} cancelText="取消" okText="确认转移">
    <p>此次移动会改变课件的所属课程，原始页面与笔记一起保留。</p>
    {order.transfers.map(transfer => <div className="transferDetails" key={transfer.material_id}><strong>{data.materials.find(m => m.id === transfer.material_id)?.filename}</strong><p>从：{materialPath(data, data.materials.find(m => m.id === transfer.material_id)!)}</p><p>到：{materialPath(projected, projected.materials.find(m => m.id === transfer.material_id)!)}</p></div>)}
  </Modal>
}
