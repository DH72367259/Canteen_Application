'use client'

import { useEffect, useState } from 'react'

interface VersionInfo {
  forceUpdate: boolean
  updateAvailable: boolean
  currentVersion: string
  message: string | null
  updateUrl?: string
}

// App version stored in package.json — read at build time via env
const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0'

export function useVersionCheck() {
  const [info, setInfo] = useState<VersionInfo | null>(null)

  useEffect(() => {
    const platform = /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? 'ios'
      : /Android/.test(navigator.userAgent)
        ? 'android'
        : 'web'

    fetch(`/api/version?version=${encodeURIComponent(CLIENT_VERSION)}&platform=${platform}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => data && setInfo(data))
      .catch(() => { /* gracefully ignore */ })
  }, [])

  return info
}
