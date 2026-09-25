// API client — talks to either the in-app mock backend or the real
// HappyPix backend (v2 contract). Switch with VITE_API_URL.
//
//   Mock (default, this workspace):   no env var -> in-memory demo server
//   Real backend:                     VITE_API_URL=https://api.happypix.example

import { handle } from './mock/server.js'
import { resetDb } from './mock/db.js'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const USE_MOCK = !API_URL

const TOKEN_KEY = 'hp_v2_token'
const USER_KEY = 'hp_v2_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export class ApiRequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function realRequest(method, path, body) {
  const token = getToken()
  const res = await fetch(`${API_URL}/api/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`
    if (res.status === 401) {
      clearSession()
    }
    throw new ApiRequestError(res.status, msg)
  }
  return data
}

function mockRequest(method, path, body) {
  // small artificial latency so loading states are visible
  const token = getToken()
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const out = handle(method, path, body, token)
        resolve(out.data)
      } catch (e) {
        if (e && e.status === 401) clearSession()
        reject(new ApiRequestError(e.status || 500, e.message))
      }
    }, 120 + Math.random() * 180)
  })
}

export async function request(method, path, body) {
  return USE_MOCK ? mockRequest(method, path, body) : realRequest(method, path, body)
}

export function demoReset() {
  if (!USE_MOCK) return
  resetDb() // clears in-memory copy + localStorage, reseeds
  location.reload()
}
