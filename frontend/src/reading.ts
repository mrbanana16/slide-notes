import type { Page } from './api'

export type Mode = 'organize' | 'review'
export type ReadingLayout = 'continuous' | 'single'
export function closestPage(pages: Page[], number: number) {
  return pages.find(page => page.number >= number) ?? pages.at(-1)
}
