import type { Page } from './api'

export type Mode = 'organize' | 'review' | 'immerse'
export const categories = ['正文', '封面', '目录', '未讲内容', '拓展知识', '其他']
export function visiblePages(pages: Page[], category: string, showHidden: boolean, single: boolean, includeCollapsed: boolean) {
  return pages.filter(page => (!category || (page.category ?? '正文') === category) && (showHidden || page.display !== 'hidden') && (!single || includeCollapsed || page.display !== 'collapsed'))
}
export function closestPage(pages: Page[], number: number) {
  return pages.find(page => page.number >= number) ?? pages.at(-1)
}
export function rangePages(pages: Page[], text: string) {
  const ids = new Set<number>()
  if (!text.trim()) throw new Error('请输入原始页码，例如 1-3,5。')
  for (const part of text.split(/[,，]/)) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('页码范围格式无效，请使用 1-3,5。')
    const from = Number(match[1]), to = Number(match[2] ?? match[1])
    if (from < 1 || to < from || to > pages.length) throw new Error('页码范围超出课件或起止顺序错误。')
    for (let n = from; n <= to; n++) ids.add(n)
  }
  return pages.filter(page => ids.has(page.number))
}
