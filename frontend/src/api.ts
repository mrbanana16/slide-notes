export type Material = { id: string; filename: string; page_count: number }
export type QA = { id: string; question: string; answer: string; position: number; version: number; deleted: boolean }
export type Page = { id: string; number: number; note: string; version: number; summary: string; summary_version: number; qa: QA[] }

export class ApiError extends Error {
  constructor(message: string, public status: number, public current?: Page | QA) { super(message) }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error ?? `请求失败（${response.status}），请重试。`, response.status, body?.current)
  return body as T
}
