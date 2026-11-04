import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DraftStore } from './drafts'
import type { Page } from './api'
const page: Page = { id: 'p', number: 1, note: '', version: 0, summary: '', summary_version: 0, qa: [] }
let stores: DraftStore[]
const create = () => { const store = new DraftStore(); stores.push(store); store.bind(page); return store }
beforeEach(() => { stores = []; vi.useFakeTimers() })
afterEach(() => { stores.forEach(store => store.dispose()); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('debounces for 800ms, serializes edits during a pending request, and continues without a mounted editor', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, version: 2 })))
  vi.stubGlobal('fetch', fetch)
  const store = create(), entry = store.entries['/api/pages/p/note']
  store.edit(entry, { note: 'one' })
  await vi.advanceTimersByTimeAsync(799)
  expect(fetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  store.edit(entry, { note: 'two' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(fetch).toHaveBeenCalledTimes(1)
  finish(new Response(JSON.stringify({ ...page, version: 1 })))
  await vi.advanceTimersByTimeAsync(800)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ note: 'two', version: 1 })
  expect(store.dirtyPages).toBe(0)
})
it('restores draft after reload and pauses when server version has changed', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const first = create(), entry = first.entries['/api/pages/p/note']
  first.edit(entry, { note: 'local' }); first.dispose()
  const second = new DraftStore(); stores.push(second)
  second.bind({ ...page, note: 'remote', version: 3 })
  const restored = second.entries[entry.url]
  expect(restored.value).toEqual({ note: 'local' })
  expect(restored.conflict).toEqual({ value: { note: 'remote' }, version: 3 })
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetch).not.toHaveBeenCalled()
  second.resolve(restored, true)
  expect(restored.version).toBe(3)
  expect(restored.value).toEqual({ note: 'local' })
})
it('restores an unsent new QA with the same stable ID', () => {
  const first = create()
  const entry = first.add('p', 'qa', 'a'.repeat(32), { question: '', answer: '', deleted: false }, 0)
  first.edit(entry, { question: 'question', answer: 'answer', deleted: false }); first.dispose()
  const second = create()
  expect(second.entries[entry.url].value).toEqual(entry.value)
  expect(second.entries[entry.url].id).toBe('a'.repeat(32))
  expect(second.entries[entry.url].recovered).toBe(true)
})
it('retains an orphaned QA draft rather than recreating a deleted server record', async () => {
  const first = create(), entry = first.add('p', 'qa', 'b'.repeat(32), { question: 'q', answer: 'a', deleted: false }, 1)
  first.edit(entry, { ...entry.value, answer: 'draft' }); first.dispose()
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const restored = create().entries[entry.url]
  expect(restored.missing).toBe(true)
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetch).not.toHaveBeenCalled()
})
it('does not recreate cleared drafts when an old save finishes', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const store = create(), entry = store.entries['/api/pages/p/note']
  store.edit(entry, { note: 'old' }); const pending = store.save(entry)
  store.clear(); finish(new Response(JSON.stringify({ ...page, version: 1 }))); await pending
  expect(store.entries).toEqual({}); expect(localStorage.length).toBe(0)
})
it('surfaces local storage failures while retaining the in-memory draft', () => {
  const store = create(), entry = store.entries['/api/pages/p/note']
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  store.edit(entry, { note: 'keep' })
  expect(entry.value.note).toBe('keep'); expect(store.storageError).toContain('本地草稿写入失败')
  spy.mockRestore()
})
it('keeps local drafts from independent tabs separate', () => {
  const first = new DraftStore('tab-one'), second = new DraftStore('tab-two')
  stores.push(first, second); first.bind(page); second.bind(page)
  first.edit(first.entries['/api/pages/p/note'], { note: 'one' })
  second.edit(second.entries['/api/pages/p/note'], { note: 'two' })
  first.dispose(); second.dispose()
  const reloadOne = new DraftStore('tab-one'), reloadTwo = new DraftStore('tab-two')
  stores.push(reloadOne, reloadTwo); reloadOne.bind(page); reloadTwo.bind(page)
  expect(reloadOne.entries['/api/pages/p/note'].value.note).toBe('one')
  expect(reloadTwo.entries['/api/pages/p/note'].value.note).toBe('two')
})
it('saves summary independently from the note version', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...page, summary_version: 1 })))
  vi.stubGlobal('fetch', fetch)
  const store = create(), entry = store.entries['/api/pages/p/summary']
  store.edit(entry, { summary: 'summary' })
  await vi.advanceTimersByTimeAsync(800)
  expect(fetch.mock.calls[0][0]).toBe('/api/pages/p/summary')
  expect(entry.version).toBe(1)
  expect(store.entries['/api/pages/p/note'].version).toBe(0)
})
it('restores current-version drafts and resumes saving after refresh', async () => {
  const first = create(), entry = first.entries['/api/pages/p/note']
  first.edit(entry, { note: 'recover' }); first.dispose()
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...page, version: 1 })))
  vi.stubGlobal('fetch', fetch)
  const restored = create()
  expect(restored.entries[entry.url].recovered).toBe(true)
  await vi.advanceTimersByTimeAsync(800)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(restored.dirtyPages).toBe(0)
  expect(localStorage.length).toBe(0)
})
it('keeps a recovered conflict unresolved through another refresh', async () => {
  const first = create(), entry = first.entries['/api/pages/p/note']
  first.edit(entry, { note: 'mine' }); first.dispose()
  const remote = { ...page, note: 'theirs', version: 5 }
  const second = new DraftStore(); stores.push(second); second.bind(remote); second.dispose()
  const third = new DraftStore(); stores.push(third); third.bind(remote)
  expect(third.entries[entry.url].conflict?.version).toBe(5)
  expect(third.entries[entry.url].version).toBe(0)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps a missing QA draft missing through repeated refreshes', () => {
  const first = create(), entry = first.add('p', 'qa', 'c'.repeat(32), { question: 'q', answer: 'a', deleted: false }, 3)
  first.edit(entry, { ...entry.value, answer: 'draft' }); first.dispose()
  const second = create(); second.dispose()
  const third = create()
  expect(third.entries[entry.url].missing).toBe(true)
  expect(third.entries[entry.url].version).toBe(3)
})
it('removes clean QA entries deleted by another tab when reloading material pages', () => {
  const store = create()
  const qa = { id: 'd'.repeat(32), question: 'q', answer: 'a', position: 1, version: 1, deleted: false }
  store.bind({ ...page, qa: [qa] })
  store.bind(page)
  expect(store.entries['/api/pages/p/qa/' + qa.id]).toBeUndefined()
})
it('keeps a draft when the user reverts to the old text during an in-flight save', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const first = create(), entry = first.entries['/api/pages/p/note']
  first.edit(entry, { note: 'submitted' })
  const pending = first.save(entry)
  first.edit(entry, { note: '' })
  expect(localStorage.length).toBe(1)
  const second = new DraftStore(); stores.push(second)
  second.bind({ ...page, note: 'submitted', version: 1 })
  expect(second.entries[entry.url].value).toEqual({ note: '' })
  expect(second.entries[entry.url].conflict).toBeTruthy()
  first.dispose(); first.clear()
  finish(new Response(JSON.stringify({ ...page, version: 1 }))); await pending
})
it('removes only deleted material pages and ignores their late save without losing other drafts', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  const store = create()
  store.bind({ ...page, id: 'other' })
  const deleted = store.entries['/api/pages/p/note'], kept = store.entries['/api/pages/other/note']
  store.edit(deleted, { note: 'delete' }); store.edit(kept, { note: 'keep' })
  const pending = store.save(deleted)
  store.pause(true); store.removePages(['p']); store.pause(false)
  finish(new Response(JSON.stringify({ ...page, version: 1 }))); await pending
  expect(store.entries[deleted.url]).toBeUndefined()
  expect(kept.value.note).toBe('keep')
  expect(Object.keys(localStorage).every(key => !key.endsWith(deleted.url))).toBe(true)
  expect(store.dirtyPages).toBe(1)
})
it('reports storage removal errors after deletion while retaining unrelated drafts', () => {
  const store = create(), entry = store.entries['/api/pages/p/note']
  store.edit(entry, { note: 'delete' })
  const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable') })
  store.removePages(['p'])
  expect(store.storageError).toContain('本地草稿清理失败')
  expect(store.entries[entry.url]).toBeUndefined()
  spy.mockRestore()
})
