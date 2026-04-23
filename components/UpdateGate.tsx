'use client'

import { useState } from 'react'
import { useVersionCheck } from '@/lib/useVersionCheck'

/**
 * UpdateBanner — shown at the top of the app when a newer version exists but
 * is not mandatory.  Disappears once the user dismisses it or refreshes.
 */
export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false)
  const info = useVersionCheck()

  if (!info || !info.updateAvailable || info.forceUpdate || dismissed) return null

  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #ff6b35, #f7c59f)',
        color: '#1a1a1a',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 14,
        fontWeight: 500,
        zIndex: 9999,
        width: '100%',
      }}
    >
      <span>🔔 {info.message || 'A new update is available!'}</span>
      <div style={{ display: 'flex', gap: 12 }}>
        {info.updateUrl && (
          <a
            href={info.updateUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#1a1a1a',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 20,
              textDecoration: 'none',
              fontSize: 13,
            }}
          >
            Update
          </a>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 4px',
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}

/**
 * ForceUpdateGate — when a mandatory update is required, renders a full-screen
 * overlay blocking all access to the app until the user updates.
 */
export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const info = useVersionCheck()

  // While version check is loading, or no force update needed, render normally
  if (!info || !info.forceUpdate) return <>{children}</>

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 32,
        zIndex: 99999,
      }}
    >
      <div style={{ fontSize: 64, marginBottom: 24 }}>⬆️</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
        Update Required
      </h1>
      <p style={{ fontSize: 16, color: '#ccc', maxWidth: 360, lineHeight: 1.6, marginBottom: 32 }}>
        {info.message ||
          'A new version of Canteen-Application is required. Please update to continue.'}
      </p>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>
        Current version: {info.clientVersion} → Required: {info.minRequiredVersion}
      </p>
      {info.updateUrl && (
        <a
          href={info.updateUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#ff6b35',
            color: '#fff',
            padding: '14px 32px',
            borderRadius: 30,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          Update Now
        </a>
      )}
    </div>
  )
}
