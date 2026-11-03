export type Material = { id: string; filename: string; page_count: number }
export type Page = { id: string; number: number; note: string; version: number }

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `请求失败（${response.status}），请重试。`)
  return body as T
}
