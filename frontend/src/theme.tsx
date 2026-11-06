import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export type DisplayMode = 'system' | 'light' | 'dark'
const preferenceKey = 'slide-notes:display-mode'

export function useMediaPreference(query: string) {
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

function TokenSurface({ children }: { children: ReactNode }) {
  const { token: t } = theme.useToken()
  const variables = {
    '--surface': t.colorBgContainer, '--editor-fill': t.colorFillQuaternary, '--editor-hover': t.colorFillTertiary, '--canvas': t.colorBgLayout, '--ink': t.colorText,
    '--muted': t.colorTextSecondary, '--placeholder': t.colorTextPlaceholder,
    '--line': t.colorBorder, '--soft-line': t.colorBorderSecondary,
    '--accent': t.colorPrimary, '--accent-strong': t.colorPrimaryActive, '--accent-tint': t.colorPrimaryBg,
    '--pdf-mat': t.colorBgLayout === '#1B2028' ? '#151B22' : t.colorFillSecondary, '--positive': t.colorSuccess, '--warning': t.colorWarning,
    '--negative': t.colorError, '--danger-line': t.colorErrorBorder, '--danger-surface': t.colorErrorBg,
    '--danger-hover': t.colorErrorBgHover, '--success-line': t.colorSuccessBorder,
    '--success-surface': t.colorSuccessBg, '--warning-line': t.colorWarningBorder,
    '--warning-surface': t.colorWarningBg, '--drop-surface': t.colorPrimaryBg,
    '--on-accent': t.colorTextLightSolid,
    '--motion-fast': t.motionDurationFast, '--motion-mid': t.motionDurationMid, '--motion-ease': t.motionEaseInOut,
    '--code-keyword': t.colorPrimaryText, '--code-number': t.colorWarningText,
    '--code-title': t.colorInfoText, '--code-type': t.colorSuccessText,
  } as CSSProperties
  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, String(value))
  }, [t])
  return <div className="themeSurface" style={variables}>{children}</div>
}

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
      colorPrimary: dark ? '#8AAEFF' : '#1677ff',
      ...(dark ? { colorBgLayout: '#1B2028', colorBgContainer: '#242B35', colorBgElevated: '#242B35', colorText: '#E2E7EE', colorTextSecondary: '#AFBACB', colorTextPlaceholder: '#A2AEC1', colorBorder: '#445061', colorBorderSecondary: '#35404F', colorSuccess: '#82D4AE', colorWarning: '#E9BC77', colorError: '#FFA6AF' } : {}),
      fontSize: 14,
      borderRadius: 6,
      motionDurationFast: '0.1s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.3s',
      motion: !reducedMotion,
    },
  }}><TokenSurface>{children}</TokenSurface></ConfigProvider>
}
