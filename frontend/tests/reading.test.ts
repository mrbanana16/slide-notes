import { expect, it } from 'vitest'
import type { Page } from '../src/api'
import { closestPage } from '../src/reading'

it('locates original pages without skipping collapsed pages or renumbering', () => {
  const pages = [{ id: 'a', number: 1, display: 'collapsed' }, { id: 'b', number: 2, display: 'normal' }] as Page[]
  expect(closestPage(pages, 1)?.id).toBe('a')
  expect(closestPage(pages, 9)?.number).toBe(2)
  expect(closestPage([], 1)).toBeUndefined()
})
