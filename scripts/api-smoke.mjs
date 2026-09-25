// API smoke test for the v2 mock server (in-memory, no HTTP needed).
// Run: node scripts/api-smoke.mjs
//
// Covers the redefined surfaces:
//   • Event create/update — General/Customisation/Branding, NO price, NO passkey
//   • Organisation Defaults — no pricing section, idle timeout in SECONDS,
//     full frame catalogue with per-frame price + booth availability
//   • Templates — Architecture V1 creation flow (manual + AI draft)
//   • Frames — platform catalogue, Owner-only add/remove, 409 guards

import { handle } from '../src/api/mock/server.js'

let pass = 0
let fail = 0
const results = []

function check(label, cond, extra = '') {
  if (cond) {
    pass++
    results.push(`  ok   ${label}`)
  } else {
    fail++
    results.push(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

function call(method, path, body, token) {
  try {
    const r = handle(method, path, body, token)
    return { status: r.status, data: r.data, error: null }
  } catch (e) {
    return { status: e.status || 500, data: null, error: e.message }
  }
}

async function login(email) {
  const r = call('POST', '/api/auth/login', { email, password: 'demo123' })
  return r.data?.token
}

// ---------------- Auth ----------------
const owner = await login('owner@happypix.com')
const pa = await login('priya@happypix.com')
const sana = await login('sana@sunsetweddings.com')
const rohit = await login('rohit@sunsetweddings.com')

check('login owner → token', !!owner)
check('login org admin → token', !!sana)
check('login org manager → token', !!rohit)
check('wrong password → 401', call('POST', '/api/auth/login', { email: 'owner@happypix.com', password: 'nope' }).status === 401)
check('no token → 401', call('GET', '/api/platform/dashboard', null, null).status === 401)

// ---------------- Platform templates ----------------
let r = call('GET', '/api/platform/templates', null, owner)
check('GET templates (owner) → 200 with 9 seeds', r.status === 200 && r.data.templates.length === 9)
const duo = r.data.templates.find((t) => t.id === 'tpl-46-duo')
check('tpl-46-duo shape: 2 slots on 1200x1800 portrait', duo && duo.photoSlots.length === 2 && duo.canvas.width === 1200 && duo.canvas.height === 1800 && duo.orientation === 'portrait')
check('general template is universal, no slots', (() => { const g = r.data.templates.find((t) => t.id === 'tpl-royal-bg'); return g && g.imageScope === 'general' && g.orientation === 'universal' && g.photoSlots.length === 0 })())
check('org admin may READ templates (use perm)', call('GET', '/api/platform/templates', null, sana).status === 200)
check('org admin may not CREATE templates', call('POST', '/api/platform/templates', { name: 'X' }, sana).status === 403)

r = call('POST', '/api/platform/templates', { name: 'Strip Test', description: '', category: 'Custom', imageScope: 'specific', orientation: 'strip', slotCount: 3, source: 'manual' }, owner)
check('POST template specific (strip,3) → 201', r.status === 201)
check('…server computed 3 photoSlots', r.data?.template?.photoSlots?.length === 3)
check('…status published, source manual', r.data?.template?.status === 'published' && r.data?.template?.source === 'manual')
const stripTestId = r.data?.template?.id

r = call('POST', '/api/platform/templates', { name: 'Universal Test', imageScope: 'general', source: 'manual' }, owner)
check('POST template universal → 201, no slots', r.status === 201 && r.data?.template?.photoSlots?.length === 0 && r.data?.template?.orientation === 'universal')
const uniTestId = r.data?.template?.id

check('POST template slotCount 5 → 400', call('POST', '/api/platform/templates', { name: 'Bad', imageScope: 'specific', orientation: 'portrait', slotCount: 5 }, owner).status === 400)

r = call('POST', '/api/platform/templates/ai-generate', { prompt: 'A luxury black and gold birthday template with balloons', imageScope: 'specific', orientation: 'portrait', slotCount: 2 }, owner)
check('POST ai-generate → draft with backgroundUrl', r.status === 200 && typeof r.data?.draft?.backgroundUrl === 'string' && r.data.draft.backgroundUrl.length > 40)
check('…draft is status draft with 2 slots', r.data?.draft?.status === 'draft' && r.data?.draft?.photoSlots?.length === 2)
check('…draft NOT persisted yet', call('GET', '/api/platform/templates', null, owner).data.templates.length === 11) // 9 + 2 new

r = call('POST', '/api/platform/templates', { ...r.data.draft, status: 'published', category: 'Custom' }, owner)
check('save AI draft → published template', r.status === 201 && r.data?.template?.source === 'ai_generated' && r.data?.template?.status === 'published')
const aiTestId = r.data?.template?.id

r = call('PUT', `/api/platform/templates/${stripTestId}`, { name: 'Strip Test Renamed' }, owner)
check('PUT rename template → 200', r.status === 200 && r.data?.template?.name === 'Strip Test Renamed')
check('PUT by org admin → 403', call('PUT', `/api/platform/templates/${stripTestId}`, { name: 'Hax' }, sana).status === 403)

check('DELETE in-use template (tpl-46-duo) → 409', call('DELETE', '/api/platform/templates/tpl-46-duo', null, owner).status === 409)
r = call('DELETE', `/api/platform/templates/${uniTestId}`, null, owner)
check('DELETE unused template → 200', r.status === 200)
r = call('DELETE', `/api/platform/templates/${aiTestId}`, null, owner)
check('DELETE AI template → 200', r.status === 200)

// ---------------- Frames ----------------
r = call('GET', '/api/platform/frames', null, owner)
check('GET frames (owner) → 12 frames with enabledOrgs', r.status === 200 && r.data.frames.length === 12 && r.data.frames.every((f) => Number.isInteger(f.enabledOrgs)))

check('POST frame by platform admin → 403 (owner-only)', call('POST', '/api/platform/frames', { name: 'PA Frame', background: { type: 'solid', colors: ['#111111'] } }, pa).status === 403)
check('POST frame duplicate name → 409', call('POST', '/api/platform/frames', { name: 'Classic White', background: { type: 'solid', colors: ['#FFFFFF'] } }, owner).status === 409)
r = call('POST', '/api/platform/frames', { name: 'Test Frame X', description: 'smoke', background: { type: 'gradient', colors: ['#EA097F', '#5F4CAA'], pattern: 'dots' }, defaultPrice: 30 }, owner)
check('POST new frame (owner) → 201', r.status === 201 && r.data?.frame?.id)
check('catalogue now 13', call('GET', '/api/platform/frames', null, owner).data.frames.length === 13)

check('DELETE frame-mono (enabled at Tech Closet) → 409', call('DELETE', '/api/platform/frames/frame-mono', null, owner).status === 409)
r = call('DELETE', '/api/platform/frames/frame-emerald', null, owner)
check('DELETE frame-emerald (disabled everywhere) → 200', r.status === 200)
check('catalogue now 12 again', call('GET', '/api/platform/frames', null, owner).data.frames.length === 12)
const testFrame = call('GET', '/api/platform/frames', null, owner).data.frames.find((f) => f.name === 'Test Frame X')
check('Test Frame X listed', !!testFrame)
check('DELETE Test Frame X → 200', call('DELETE', `/api/platform/frames/${testFrame.id}`, null, owner).status === 200)
check('DELETE missing frame → 404', call('DELETE', '/api/platform/frames/frame-nope', null, owner).status === 404)

// ---------------- Org events (new shape) ----------------
r = call('GET', '/api/org/events', null, sana)
check('GET events (org admin) → 200', r.status === 200 && Array.isArray(r.data.events))
check('seed events have no price/passkey fields', r.data.events.every((e) => e.printPrice === undefined && e.passkey === undefined))
check('seed event has new shape', (() => { const e = r.data.events.find((x) => x.id === 'evt-sun-1'); return e && Array.isArray(e.templateIds) && Array.isArray(e.filters) && typeof e.digitalCopy === 'boolean' && !!e.branding })())

// Mock clock is 24 Sep 2026 11:30 +05:30 — pick an event that is ACTIVE then.
const start = '2026-09-24T10:00:00+05:30'
const end = '2026-09-24T20:00:00+05:30'
r = call('POST', '/api/org/events', {
  name: 'Smoke Wedding', clientName: 'A & B', location: 'Delhi',
  startDate: start, endDate: end, digitalCopy: true,
  filters: ['warm', 'bw'], templateIds: ['tpl-46-duo'],
  branding: { logoUrl: null, tagline: 'Smoke tagline' },
}, sana)
check('POST event (new shape) → 201', r.status === 201)
const ev = r.data?.event
check('event has no price, no passkey', !!ev && ev.printPrice === undefined && ev.passkey === undefined && ev.frameIds === undefined)
check('event echoes branding + digitalCopy', !!ev && ev.digitalCopy === true && ev.branding?.tagline === 'Smoke tagline' && ev.filters.length === 2)
const smokeEventId = ev?.id

check('POST event unknown filter → 400', call('POST', '/api/org/events', { name: 'X', startDate: start, endDate: end, filters: ['sparkly'] }, sana).status === 400)
check('POST event unknown template → 400', call('POST', '/api/org/events', { name: 'X', startDate: start, endDate: end, templateIds: ['tpl-nope'] }, sana).status === 400)
check('POST event end before start → 400', call('POST', '/api/org/events', { name: 'X', startDate: end, endDate: start }, sana).status === 400)
check('POST event by org manager → 201 (can create)', call('POST', '/api/org/events', { name: 'Manager Event', startDate: start, endDate: end }, rohit).status === 201)

r = call('PUT', `/api/org/events/${smokeEventId}`, { digitalCopy: false, filters: ['warm'], branding: { logoUrl: null, tagline: 'New tagline' } }, sana)
check('PUT event → 200 with updates', r.status === 200 && r.data?.event?.digitalCopy === false && r.data?.event?.branding?.tagline === 'New tagline' && r.data?.event?.filters.length === 1)

check('DELETE active event → 409', call('DELETE', `/api/org/events/${smokeEventId}`, null, sana).status === 409)
check('pause event → 200', call('POST', `/api/org/events/${smokeEventId}/pause`, {}, sana).status === 200)
check('DELETE paused event → 200', call('DELETE', `/api/org/events/${smokeEventId}`, null, sana).status === 200)

// ---------------- Org defaults (new shape) ----------------
r = call('GET', '/api/org/defaults', null, sana)
check('GET defaults (org admin) → 200', r.status === 200)
check('defaults have boothTimeoutSec, NO pricing fields', !!r.data && Number.isFinite(r.data.boothTimeoutSec) && r.data.printPrice === undefined && r.data.downloadPrice === undefined && r.data.boothTimeoutMin === undefined)
check('defaults expose FULL frame catalogue (11 after emerald removed)', r.data?.frames?.length === 11 && r.data.frames.every((f) => 'frameId' in f && 'price' in f && 'allowed' in f))
check('sunset royal frame has custom price 75', r.data?.frames?.find((f) => f.frameId === 'frame-royal')?.price === 75)
check('GET defaults (org manager, read-only) → 200', call('GET', '/api/org/defaults', null, rohit).status === 200)
check('PUT defaults (org manager) → 403', call('PUT', '/api/org/defaults', { boothTimeoutSec: 100 }, rohit).status === 403)
check('PUT defaults by platform owner → 403 (org scope)', call('PUT', '/api/org/defaults', { boothTimeoutSec: 100 }, owner).status === 403)

r = call('PUT', '/api/org/defaults', { boothTimeoutSec: 120, frames: [{ frameId: 'frame-gold', price: 120, allowed: true }] }, sana)
check('PUT defaults: timeout 120s + gold price → 200', r.status === 200 && r.data?.boothTimeoutSec === 120 && r.data?.frames?.find((f) => f.frameId === 'frame-gold')?.price === 120)
check('…unseen catalogue frames kept as disabled', r.data?.frames?.length === 11 && r.data.frames.every((f) => 'allowed' in f))
check('PUT boothTimeoutSec 5 → 400', call('PUT', '/api/org/defaults', { boothTimeoutSec: 5 }, sana).status === 400)
check('PUT unknown frameId → 400', call('PUT', '/api/org/defaults', { frames: [{ frameId: 'frame-nope', price: 10, allowed: true }] }, sana).status === 400)

// ---------------- Cross-role guards ----------------
check('org admin on platform orgs → 403', call('GET', '/api/platform/organisations', null, sana).status === 403)
check('platform admin on org events → 403 (org scope)', call('GET', '/api/org/events', null, pa).status === 403)

console.log('\n' + results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
