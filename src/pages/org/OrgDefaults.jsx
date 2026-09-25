// Organisation Defaults — the org's single configuration surface.
//
// What lives here (and nothing else):
//   • Identity            — organisation name + logo
//   • Booth behaviour     — idle timeout, in SECONDS
//   • Frames              — EVERY platform frame, rendered with the same
//                           consistent FramePreview used on the platform's
//                           Templates & Frames page: a frame is the canvas
//                           a print is made on, and the org admin sets
//                           each frame's price and whether it is available
//                           at their booths.
//
// There is NO pricing section (no base print price, no download price)
// and no per-event pricing anywhere in the CRM.

import { useEffect, useState } from 'react'
import { api } from '../../api/index.js'
import { useApp } from '../../context/AppContext.jsx'
import { Card, CardHead, Field, TextInput, Button, PageLoader, Toggle, WarnBanner } from '../../components/ui.jsx'
import { Icon } from '../../lib/icons.jsx'
import { FRAME_BY_ID } from '../../lib/frames.js'
import { architectureFor } from '../../lib/templates.js'
import { ROLES } from '../../lib/roles.js'
import FramePreview from '../../components/FramePreview.jsx'

// Representative layout used to preview every frame the same way everywhere
// (portrait 4x6, single photo slot + 15% branding footer).
const PREVIEW_TEMPLATE = architectureFor('portrait', 1)

const TIMEOUT_PRESETS = [
  { label: '10s', value: 10 },
  { label: '1 min', value: 60 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
]

export default function OrgDefaults() {
  const { user, toast } = useApp()
  const readOnly = user.role !== ROLES.ORG_ADMIN
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.org.defaults().then(setD).catch((e) => toast(e.message, 'error'))
  }, [])

  if (!d) return <PageLoader />

  const set = (k, v) => {
    if (readOnly) return
    setD((x) => ({ ...x, [k]: v }))
    setDirty(true)
  }
  const setFrame = (i, k, v) => {
    if (readOnly) return
    setD((x) => {
      const frames = x.frames.map((f, j) => (j === i ? { ...f, [k]: v } : f))
      return { ...x, frames }
    })
    setDirty(true)
  }

  const onLogo = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 300 * 1024) {
      toast('Logo must be under 300 KB.', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoUrl', reader.result)
    reader.readAsDataURL(file)
  }
  const disabledInput = readOnly
    ? { background: 'var(--surface-2)', color: 'var(--muted)' }
    : undefined

  const save = async () => {
    setBusy(true)
    try {
      const saved = await api.org.saveDefaults({
        name: d.name,
        logoUrl: d.logoUrl,
        boothTimeoutSec: Number(d.boothTimeoutSec) || 600,
        frames: d.frames.map((f) => ({ frameId: f.frameId, price: Number(f.price) || 0, allowed: !!f.allowed })),
      })
      setD(saved)
      setDirty(false)
      toast('Organisation defaults saved')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const enabledCount = d.frames.filter((f) => f.allowed).length

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Organisation Defaults</div>
          <div className="page-sub">
            Your organisation's single configuration surface: identity, booth idle timeout, and which frames are
            available at your booths — each with its own price. Events never carry prices.
          </div>
        </div>
        {readOnly ? null : (
          <Button variant="primary" icon="check" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
        )}
      </div>

      {readOnly ? (
        <div style={{ marginBottom: 14 }}>
          <WarnBanner tone="info" icon="info">
            Read-only — frame prices, logo and booth settings can only be changed by your Organisation Admin.
          </WarnBanner>
        </div>
      ) : dirty ? (
        <div style={{ marginBottom: 14 }}>
          <WarnBanner tone="pink" icon="edit">You have unsaved changes.</WarnBanner>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card>
          <CardHead title="Identity" sub="Shown to guests on prints and download pages" />
          <div style={{ padding: '18px 20px' }}>
            <div className="row gap-16 mb-16" style={{ alignItems: 'center' }}>
              {d.logoUrl ? (
                <img src={d.logoUrl} alt="logo" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--line)', background: '#fff' }} />
              ) : (
                <span className="stat-ico" style={{ width: 64, height: 64, borderRadius: 14, background: 'var(--hp-pink-soft)', color: 'var(--hp-pink)', flex: 'none' }}>
                  <Icon name="camera" size={28} />
                </span>
              )}
              <div>
                {!readOnly ? (
                  <Button size="sm" variant="outline" icon="upload" onClick={() => document.getElementById('logo-input')?.click()}>Upload logo</Button>
                ) : null}
                <input id="logo-input" type="file" accept="image/*" hidden onChange={onLogo} />
                {d.logoUrl ? (
                  <div className="t11 faint mt-8">PNG or SVG, square works best. Max 300 KB.</div>
                ) : (
                  <div className="t11 faint mt-8">No logo yet — guests will see your name only.</div>
                )}
              </div>
            </div>
            <Field label="Organisation name" required>
              <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} disabled={readOnly} style={disabledInput} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead title="Booth behaviour" sub="Idle timeout for the kiosk — in seconds" />
          <div style={{ padding: '18px 20px' }}>
            <Field
              label="Booth idle timeout (seconds)"
              hint="How long a booth waits for guest action before returning to the event welcome screen. 10 s to 24 h."
            >
              <div className="row gap-8">
                <TextInput
                  type="number"
                  value={d.boothTimeoutSec}
                  onChange={(e) => set('boothTimeoutSec', e.target.value)}
                  disabled={readOnly}
                  style={{ width: 120, ...disabledInput }}
                />
                <span className="t12 muted">
                  ≈ {Number(d.boothTimeoutSec) >= 60 ? `${Math.floor(Number(d.boothTimeoutSec) / 60)} min ${Number(d.boothTimeoutSec) % 60 ? `${Number(d.boothTimeoutSec) % 60} s` : ''}` : `${d.boothTimeoutSec} s`}
                </span>
              </div>
            </Field>
            {!readOnly ? (
              <div className="row gap-8 mt-8">
                {TIMEOUT_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('boothTimeoutSec', p.value)}
                    style={{
                      padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${Number(d.boothTimeoutSec) === p.value ? 'var(--hp-pink)' : 'var(--line)'}`,
                      background: Number(d.boothTimeoutSec) === p.value ? 'rgba(234,9,127,0.07)' : 'var(--surface)',
                      color: Number(d.boothTimeoutSec) === p.value ? 'var(--hp-pink-deep)' : 'var(--ink-2)',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="mt-14" style={{ marginTop: 14 }}>
        <CardHead
          title={`Frames · ${enabledCount}/${d.frames.length} available at your booths`}
          sub="Every platform frame, rendered exactly as it will print. Set each frame's price and whether it's available on your booths — this is where print pricing lives, never on events."
        />
        <div className="table-wrap">
          <table className="hp-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Frame</th>
                <th>Frame</th>
                <th style={{ width: 170 }}>Price per print</th>
                <th className="t-right" style={{ width: 150 }}>Available on booth</th>
              </tr>
            </thead>
            <tbody>
              {d.frames.map((f, i) => {
                const meta = FRAME_BY_ID[f.frameId]
                return (
                  <tr key={f.frameId} style={f.allowed ? undefined : { opacity: 0.62 }}>
                    <td style={{ width: 90 }}>
                      <FramePreview frame={meta} template={PREVIEW_TEMPLATE} width={58} branding={{ tagline: d.name }} />
                    </td>
                    <td>
                      <div className="fw6 t13">{meta?.name || f.frameId}</div>
                      <div className="t11 muted mt-8" style={{ maxWidth: 340 }}>{meta?.description}</div>
                    </td>
                    <td>
                      <div className="row gap-8">
                        <span className="t13 muted">₹</span>
                        <TextInput
                          type="number"
                          value={f.price}
                          onChange={(e) => setFrame(i, 'price', Math.max(0, Number(e.target.value) || 0))}
                          disabled={readOnly}
                          style={{ width: 90, height: 32, fontSize: 13, ...disabledInput }}
                        />
                      </div>
                    </td>
                    <td className="t-right">
                      <Toggle on={f.allowed} onChange={(v) => setFrame(i, 'allowed', v)} disabled={readOnly} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <p className="t11 faint">
            <Icon name="shield" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            A frame is the canvas a print is made on — photos plus the 15% branding footer are all printed on it.
            The catalogue itself is a platform asset (the Owner adds/removes frames); here you only set prices and
            booth availability. Organisation Managers cannot change any of this.
          </p>
        </div>
      </Card>
    </div>
  )
}
