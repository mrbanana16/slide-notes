import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { NoteEditor, type Draft } from './NoteEditor'

const page = { id: 'page-2', number: 2, note: '', version: 0 }
function Editor() {
  const [draft, setDraft] = useState<Draft>({ text: '', saved: '', version: 0 })
  return <NoteEditor page={page} draft={draft} onChange={text => setDraft(old => ({ ...old, text }))} onSaved={(saved, version) => setDraft(old => ({ ...old, saved, version }))} />
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps edits made during a save dirty and uses the updated version on the next save', async () => {
  let resolve!: (value: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done })).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, note: 'newer', version: 2 })))
  vi.stubGlobal('fetch', fetch)
  render(<Editor />)
  const input = screen.getByLabelText('个人笔记')
  fireEvent.change(input, { target: { value: 'first' } })
  fireEvent.click(screen.getByText('保存笔记'))
  fireEvent.change(input, { target: { value: 'newer' } })
  resolve(new Response(JSON.stringify({ ...page, note: 'first', version: 1 })))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('未保存'))
  expect((input as HTMLTextAreaElement).value).toBe('newer')
  fireEvent.click(screen.getByText('保存笔记'))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已保存'))
  expect(fetch.mock.calls[1][0]).toBe('/api/pages/page-2/note')
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ note: 'newer', version: 1 })
})

it('retains input after a network failure and allows retry', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, version: 1 })))
  vi.stubGlobal('fetch', fetch)
  render(<Editor />)
  fireEvent.change(screen.getByLabelText('个人笔记'), { target: { value: '保留我的笔记' } })
  fireEvent.click(screen.getByText('保存笔记'))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('网络断开'))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('保留我的笔记')
  fireEvent.click(screen.getByText('重试保存'))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已保存'))
})

it('shows conflict without overwriting the draft', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '另一窗口已修改此页' }), { status: 409 })))
  render(<Editor />)
  fireEvent.change(screen.getByLabelText('个人笔记'), { target: { value: '我的草稿' } })
  fireEvent.keyDown(screen.getByLabelText('个人笔记'), { key: 's', ctrlKey: true })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('另一窗口'))
  expect((screen.getByLabelText('个人笔记') as HTMLTextAreaElement).value).toBe('我的草稿')
})
