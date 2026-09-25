// API smoke test for the v2 mock server (in-memory, no HTTP needed).
// Run: node scripts/api-smoke.mjs
//
// Covers the redefined surfaces:
//   • Event create/update — General/Customisation/Branding, NO price, NO passkey;
//     branding.logos = sponsor/host/venue logos (0–15, optional)
//   • Organisation Defaults — idle timeout in SECONDS + layoutPrices
//     (per layout iteration: family × image-slot count)
//   • Templates — platform Template Library: 17 seeds (14 designer + 2 AI +
//     1 playground), layout-anchored CRUD + AI draft + publish gating

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

// ---------------- Platform templates (Template Library) ----------------
let r = call('GET', '/api/platform/templates', null, owner)
check('GET templates (owner) → 200 with 17 seeds', r.status === 200 && r.data.templates.length === 17)
const royal = r.data.templates.find((t) => t.id === 'hp-royal-57v3')
check('designer template shape: layout-anchored with meta', royal && royal.componentId === 'RoyalWedding' && royal.layoutId === '57-v3' && royal.layout?.slots === 3 && royal.layout?.orientation === 'portrait' && royal.layout?.code === '57')
check('AI seed has data-URI background + design config', (() => { const t = r.data.templates.find((x) => x.id === 'hp-ai-royal-46v3'); return t && t.source === 'ai_generated' && typeof t.design?.bg?.url === 'string' && t.design.bg.url.startsWith('data:image/svg') })())
check('org admin may READ templates (use perm)', call('GET', '/api/platform/templates', null, sana).status === 200)
check('org admin may not CREATE templates', call('POST', '/api/platform/templates', { name: 'X', layoutId: '46-v1' }, sana).status === 403)

check('POST template without layoutId → 400', call('POST', '/api/platform/templates', { name: 'Bad' }, owner).status === 400)
check('POST template unknown layoutId → 400', call('POST', '/api/platform/templates', { name: 'Bad', layoutId: 'nope' }, owner).status === 400)
r = call('POST', '/api/platform/templates', { name: 'Playground Test', description: 'smoke', category: 'Party', layoutId: '810-210-v4', design: { bg: { type: 'solid', colors: ['#112233'] }, accent: '#D9B44A', textColor: '#FFFFFF', ornament: 'dots', font: 'sans', slotShape: 'round' } }, owner)
check('POST playground template → 201, source playground, published', r.status === 201 && r.data?.template?.id && r.data.template.source === 'playground' && r.data.template.active === true && r.data.template.layoutId === '810-210-v4')
const pgTestId = r.data?.template?.id

r = call('POST', '/api/platform/templates/ai-generate', { prompt: 'A luxury black and gold birthday template with balloons', layoutId: '46-v4' }, owner)
check('POST ai-generate → design draft for the layout', r.status === 200 && r.data?.draft?.layoutId === '46-v4' && typeof r.data.draft?.design?.bg?.url === 'string' && r.data.draft.design.bg.url.startsWith('data:image/svg'))
check('…draft NOT persisted', call('GET', '/api/platform/templates', null, owner).data.templates.length === 18) // 17 + 1 playground

r = call('POST', '/api/platform/templates', { ...r.data.draft, name: r.data.draft.name, category: 'Birthday' }, owner)
check('save AI draft → published ai_generated template', r.status === 201 && r.data?.template?.source === 'ai_generated' && r.data.template.active === true && r.data.template.design?.bg?.url?.startsWith('data:image/svg'))
const aiTestId = r.data?.template?.id

r = call('PUT', `/api/platform/templates/${pgTestId}`, { name: 'Playground Test Renamed' }, owner)
check('PUT rename template → 200', r.status === 200 && r.data?.template?.name === 'Playground Test Renamed')
check('PUT by org admin → 403', call('PUT', `/api/platform/templates/${pgTestId}`, { name: 'Hax' }, sana).status === 403)
check('PUT layout change on event-used template → 409', call('PUT', '/api/platform/templates/hp-classic-46v1', { layoutId: '57-v1' }, owner).status === 409)
r = call('PUT', `/api/platform/templates/${pgTestId}`, { layoutId: '810-210-h4' }, owner)
check('PUT layout change on unused template → 200', r.status === 200 && r.data?.template?.layoutId === '810-210-h4')
r = call('PUT', `/api/platform/templates/${pgTestId}`, { active: false }, owner)
check('PUT unpublish → 200, hidden', r.status === 200 && r.data?.template?.active === false)
check('unpublished template rejected on event create', call('POST', '/api/org/events', { name: 'X', startDate: '2026-09-24T10:00:00+05:30', endDate: '2026-09-24T12:00:00+05:30', templateIds: [pgTestId] }, sana).status === 400)
r = call('PUT', `/api/platform/templates/${pgTestId}`, { active: true }, owner)
check('PUT republish → 200', r.status === 200 && r.data?.template?.active === true)

check('DELETE designer component template → 409', call('DELETE', '/api/platform/templates/hp-classic-46v1', null, owner).status === 409)
check('DELETE event-used playground template → 409', call('DELETE', '/api/platform/templates/hp-royal-57v3', null, owner).status === 409)
r = call('DELETE', `/api/platform/templates/${aiTestId}`, null, owner)
check('DELETE unused AI template → 200', r.status === 200)
r = call('DELETE', `/api/platform/templates/${pgTestId}`, null, owner)
check('DELETE unused playground template → 200', r.status === 200)
check('DELETE missing template → 404', call('DELETE', '/api/platform/templates/hp-nope', null, owner).status === 404)

// ---------------- Org events (new shape) ----------------
r = call('GET', '/api/org/events', null, sana)
check('GET events (org admin) → 200', r.status === 200 && Array.isArray(r.data.events))
check('seed events have no price/passkey fields', r.data.events.every((e) => e.printPrice === undefined && e.passkey === undefined))
check('seed event has new shape', (() => { const e = r.data.events.find((x) => x.id === 'evt-sun-1'); return e && Array.isArray(e.templateIds) && e.templateIds.every((t) => typeof t === 'string' && t.startsWith('hp-')) && Array.isArray(e.filters) && typeof e.digitalCopy === 'boolean' && Array.isArray(e.branding?.logos) })())

// Mock clock is 24 Sep 2026 11:30 +05:30 — pick an event that is ACTIVE then.
const start = '2026-09-24T10:00:00+05:30'
const end = '2026-09-24T20:00:00+05:30'
r = call('POST', '/api/org/events', {
  name: 'Smoke Wedding', clientName: 'A & B', location: 'Delhi',
  startDate: start, endDate: end, digitalCopy: true,
  filters: ['warm', 'bw'], templateIds: ['hp-classic-46v1', 'hp-sunset-4626v3'],
  branding: { logos: ['data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E', 'data:image/png;base64,iVBORw0KGgo='], tagline: 'Smoke tagline' },
}, sana)
check('POST event (new shape) → 201', r.status === 201)
const ev = r.data?.event
check('event has no price, no passkey', !!ev && ev.printPrice === undefined && ev.passkey === undefined && ev.frameIds === undefined)
check('event echoes branding logos + digitalCopy', !!ev && ev.digitalCopy === true && ev.branding?.tagline === 'Smoke tagline' && ev.branding?.logos?.length === 2 && ev.filters.length === 2)
const smokeEventId = ev?.id

check('POST event unknown filter → 400', call('POST', '/api/org/events', { name: 'X', startDate: start, endDate: end, filters: ['sparkly'] }, sana).status === 400)
check('POST event unknown template → 400', call('POST', '/api/org/events', { name: 'X', startDate: start, endDate: end, templateIds: ['tpl-nope'] }, sana).status === 400)
check('POST event end before start → 400', call('POST', '/api/org/events', { name: 'X', startDate: end, endDate: start }, sana).status === 400)
check('POST event with 16 logos → 400', call('POST', '/api/org/events', { name: 'X', startDate: start, endDate: end, branding: { logos: Array.from({ length: 16 }, (_, i) => `logo-${i}`) } }, sana).status === 400)
check('POST event by org manager → 201 (can create)', call('POST', '/api/org/events', { name: 'Manager Event', startDate: start, endDate: end }, rohit).status === 201)

r = call('PUT', `/api/org/events/${smokeEventId}`, { digitalCopy: false, filters: ['warm'], branding: { logos: ['solo'], tagline: 'New tagline' } }, sana)
check('PUT event → 200 with updates', r.status === 200 && r.data?.event?.digitalCopy === false && r.data?.event?.branding?.tagline === 'New tagline' && r.data?.event?.branding?.logos?.length === 1 && r.data?.event?.filters.length === 1)

check('DELETE active event → 409', call('DELETE', `/api/org/events/${smokeEventId}`, null, sana).status === 409)
check('pause event → 200', call('POST', `/api/org/events/${smokeEventId}/pause`, {}, sana).status === 200)
check('DELETE paused event → 200', call('DELETE', `/api/org/events/${smokeEventId}`, null, sana).status === 200)

// ---------------- Org defaults (new shape) ----------------
r = call('GET', '/api/org/defaults', null, sana)
check('GET defaults (org admin) → 200', r.status === 200)
check('defaults have boothTimeoutSec, NO pricing fields', !!r.data && Number.isFinite(r.data.boothTimeoutSec) && r.data.printPrice === undefined && r.data.downloadPrice === undefined && r.data.boothTimeoutMin === undefined)
check('defaults expose layoutPrices over the full suggested map', r.data?.layoutPrices && Object.keys(r.data.layoutPrices).length >= 38 && Object.keys(r.data.layoutPrices).every((k) => /^[-0-9a-z]+:\d+$/.test(k) && Number.isFinite(r.data.layoutPrices[k])))
check('sunset 5×7 3-image iteration keeps its custom ₹90 price', r.data?.layoutPrices?.['57:3'] === 90)
check('GET defaults (org manager, read-only) → 200', call('GET', '/api/org/defaults', null, rohit).status === 200)
check('PUT defaults (org manager) → 403', call('PUT', '/api/org/defaults', { boothTimeoutSec: 100 }, rohit).status === 403)
check('PUT defaults by platform owner → 403 (org scope)', call('PUT', '/api/org/defaults', { boothTimeoutSec: 100 }, owner).status === 403)

r = call('PUT', '/api/org/defaults', { boothTimeoutSec: 120, layoutPrices: { '68:4': 120, '810-210:5': 55 } }, sana)
check('PUT defaults: timeout 120s + two layout prices → 200', r.status === 200 && r.data?.boothTimeoutSec === 120 && r.data?.layoutPrices?.['68:4'] === 120 && r.data?.layoutPrices?.['810-210:5'] === 55)
check('…partial PUT keeps sunset\'s other custom prices', r.data?.layoutPrices?.['57:3'] === 90 && r.data?.layoutPrices?.['46:1'] > 0)
check('PUT boothTimeoutSec 5 → 400', call('PUT', '/api/org/defaults', { boothTimeoutSec: 5 }, sana).status === 400)
check('PUT unknown layout key → 400', call('PUT', '/api/org/defaults', { layoutPrices: { 'frame-nope:2': 10 } }, sana).status === 400)
check('PUT negative price → 400', call('PUT', '/api/org/defaults', { layoutPrices: { '68:4': -5 } }, sana).status === 400)

// ---------------- Cross-role guards ----------------
check('org admin on platform orgs → 403', call('GET', '/api/platform/organisations', null, sana).status === 403)
check('platform admin on org events → 403 (org scope)', call('GET', '/api/org/events', null, pa).status === 403)

// ---------------- Devices: rename + booth operator (v2.1) ----------------
r = call('GET', '/api/org/devices', null, rohit)
const devId = r.data?.devices?.[0]?.id
check('GET devices (org manager) → 200 with operator + telemetry fields', r.status === 200 && r.data.devices.every((d) => 'operatorName' in d && 'telemetry' in d))

r = call('PUT', `/api/org/devices/${devId}`, { deviceName: 'Booth 01 — Renamed', operatorName: 'Ramesh Test', operatorPhone: '+91 90000 00000' }, rohit)
check('PUT device rename + operator (org manager) → 200', r.status === 200 && r.data?.device?.deviceName === 'Booth 01 — Renamed' && r.data?.device?.operatorName === 'Ramesh Test')
check('PUT device empty name → 400', call('PUT', `/api/org/devices/${devId}`, { deviceName: '  ' }, rohit).status === 400)
check('PUT device (platform owner) → 403 org scope', call('PUT', `/api/org/devices/${devId}`, { deviceName: 'X' }, owner).status === 403)
r = call('PUT', `/api/org/devices/${devId}`, { deviceName: 'Booth 01 — Main Hall', operatorName: null, operatorPhone: null }, sana)
check('PUT device operator cleared by org admin → 200', r.status === 200 && r.data?.device?.operatorName === null)

// ---------------- Booth telemetry push (v2.1) ----------------
const dev = call('GET', '/api/org/devices', null, sana).data.devices[0]
r = call('POST', `/api/booth/devices/${dev.deviceUuid}/telemetry`, { printsTotal: 999, shutterCount: 2001, batteryPct: 55 }, null)
check('POST booth telemetry (public, uuid) → 200', r.status === 200 && r.data?.telemetry?.prints === 999 && r.data?.telemetry?.batteryPct === 55)
check('POST booth telemetry unknown uuid → 404', call('POST', '/api/booth/devices/nope/telemetry', { printsTotal: 1 }, null).status === 404)
r = call('GET', '/api/org/devices', null, sana)
check('telemetry visible to CRM via org devices', r.data?.devices?.find((d) => d.id === dev.id)?.telemetry?.prints === 999)

// ---------------- Forgot / reset password (OTP-style, v2.1) ----------------
r = call('POST', '/api/auth/forgot-password', { email: 'rohit@sunsetweddings.com' }, null)
const fpCode = r.data?.code
check('forgot-password → 200 with 6-digit demo code', r.status === 200 && /^\d{6}$/.test(fpCode || ''))
check('forgot-password unknown email → 200 (no leak)', call('POST', '/api/auth/forgot-password', { email: 'ghost@nowhere.io' }, null).status === 200)
check('reset-password wrong code → 400', call('POST', '/api/auth/reset-password', { email: 'rohit@sunsetweddings.com', code: '000000', newPassword: 'newpass1' }, null).status === 400)
check('reset-password short password → 400', call('POST', '/api/auth/reset-password', { email: 'rohit@sunsetweddings.com', code: fpCode, newPassword: '123' }, null).status === 400)
r = call('POST', '/api/auth/reset-password', { email: 'rohit@sunsetweddings.com', code: fpCode, newPassword: 'newpass1' }, null)
check('reset-password with correct code → 200', r.status === 200)
check('login with new password → 200', call('POST', '/api/auth/login', { email: 'rohit@sunsetweddings.com', password: 'newpass1' }).status === 200)
check('code is single-use → 400 on repeat', call('POST', '/api/auth/reset-password', { email: 'rohit@sunsetweddings.com', code: fpCode, newPassword: 'again12' }, null).status === 400)

// ---------------- Booth-created ticket with session context (v2.1) ----------------
r = call('POST', '/api/booth/tickets', {
  organizationId: 'org-sunset', eventId: 'evt-sun-1', deviceId: dev.id,
  subject: 'Print came out blank', category: 'payment', priority: 'high',
  guestName: 'Test Guest', message: 'Paid but print is blank.',
  session: {
    id: 'SES-TEST', phone: '+91 90000 11111',
    slot: { label: 'Slot T', start: '2026-09-24T10:00:00+05:30', end: '2026-09-24T10:30:00+05:30' },
    package: { templateId: 'hp-classic-46v1', layout: '4×6 · 1', prints: 2, digitalCopy: true },
    cameraClicks: 5, filtersUsed: ['warm'],
    payment: { utr: '417TEST999', amount: 100, status: 'paid', method: 'UPI', at: '2026-09-24T10:25:00+05:30' },
    startedAt: '2026-09-24T10:00:00+05:30', endedAt: '2026-09-24T10:28:00+05:30',
  },
}, null)
const btId = r.data?.ticket?.id
check('POST booth ticket → 201 with resolved session refs', r.status === 201 && r.data?.ticket?.session?.package?.templateName === 'Classic White' && r.data?.ticket?.session?.package?.layout === '4×6 · 1' && r.data?.ticket?.session?.phone === '+91 90000 11111')
check('POST booth ticket without session → 400', call('POST', '/api/booth/tickets', { organizationId: 'org-sunset', subject: 'x' }, null).status === 400)
r = call('GET', `/api/org/tickets/${btId}`, null, sana)
check('org can read booth ticket with session', r.status === 200 && r.data?.ticket?.session?.payment?.utr === '417TEST999')

console.log('\n' + results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
