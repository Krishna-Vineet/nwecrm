import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { api } from '../api/index.js'
import { BrandMark, Wordmark } from '../components/Logo.jsx'
import { Icon } from '../lib/icons.jsx'
import { Field, TextInput, Button, Spinner } from '../components/ui.jsx'
import { ROLES, ROLE_LABELS } from '../lib/roles.js'

const DEMO_ACCOUNTS = [
  { role: ROLES.OWNER, email: 'owner@happypix.com', name: 'Harshit Mehta', icon: 'zap' },
  { role: ROLES.PLATFORM_ADMIN, email: 'priya@happypix.com', name: 'Priya Nair', icon: 'shield' },
  { role: ROLES.SUPPORT_MANAGER, email: 'support@happypix.com', name: 'Arjun Rao', icon: 'headset' },
  { role: ROLES.ORG_ADMIN, email: 'sana@sunsetweddings.com', name: 'Sana Kapoor · Sunset Weddings', icon: 'building' },
  { role: ROLES.ORG_MANAGER, email: 'rohit@sunsetweddings.com', name: 'Rohit Das · Sunset Weddings', icon: 'calendar' },
]

export default function Login() {
  const { login, useMock } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const doLogin = async (em, pw) => {
    setBusy(true)
    setError('')
    try {
      const u = await login(em, pw)
      location.hash = ''
      location.hash = u.role.startsWith('ORG') ? '#/org/dashboard' : '#/platform/dashboard'
    } catch (e) {
      setError(e.message || 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    doLogin(email, password)
  }

  return (
    <div className="login-wrap">
      <div className="login-brand">
        <div className="row gap-12" style={{ position: 'relative', zIndex: 2 }}>
          <BrandMark size={44} onDark />
          <Wordmark size={21} onDark sub="Photobooth operating system" />
        </div>
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 480 }}>
          <h1 style={{ fontSize: 40, lineHeight: 1.12, fontWeight: 760, letterSpacing: '-0.03em' }}>
            Run your entire<br />
            photobooth empire<br />
            <span style={{ color: '#EA097F' }}>from one place.</span>
          </h1>
          <p style={{ marginTop: 18, fontSize: 15, color: 'rgba(255,255,255,0.66)', lineHeight: 1.65 }}>
            Events, booths, prints, payments, coupons and guest support —
            one role-aware workspace for the platform and every client.
          </p>
          <div className="row wrap gap-12" style={{ marginTop: 28 }}>
            {[
              ['monitor', 'Booth devices pair by UUID'],
              ['revenue', 'Live revenue per event & booth'],
              ['tag', 'Organisation-owned coupons'],
              ['headset', 'Guest support inbox'],
            ].map(([ic, t]) => (
              <span key={t} className="chip" style={{ background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.85)', height: 28, fontSize: 12, backdropFilter: 'blur(6px)' }}>
                <Icon name={ic} size={13} /> {t}
              </span>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 2, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          © 2026 HappyPix CRM · v2
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 22, fontWeight: 740, letterSpacing: '-0.02em' }}>Sign in to CRM</h2>
            <p className="t13 muted" style={{ marginTop: 5 }}>Use the email and password from your HappyPix account.</p>
          </div>
          <form onSubmit={submit}>
            <Field label="Email address" required>
              <TextInput type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Password" required error={error || undefined}>
              <TextInput type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--hp-pink-deep)' }}>Forgot password?</button>
            </div>
            <Button type="submit" variant="primary" size="lg" style={{ width: '100%' }} disabled={busy}>
              {busy ? <Spinner small /> : <Icon name="arrow-up-right" size={16} />}
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          {useMock && (
            <div className="mt-24">
              <div className="row between" style={{ marginBottom: 10 }}>
                <span className="t11" style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                  Demo — quick sign in
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.role} className="demo-chip" disabled={busy} onClick={() => doLogin(a.email, 'demo123')}>
                    <span className="role-ico" style={{ background: 'var(--hp-pink-soft)', color: 'var(--hp-pink)' }}>
                      <Icon name={a.icon} size={15} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 640 }} className="ellipsis">{a.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>{a.email}</span>
                    </span>
                    <span className="chip chip-neutral role-tag" style={{ height: 19, fontSize: 10.5 }}>{ROLE_LABELS[a.role]}</span>
                  </button>
                ))}
              </div>
              <p className="t11 faint" style={{ marginTop: 14, lineHeight: 1.5 }}>
                Demo mode runs an in-app API with seeded data (password <span className="kbd">demo123</span>).
                Point <span className="kbd">VITE_API_URL</span> at the real backend to go live.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
