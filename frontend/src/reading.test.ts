import { expect, it } from 'vitest'
import type { Page } from './api'
import { closestPage, rangePages, visiblePages } from './reading'

const pages = [
  { id: 'a', number: 1, category: '封面', display: 'normal' },
  { id: 'b', number: 2, category: '正文', display: 'collapsed' },
  { id: 'c', number: 3, category: '正文', display: 'hidden' },
] as Page[]
it('separates categories and display settings without renumbering original pages', () => {
  expect(visiblePages(pages, '', false, false, false).map(p => p.number)).toEqual([1, 2])
  expect(visiblePages(pages, '', false, true, false).map(p => p.number)).toEqual([1])
  expect(visiblePages(pages, '正文', true, true, true).map(p => p.number)).toEqual([2, 3])
  expect(visiblePages(pages, '目录', true, false, true)).toEqual([])
  expect(closestPage(pages, 9)?.number).toBe(3)
  expect(closestPage([], 1)).toBeUndefined()
})
it('parses and deduplicates page ranges and rejects malformed or out of bounds input', () => {
  expect(rangePages(pages, '1-2，2,3').map(p => p.id)).toEqual(['a', 'b', 'c'])
  for (const text of ['', '0', '3-2', '1-4', '1.5', '-1', '1,,2', '1-9999999999']) expect(() => rangePages(pages, text)).toThrow()
})
