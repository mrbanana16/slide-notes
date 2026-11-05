import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export type DisplayMode = 'system' | 'light' | 'dark'
const preferenceKey = 'slide-notes:display-mode'

function useMediaPreference(query: string) {
  const [media] = useState(() => window.matchMedia?.(query))
  const [matches, setMatches] = useState(media?.matches ?? false)
  useEffect(() => {
    if (!media) return
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [media])
  return matches
}

export function useDisplayMode() {
  const [mode, setMode] = useState<DisplayMode>(() => {
    try {
      const saved = localStorage.getItem(preferenceKey)
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* Storage can be unavailable in private sessions. */ }
    return 'system'
  })
  function selectMode(value: DisplayMode) {
    setMode(value)
    try { localStorage.setItem(preferenceKey, value) } catch { /* Keep the choice for this session. */ }
  }
  return { mode, selectMode }
}

export const overlayContainer = () => document.getElementById('app-overlays') ?? document.body

export function WorkspaceTheme({ mode, children }: { mode: DisplayMode; children: ReactNode }) {
  const systemDark = useMediaPreference('(prefers-color-scheme: dark)')
  const reducedMotion = useMediaPreference('(prefers-reduced-motion: reduce)')
  const requestedDark = mode === 'dark' || (mode === 'system' && systemDark)
  const [dark, setDark] = useState(requestedDark)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  useLayoutEffect(() => {
    const root = document.documentElement
    if (root.dataset.theme === (requestedDark ? 'dark' : 'light')) return
    if (reducedMotion || !document.startViewTransition) {
      setDark(requestedDark)
      return
    }

    let current = true
    root.dataset.themeSwitch = ''
    const transition = document.startViewTransition(() => {
      if (current) flushSync(() => setDark(requestedDark))
    })
    void transition.finished.finally(() => {
      if (current) delete root.dataset.themeSwitch
    })
    return () => {
      current = false
      transition.skipTransition()
      delete root.dataset.themeSwitch
    }
  }, [requestedDark, reducedMotion])
  return <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} getPopupContainer={overlayContainer} theme={{
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#8AAEFF' : '#365FC7',
      colorBgElevated: dark ? '#242B35' : '#FFFFFF',
      colorText: dark ? '#E2E7EE' : '#202733',
      motion: !reducedMotion,
    },
  }}>{children}</ConfigProvider>
}
