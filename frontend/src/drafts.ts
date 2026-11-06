import { api, ApiError, type Page, type QA } from './api'

export type Content = { note?: string; summary?: string; question?: string; answer?: string; deleted?: boolean }
export type Entry = {
  url: string; pageId: string; kind: 'note' | 'summary' | 'qa'; id: string
  value: Content; saved: Content; version: number; pending: boolean; error: string
  conflict?: { value: Content; version: number }; recovered?: boolean; missing?: boolean; uncertain?: boolean; edited?: boolean
}
const prefix = 'slide-notes:draft:v2:'
const equal = (a: Content, b: Content) => JSON.stringify(a) === JSON.stringify(b)
export type SaveRecord = { pageId: string; kind: Entry['kind']; time: number; result: '成功' | '失败' | '冲突'; automatic: boolean }
export class DraftStore {
  namespace: string
  identityError = ''
  constructor(owner?: string) {
    try {
      const token = owner ?? sessionStorage.getItem('slide-notes:draft-owner') ?? crypto.randomUUID()
      if (!owner) sessionStorage.setItem('slide-notes:draft-owner', token)
      this.namespace = prefix + token + ':'
    } catch {
      this.namespace = prefix + crypto.randomUUID() + ':'
      this.identityError = '无法保存标签页草稿标识，刷新后的恢复可能不可用，请先保存或复制内容。'
      this.storageError = this.identityError
    }
  }
  history: SaveRecord[] = []
  locations = new Map<string, { materialId: string; number: number }>()
  entries: Record<string, Entry> = {}
  listeners = new Set<() => void>()
  timers = new Map<string, ReturnType<typeof setTimeout>>()
  storageError = ''
  paused = false
  stored = new Map<string, string>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  emit() { this.listeners.forEach(listener => listener()) }
  dirty(entry: Entry) { return entry.pending || !!entry.conflict || !!entry.uncertain || !equal(entry.value, entry.saved) || (entry.kind === 'qa' && entry.version === 0) }
  get dirtyPages() { return new Set(Object.values(this.entries).filter(entry => this.dirty(entry) || entry.pending).map(entry => entry.pageId)).size }
  persist(entry: Entry) {
    try {
      const key = this.namespace + entry.url
      if (this.dirty(entry)) {
        const raw = JSON.stringify({ value: entry.value, saved: entry.saved, version: entry.version, kind: entry.kind, id: entry.id, pageId: entry.pageId })
        localStorage.setItem(key, raw)
        this.stored.set(key, raw)
      }
      else {
        const stored = localStorage.getItem(key)
        if (stored && stored === this.stored.get(key)) localStorage.removeItem(key)
      }
      this.storageError = this.identityError
    } catch { this.storageError = '本地草稿写入失败（空间不足或存储不可用），请保持页面打开并保存或复制内容。' }
  }
  bind(page: Page, materialId?: string) {
    if (materialId) this.locations.set(page.id, { materialId, number: page.number })
    const ids = new Set((page.qa ?? []).map(qa => qa.id))
    for (const entry of Object.values(this.entries)) {
      if (entry.pageId === page.id && entry.kind === 'qa' && !ids.has(entry.id) && !entry.pending && !this.dirty(entry)) delete this.entries[entry.url]
    }
    this.add(page.id, 'note', page.id, { note: page.note }, page.version)
    this.add(page.id, 'summary', page.id, { summary: page.summary ?? '' }, page.summary_version ?? 0)
    for (const qa of page.qa ?? []) this.add(page.id, 'qa', qa.id, this.qaContent(qa), qa.version)
    try {
      for (const key of Object.keys(localStorage).filter(key => key.startsWith(this.namespace))) {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (saved?.pageId === page.id && saved.kind === 'qa' && !this.entries[key.slice(this.namespace.length)]) {
          this.add(page.id, 'qa', saved.id, { question: '', answer: '', deleted: false }, 0, saved.version > 0)
        }
      }
    } catch { this.storageError = '无法读取部分本地草稿，请检查浏览器存储。' }
  }
  qaContent(qa: QA): Content { return { question: qa.question, answer: qa.answer, deleted: qa.deleted ?? false } }
  add(pageId: string, kind: Entry['kind'], id: string, value: Content, version: number, missing = false) {
    const url = `/api/pages/${pageId}/${kind === 'qa' ? 'qa/' + id : kind}`
    const existing = this.entries[url]
    if (existing && (this.dirty(existing) || existing.pending)) return existing
    const entry: Entry = { url, pageId, kind, id, value, saved: value, version, pending: false, error: '', edited: existing?.edited }
    try {
      const stored = JSON.parse(localStorage.getItem(this.namespace + url) ?? 'null')
      if (stored && stored.value && typeof stored.version === 'number') {
        if (!equal(stored.value, value) || (kind === 'qa' && version === 0)) {
          entry.value = stored.value
          entry.version = stored.version
          entry.recovered = true
          if (missing) { entry.missing = true; entry.error = '服务器中已无此问答。草稿保留，可复制内容后丢弃。' }
          else if (stored.version !== version) entry.conflict = { value, version }
        } else localStorage.removeItem(this.namespace + url)
      }
    } catch { this.storageError = '无法读取本地草稿，请检查浏览器存储。' }
    this.entries[url] = entry
    if (this.dirty(entry)) { this.persist(entry); this.schedule(entry) }
    return entry
  }
  edit(entry: Entry, value: Content) {
    entry.edited = true
    entry.value = value
    entry.error = ''
    this.persist(entry)
    this.schedule(entry)
    this.emit()
  }
  schedule(entry: Entry) {
    clearTimeout(this.timers.get(entry.url))
    if (!this.paused && !entry.error && !entry.conflict && !entry.missing && this.dirty(entry)) this.timers.set(entry.url, setTimeout(() => void this.save(entry, true), 800))
  }
  async save(entry: Entry, automatic = false) {
    clearTimeout(this.timers.get(entry.url))
    if (this.paused || this.entries[entry.url] !== entry || entry.pending || entry.conflict || entry.missing || !this.dirty(entry)) return
    entry.pending = true; entry.error = ''; this.emit()
    const value = { ...entry.value }
    try {
      const result = await api<Page & QA>(entry.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, version: entry.version }) })
      if (this.entries[entry.url] !== entry) return
      entry.uncertain = false
      entry.saved = value
      entry.version = entry.kind === 'summary' ? result.summary_version : result.version
      entry.recovered = false
      this.persist(entry)
    } catch (cause) {
      if (this.entries[entry.url] !== entry) return
      entry.uncertain = true
      entry.error = cause instanceof Error ? cause.message : '保存失败，请重试。'
      if (cause instanceof ApiError && cause.status === 409 && cause.current) {
        const current = cause.current
        entry.conflict = { value: entry.kind === 'qa' ? this.qaContent(current as QA) : entry.kind === 'note' ? { note: (current as Page).note } : { summary: (current as Page).summary }, version: entry.kind === 'summary' ? (current as Page).summary_version : current.version }
      }
      if (cause instanceof ApiError && cause.status === 404) entry.missing = true
    } finally {
      entry.pending = false
      if (this.entries[entry.url] === entry) {
        this.history.unshift({ pageId: entry.pageId, kind: entry.kind, time: Date.now(), automatic, result: entry.conflict ? '冲突' : entry.error ? '失败' : '成功' })
        this.history.length = Math.min(5, this.history.length)
        window.dispatchEvent(new CustomEvent('slide-notes:save-result', { detail: { automatic, result: entry.conflict ? '冲突' : entry.error ? '失败' : '成功', error: entry.error } }))
        this.persist(entry); this.schedule(entry); this.emit()
      }
    }
  }
  resolve(entry: Entry, useLocal: boolean) {
    if (!entry.conflict) return
    const current = entry.conflict
    entry.saved = current.value; entry.version = current.version
    if (!useLocal || current.value.deleted) entry.value = current.value
    entry.conflict = undefined; entry.error = ''; entry.recovered = false; entry.uncertain = false
    this.persist(entry); this.schedule(entry); this.emit()
  }
  discard(entry: Entry) {
    clearTimeout(this.timers.get(entry.url))
    try { localStorage.removeItem(this.namespace + entry.url) } catch { this.storageError = '本地草稿无法移除。' }
    if (entry.kind === 'qa') delete this.entries[entry.url]
    else { entry.value = entry.saved; entry.uncertain = false; entry.error = '页面不存在，请刷新目录。' }
    this.emit()
  }
  removePages(pageIds: string[]) {
    this.history = this.history.filter(record => !pageIds.includes(record.pageId))
    for (const id of pageIds) this.locations.delete(id)
    for (const [url, entry] of Object.entries(this.entries)) {
      if (!pageIds.includes(entry.pageId)) continue
      clearTimeout(this.timers.get(url)); this.timers.delete(url)
      delete this.entries[url]
    }
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue
        let pageId: string | undefined
        try { pageId = JSON.parse(localStorage.getItem(key) ?? 'null')?.pageId } catch { continue }
        if (pageId && pageIds.includes(pageId)) localStorage.removeItem(key)
      }
    } catch { this.storageError = '课件已删除，但本地草稿清理失败，请清理此站点存储。' }
    this.emit()
  }
  pause(value: boolean) { this.paused = value; for (const entry of Object.values(this.entries)) this.schedule(entry) }
  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear(); this.entries = {}; this.history = []; this.locations.clear()
    try { for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key) } catch { this.storageError = '数据已清空，但浏览器草稿清理失败，请清理此站点存储。' }
    this.emit()
  }
  dispose() { for (const timer of this.timers.values()) clearTimeout(timer); this.listeners.clear() }
}
