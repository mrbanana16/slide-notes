import { fireEvent, screen, waitFor } from '@testing-library/react'

export async function chooseOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  const item = await waitFor(() => {
    const popup = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    const found = [...popup?.querySelectorAll<HTMLElement>('.ant-select-item-option') ?? []].find(node => node.textContent === option)
    if (!found) throw new Error(`找不到 ${label} 的选项 ${option}`)
    return found
  })
  fireEvent.click(item)
}

export async function directoryAction(name: string, action: string) {
  fireEvent.click(screen.getByLabelText(`${name}的操作`))
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(action) }))
}

export async function openMaterial(name: string) {
  await screen.findByText(name)
  const item = await waitFor(() => {
    const current = screen.getByLabelText(name)
    if (current.closest('[role="treeitem"]')?.getAttribute('aria-disabled') === 'true') throw new Error('目录仍在加载')
    return current
  })
  fireEvent.click(item.closest('.ant-tree-node-content-wrapper')!)
}
