export type Material = { id: string; filename: string; page_count: number; course_id: string; chapter_id: string | null; position: number }
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

export type Course = { id: string; name: string; position: number; is_system?: boolean }
export type Chapter = { id: string; name: string; position: number; course_id: string }
export type Directory = { revision: number; courses: Course[]; chapters: Chapter[]; materials: Material[] }
