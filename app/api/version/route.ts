import { NextResponse } from 'next/server'

// Bump APP_VERSION in Railway environment variables when you release a new version.
// Set FORCE_UPDATE_BEFORE to block older versions from logging in until they update.
// Example: APP_VERSION="1.2.0", MIN_REQUIRED_VERSION="1.2.0" (forces update)

const APP_VERSION      = process.env.APP_VERSION           || '1.0.0'
const MIN_VERSION      = process.env.MIN_REQUIRED_VERSION  || '1.0.0'
const UPDATE_URL_IOS   = process.env.UPDATE_URL_IOS        || ''
const UPDATE_URL_ANDROID = process.env.UPDATE_URL_ANDROID  || ''

function parseVersion(v: string): number[] {
  return v.split('.').map(Number)
}

function versionLt(a: string, b: string): boolean {
  const av = parseVersion(a)
  const bv = parseVersion(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const ai = av[i] ?? 0
    const bi = bv[i] ?? 0
    if (ai < bi) return true
    if (ai > bi) return false
  }
  return false
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clientVersion = searchParams.get('version') || '0.0.0'
  const platform      = searchParams.get('platform') || 'web'

  const forceUpdate = versionLt(clientVersion, MIN_VERSION)
  const updateAvailable = versionLt(clientVersion, APP_VERSION)

  return NextResponse.json({
    currentVersion: APP_VERSION,
    minRequiredVersion: MIN_VERSION,
    clientVersion,
    forceUpdate,
    updateAvailable,
    updateUrl: platform === 'ios' ? UPDATE_URL_IOS : UPDATE_URL_ANDROID,
    message: forceUpdate
      ? 'A required update is available. Please update the app to continue.'
      : updateAvailable
        ? 'A new version is available. Please update for the best experience.'
        : null,
  })
}
