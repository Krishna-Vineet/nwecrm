// Templates & Frames — platform screen (Owner + Platform Admin).
//
// Template creation is exactly the original HappyPix CRM flow:
//   Create Template modal → Direct Upload | AI Generate
//   → Design Scope: Universal Background (fits any layout) | Specific Layout
//   → Specific: Frames (Photo Slots) 1/2/3/4/6 + Orientation (portrait/landscape/strip/square)
//   → Manual: name + background image upload
//   → AI: prompt → generate → preview → "Save to Templates" or "Modify / Regenerate"
//   → Cards: status chip, "N Slots · orientation", Edit Name (prompt), Delete (confirm)
//
// Photo slot coordinates always come from the Architecture V1 engine
// (src/lib/templates.js — bottom 15% of the canvas reserved for branding).
//
// Below the templates sits the FRAME catalogue: a frame is the canvas a
// print is made on (background design on which the photo slots sit; the
// complete output print is on the frame). Organisations price each frame
// and decide booth availability in Organisation Defaults. The Owner can
// add and remove frames from the catalogue; other platform roles read only.

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/index.js'
import { useApp } from '../../context/AppContext.jsx'
import {
  Card, PageLoader, Button, Modal, Field, TextInput, TextArea, Select, ConfirmDialog,
} from '../../components/ui.jsx'
import { Icon } from '../../lib/icons.jsx'
import { ROLES } from '../../lib/roles.js'
import { ORIENTATIONS, SLOT_COUNTS, templateSlotsLabel, architectureFor } from '../../lib/templates.js'
import { BACKGROUND_TYPES, FRAME_PATTERNS } from '../../lib/frames.js'
import FramePreview from '../../components/FramePreview.jsx'

const CATEGORIES = ['Weddings', 'Celebrations', 'Parties', 'Corporate', 'Classic', 'Kids', 'Custom']
// Neutral canvas used to preview specific-layout templates.
const PREVIEW_FRAME = { name: 'Canvas', background: { type: 'solid', colors: ['#FFFFFF'], pattern: 'none' }, text: '#3A3344' }
const PREVIEW_TEMPLATE = architectureFor('portrait', 1)

const ORIENTATION_LABELS = {
  portrait: 'Portrait',
  landscape: 'Landscape',
  strip: 'Photo Strip',
  square: 'Square',
  universal: 'Universal',
}

export default function Templates() {
  const { user, toast } = useApp()
  const isOwner = user?.role === ROLES.OWNER

  const [templates, setTemplates] = useState(null)
  const [frames, setFrames] = useState([])
  const [modal, setModal] = useState(null) // 'create' | 'frame'
  const [deleting, setDeleting] = useState(null) // { kind: 'template'|'frame', item }
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.platform.templates().then((r) => setTemplates(r.templates)).catch((e) => toast(e.message, 'error'))
    api.platform.frames().then((r) => setFrames(r.frames)).catch((e) => toast(e.message, 'error'))
  }
  useEffect(() => { load() }, [])

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      if (deleting.kind === 'template') {
        await api.platform.deleteTemplate(deleting.item.id)
        toast(`Template “${deleting.item.name}” deleted`)
      } else {
        await api.platform.deleteFrame(deleting.item.id)
        toast(`Frame “${deleting.item.name}” removed from the catalogue`)
      }
      setDeleting(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleTemplate = async (t, active) => {
    try {
      await api.platform.updateTemplate(t.id, { active })
      toast(active ? 'Template enabled' : 'Template disabled', 'info')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  if (!templates) return <PageLoader />

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Templates &amp; Frames</div>
          <div className="page-sub">
            Platform print templates and the frame catalogue. Organisations select templates and photo filters when
            creating events; they set frame prices and booth availability in their Organisation Defaults.
          </div>
        </div>
        <div className="row gap-8">
          {isOwner ? (
            <Button variant="outline" icon="plus" onClick={() => setModal('frame')}>New frame</Button>
          ) : null}
          <Button variant="primary" icon="plus" onClick={() => setModal('create')}>New template</Button>
        </div>
      </div>

      <SectionTitle title={`Templates · ${templates.length}`} sub="Universal backgrounds fit any layout; specific templates carry fixed photo slots (bottom 15% of the canvas is always reserved for the branding footer)." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 14 }}>
        {templates.map((t) => (
          <TemplateCard key={t.id} tpl={t} onToggle={(v) => toggleTemplate(t, v)} onDelete={() => setDeleting({ kind: 'template', item: t })} onRename={load} onToast={toast} />
        ))}
      </div>

      <div className="mt-24" />
      <SectionTitle
        title={`Frames · ${frames.length}`}
        sub="A frame is the canvas a print is made on — its background design carries the template's photo slots and the branding footer. The complete output print is on the frame. Organisations price each frame per event type and switch booth availability on/off in Organisation Defaults."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 14 }}>
        {frames.map((f) => (
          <FrameCard key={f.id} frame={f} isOwner={isOwner} onDelete={() => setDeleting({ kind: 'frame', item: f })} />
        ))}
      </div>

      <Modal open={modal === 'create'} onClose={() => setModal(null)} title="Create Template" width="wide"
        sub="Design scope, layout and source — the background is a direct upload or AI generated.">
        <CreateTemplateModal
          onDone={() => { setModal(null); load() }}
          onCancel={() => setModal(null)}
        />
      </Modal>

      <Modal open={modal === 'frame'} onClose={() => setModal(null)} title="New frame" width="wide"
        sub="Frames are the print canvas — organisations set their prices and booth availability.">
        <CreateFrameModal
          onDone={() => { setModal(null); load() }}
          onCancel={() => setModal(null)}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={deleting?.kind === 'frame' ? `Remove frame “${deleting?.item?.name}”?` : `Delete “${deleting?.item?.name}”?`}
        message={deleting?.kind === 'frame'
          ? 'Frames enabled at any organisation cannot be removed — disable them in that organisation’s defaults first. This action is audit logged.'
          : 'Templates assigned to events cannot be deleted — disable them instead. This action is audit logged.'}
        confirmLabel={deleting?.kind === 'frame' ? 'Remove frame' : 'Delete template'}
        danger
        loading={busy}
      />
    </div>
  )
}

// ---------------- Sections ----------------

function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="t11" style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>{title}</div>
      <div className="t12 muted mt-8">{sub}</div>
    </div>
  )
}

function TemplateCard({ tpl, onToggle, onDelete, onRename, onToast }) {
  const editName = () => {
    const next = window.prompt('Enter new name for template:', tpl.name)
    if (next && next.trim() && next.trim() !== tpl.name) {
      api.platform.updateTemplate(tpl.id, { name: next.trim() })
        .then(() => { onToast(`Template renamed to “${next.trim()}”`); onRename() })
        .catch((e) => onToast(e.message, 'error'))
    }
  }
  const specific = tpl.imageScope !== 'general'
  const previewTpl = specific ? tpl : { ...tpl, photoSlots: [] }
  return (
    <Card style={{ opacity: tpl.active ? 1 : 0.72 }}>
      <div style={{ padding: 14 }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          <FramePreview template={previewTpl} frame={PREVIEW_FRAME} width={specific ? 118 : 132} branding={{ tagline: 'HappyPix' }} />
          <span
            className="chip"
            style={{
              position: 'absolute', top: 6, left: 6, textTransform: 'uppercase',
              background: tpl.status === 'published' ? 'rgba(133,197,54,0.14)' : 'rgba(234,179,8,0.16)',
              color: tpl.status === 'published' ? 'var(--success)' : '#B45309',
            }}
          >
            {tpl.status}
          </span>
          {tpl.source === 'ai_generated' ? (
            <span className="chip" style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(234,9,127,0.12)', color: 'var(--hp-pink)' }}>
              <Icon name="sparkles" size={11} /> AI
            </span>
          ) : null}
          {!tpl.active ? (
            <span className="chip chip-neutral" style={{ position: 'absolute', bottom: 6, left: 6 }}>Disabled</span>
          ) : null}
        </div>
        <div className="t13 fw7 ellipsis mt-12">{tpl.name}</div>
        <div className="t11 muted mt-8">{tpl.category} · {specific ? `${templateSlotsLabel(tpl)} · ${ORIENTATION_LABELS[tpl.orientation]}` : 'Universal Background'}</div>
        <div className="t11 faint">Used by {tpl.usage || 0} event(s)</div>
        <div className="row gap-6 mt-12" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <Button size="sm" variant="ghost" icon="edit" onClick={editName} title="Edit name" style={{ flex: 1 }}>Edit Name</Button>
          <Button size="sm" variant="ghost" onClick={() => onToggle(!tpl.active)} title={tpl.active ? 'Disable template' : 'Enable template'}>
            {tpl.active ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={onDelete} title="Delete" style={{ color: 'var(--danger)' }} />
        </div>
      </div>
    </Card>
  )
}

function FrameCard({ frame, isOwner, onDelete }) {
  return (
    <Card>
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          <FramePreview frame={frame} template={PREVIEW_TEMPLATE} width={128} branding={{ tagline: 'Your tagline here' }} />
        </div>
        <div className="t13 fw7 ellipsis mt-12">{frame.name}</div>
        <div className="t11 muted mt-8" style={{ minHeight: 30 }}>{frame.description}</div>
        <div className="row between mt-8">
          <span className="t11 num">Suggested ₹{frame.defaultPrice}</span>
          <span className="t11 faint">Enabled at {frame.enabledOrgs || 0} org(s)</span>
        </div>
        {isOwner ? (
          <div className="mt-12" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <Button size="sm" variant="ghost" icon="trash" onClick={onDelete} title="Remove from catalogue" style={{ width: '100%', color: 'var(--danger)' }}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

// ---------------- Create Template (original flow) ----------------

function CreateTemplateModal({ onDone, onCancel }) {
  const { toast } = useApp()
  const [mode, setMode] = useState('manual') // 'manual' or 'ai'
  const [generatedPreview, setGeneratedPreview] = useState(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'Custom',
    imageScope: 'specific', // 'general' or 'specific'
    frames: 1,
    orientation: 'portrait',
    prompt: '',
    file: null,
    filePreview: null,
  })
  const [saving, setSaving] = useState(false)
  const [aiError, setAiError] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setForm((f) => ({ ...f, file, filePreview: URL.createObjectURL(file) }))
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setAiError('')
    try {
      if (mode === 'manual') {
        if (!form.file) {
          toast('Please upload a template background/frame image', 'error')
          setSaving(false)
          return
        }
        if (!form.name.trim()) {
          toast('Please enter a template name', 'error')
          setSaving(false)
          return
        }
        const backgroundUrl = await new Promise((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result)
          r.onerror = reject
          r.readAsDataURL(form.file)
        })
        await api.platform.createTemplate({
          name: form.name,
          description: form.description,
          category: form.category,
          imageScope: form.imageScope,
          orientation: form.imageScope === 'specific' ? form.orientation : 'universal',
          slotCount: form.imageScope === 'specific' ? Number(form.frames) : 0,
          backgroundUrl,
          source: 'manual',
        })
        toast(`Template “${form.name}” created`)
        onDone()
      } else {
        // AI Mode
        if (!form.prompt) {
          toast('Please enter a prompt for the AI', 'error')
          setSaving(false)
          return
        }
        const res = await api.platform.generateTemplateAI({
          prompt: form.prompt,
          imageScope: form.imageScope,
          orientation: form.imageScope === 'specific' ? form.orientation : 'universal',
          slotCount: form.imageScope === 'specific' ? Number(form.frames) : 0,
          category: form.category,
        })
        setGeneratedPreview(res.draft)
        // We do NOT persist yet — the user must approve the preview.
      }
    } catch (err) {
      if (mode === 'ai') setAiError(err.message)
      else toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSavePreview = async () => {
    try {
      setSaving(true)
      await api.platform.createTemplate({ ...generatedPreview, status: 'published', category: generatedPreview.category || 'Custom' })
      toast(`Template “${generatedPreview.name}” saved`)
      onDone()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRegenerate = () => setGeneratedPreview(null)

  return (
    <div>
      {generatedPreview ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="t13 fw7">AI Generated Preview</div>
          <div style={{ background: '#14101E', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'center' }}>
            <FramePreview template={generatedPreview} branding={{ tagline: 'Your tagline here' }} width={200} />
          </div>
          <div className="row gap-12" style={{ marginTop: 4 }}>
            <Button variant="outline" onClick={handleRegenerate} disabled={saving} style={{ flex: 1 }}>Modify / Regenerate</Button>
            <Button variant="primary" icon="sparkles" onClick={handleSavePreview} disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving…' : 'Save to Templates'}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCreate}>
          <div className="row gap-12" style={{ marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => setMode('manual')}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: mode === 'manual' ? 'rgba(234,9,127,0.08)' : 'var(--surface-2)',
                border: `1px solid ${mode === 'manual' ? 'var(--hp-pink)' : 'var(--line)'}`,
                color: mode === 'manual' ? 'var(--hp-pink)' : 'var(--ink-soft)',
              }}
            >
              <Icon name="upload" size={15} /> Direct Upload
            </button>
            <button
              type="button"
              onClick={() => setMode('ai')}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: mode === 'ai' ? 'rgba(234,9,127,0.08)' : 'var(--surface-2)',
                border: `1px solid ${mode === 'ai' ? 'var(--hp-pink)' : 'var(--line)'}`,
                color: mode === 'ai' ? 'var(--hp-pink)' : 'var(--ink-soft)',
              }}
            >
              <Icon name="sparkles" size={15} /> AI Generate
            </button>
          </div>

          <div className="field">
            <div className="row gap-16" style={{ alignItems: 'center' }}>
              <label className="label" style={{ margin: 0 }}>Design Scope:</label>
              <label className="t13" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="imageScope" checked={form.imageScope === 'general'} onChange={() => set('imageScope', 'general')} />
                Universal Background (Fits any layout)
              </label>
              <label className="t13" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="imageScope" checked={form.imageScope === 'specific'} onChange={() => set('imageScope', 'specific')} />
                Specific Layout
              </label>
            </div>
          </div>

          <div className="row gap-12" style={{ opacity: form.imageScope === 'general' ? 0.4 : 1, pointerEvents: form.imageScope === 'general' ? 'none' : 'auto' }}>
            {mode === 'manual' ? (
              <div style={{ flex: 1 }}>
                <Field label="Frames (Photo Slots)">
                  <Select value={form.frames} onChange={(e) => set('frames', e.target.value)}>
                    {SLOT_COUNTS.map((n) => <option key={n} value={n}>{n} Slot{n > 1 ? 's' : ''}</option>)}
                  </Select>
                </Field>
              </div>
            ) : null}
            <div style={{ flex: 1 }}>
              <Field label="Orientation">
                <Select value={form.orientation} onChange={(e) => set('orientation', e.target.value)}>
                  {ORIENTATIONS.map((o) => <option key={o} value={o}>{ORIENTATION_LABELS[o]}</option>)}
                </Select>
              </Field>
            </div>
          </div>

          {mode === 'manual' ? (
            <>
              <Field label="Template Name" required>
                <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Template Name" />
              </Field>
              <Field label="Description">
                <TextInput value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional — what this template is for" />
              </Field>
              <Field label="Category">
                <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              <div
                style={{
                  border: '2px dashed var(--line)', borderRadius: 12, padding: 20, textAlign: 'center',
                  position: 'relative', cursor: 'pointer', background: 'var(--surface-2)',
                }}
              >
                <input type="file" accept="image/png, image/jpeg" onChange={handleFileChange} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                {form.filePreview ? (
                  <img src={form.filePreview} alt="Preview" style={{ maxHeight: 150, borderRadius: 8, margin: '0 auto' }} />
                ) : (
                  <div style={{ color: 'var(--faint)' }}>
                    <Icon name="image" size={30} style={{ display: 'block', margin: '0 auto 8px' }} />
                    <div className="t13">Click to upload template image</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {aiError ? (
                <div style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                  ⚠️ {aiError}
                </div>
              ) : null}
              <Field label="Prompt" required>
                <TextArea rows={4} value={form.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="E.g. A luxury black and gold birthday template with balloons…" />
              </Field>
              <div className="t11 muted">Note: AI generates the visual design and layout coordinates automatically.</div>
              <Field label="Category">
                <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
            </>
          )}

          <div className="row gap-8" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving} icon={mode === 'ai' ? 'sparkles' : 'upload'}>
              {saving ? (mode === 'ai' ? 'Generating…' : 'Uploading…') : mode === 'ai' ? 'Generate Template' : 'Upload Template'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------------- New frame (Owner) ----------------

function CreateFrameModal({ onDone, onCancel }) {
  const { toast } = useApp()
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'solid',
    color1: '#EA097F',
    color2: '#5F4CAA',
    pattern: 'none',
    text: '#FFFFFF',
    defaultPrice: 50,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const draftFrame = useMemo(() => ({
    id: 'draft',
    name: form.name || 'New Frame',
    background: { type: form.type, colors: form.type === 'gradient' ? [form.color1, form.color2] : [form.color1], pattern: form.pattern },
    text: form.text,
    defaultPrice: Number(form.defaultPrice) || 0,
  }), [form])

  const submit = async () => {
    if (!form.name.trim()) { toast('Frame name is required', 'error'); return }
    setSaving(true)
    try {
      await api.platform.createFrame({
        name: form.name,
        description: form.description,
        background: { type: form.type, colors: [form.color1, form.color2], pattern: form.pattern },
        text: form.text,
        defaultPrice: Number(form.defaultPrice) || 0,
      })
      toast(`Frame “${form.name}” added to the catalogue`)
      onDone()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 20 }}>
      <div>
        <div className="label">Preview</div>
        <FramePreview frame={draftFrame} template={PREVIEW_TEMPLATE} width={160} branding={{ tagline: 'Your tagline here' }} />
        <div className="t11 faint mt-8">The complete output print is on the frame — photos plus the 15% branding footer.</div>
      </div>
      <div>
        <Field label="Frame name" required>
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pearl Ivory" />
        </Field>
        <Field label="Description">
          <TextInput value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="When this frame works best" />
        </Field>
        <div className="row gap-12">
          <div style={{ flex: 1 }}>
            <Field label="Background">
              <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
                {BACKGROUND_TYPES.map((t) => <option key={t} value={t}>{t === 'solid' ? 'Solid colour' : 'Gradient'}</option>)}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Pattern">
              <Select value={form.pattern} onChange={(e) => set('pattern', e.target.value)}>
                {FRAME_PATTERNS.map((p) => <option key={p} value={p}>{p === 'none' ? 'None' : p === 'dots' ? 'Dots' : 'Stripes'}</option>)}
              </Select>
            </Field>
          </div>
        </div>
        <div className="row gap-12">
          <div style={{ flex: 1 }}>
            <Field label="Colour 1">
              <input type="color" value={form.color1} onChange={(e) => set('color1', e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer' }} />
            </Field>
          </div>
          <div style={{ flex: 1, opacity: form.type === 'gradient' ? 1 : 0.4, pointerEvents: form.type === 'gradient' ? 'auto' : 'none' }}>
            <Field label="Colour 2 (gradient)">
              <input type="color" value={form.color2} onChange={(e) => set('color2', e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer' }} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Text colour">
              <input type="color" value={form.text} onChange={(e) => set('text', e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer' }} />
            </Field>
          </div>
        </div>
        <Field label="Suggested price (₹)" hint="Organisations start from this in their defaults; they can set any price per event.">
          <TextInput type="number" value={form.defaultPrice} onChange={(e) => set('defaultPrice', e.target.value)} />
        </Field>
        <div className="row gap-8" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon="plus" onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add frame'}</Button>
        </div>
      </div>
    </div>
  )
}
