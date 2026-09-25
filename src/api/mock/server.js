// ============================================================
// Mock API server — implements the v2 API contract with the
// SAME rules the real backend must have:
//   * JWT-style token auth (mock tokens)
//   * fixed permission matrix (lib/roles.js) enforced server-side
//   * organisation scoping for org-role users
//   * plan-limit enforcement on create/assign
//   * derived statuses (plan, event, device online)
// ============================================================

import { getDb, persist } from './db.js'
import {
  ROLES, PERMS, roleHasPermission, isOrgRole, isPlatformRole,
} from '../../lib/roles.js'
import { PLANS, DEVICE_ONLINE_WINDOW_MS, FILTERS } from '../../lib/plans.js'
import { slotsFor, ORIENTATIONS, SLOT_COUNTS } from '../../lib/templates.js'
import { frameUsage } from '../../lib/frames.js'
import { monthKey, fyStart } from '../../lib/format.js'

const NOW = () => new Date('2026-09-24T11:30:00+05:30') // demo clock = "today"

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------- derived state helpers ----------

export function computePlanStatus(org, subs) {
  if (org.status === 'suspended') return 'suspended'
  if (org.status === 'banned') return 'banned'
  const sub = subs.find((s) => s.organizationId === org.id)
  if (!sub) return 'not_subscribed'
  const now = NOW()
  const end = new Date(sub.extendedTo || sub.endDate)
  const start = new Date(sub.startDate)
  if (sub.plan === 'trial' || sub.amount === 0) {
    if (now > end) return 'expired'
    return 'trial'
  }
  if (now < start) return 'not_subscribed'
  if (now > end) return 'expired'
  if (end.getTime() - now.getTime() < 14 * 86400000) return 'expiring_soon'
  return 'active'
}

export function computeEventStatus(ev) {
  const now = NOW()
  if (ev.paused) return 'paused'
  const s = new Date(ev.startDate)
  const e = new Date(ev.endDate)
  if (now < s) return 'upcoming'
  if (now > e) return 'finished'
  return 'active'
}

export function computeDeviceOnline(dev) {
  if (!dev.lastSeenAt) return false
  return NOW() - new Date(dev.lastSeenAt) < DEVICE_ONLINE_WINDOW_MS
}

export function orgLimits(org) {
  return PLANS[org.plan] || PLANS.trial
}

export function planSummary(org, subs) {
  const sub = subs.find((s) => s.organizationId === org.id)
  const status = computePlanStatus(org, subs)
  const end = sub ? new Date(sub.extendedTo || sub.endDate) : null
  const start = sub ? new Date(sub.startDate) : null
  const daysLeft = end ? Math.max(0, Math.ceil((end - NOW()) / 86400000)) : null
  return {
    plan: org.plan,
    planName: PLANS[org.plan]?.name || org.plan,
    status,
    startDate: start ? start.toISOString() : null,
    endDate: end ? end.toISOString() : null,
    daysLeft,
    amount: sub ? sub.amount : 0,
    invoice: sub ? sub.invoice || null : null,
    deviceLimit: orgLimits(org).devices,
    eventLimit: orgLimits(org).events,
  }
}

function scopeOrg(reqUser, orgId) {
  if (isOrgRole(reqUser.role)) {
    if (!orgId || orgId !== reqUser.organizationId) {
      throw new ApiError(403, 'You can only access your own organisation.')
    }
    return reqUser.organizationId
  }
  return orgId
}

function requirePerm(user, perm) {
  if (!roleHasPermission(user.role, perm)) {
    throw new ApiError(403, `Your role does not permit this action (${perm}).`)
  }
}

function paginated(items, { page = 1, limit = 10 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1)
  const l = Math.max(1, parseInt(limit, 10) || 10)
  return {
    items: items.slice((p - 1) * l, p * l),
    total: items.length,
    page: p,
    pages: Math.max(1, Math.ceil(items.length / l)),
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function logAudit(db, { at, actorId, action, entity, summary, ip, organizationId, severity = 'info' }) {
  db.audit.unshift({
    id: uid('aud'),
    at: at || NOW().toISOString(),
    actorId,
    action,
    entity,
    summary,
    ip: ip || '127.0.0.1',
    severity,
    organizationId: organizationId || null,
  })
}

function userPublic(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    organizationId: u.organizationId, status: u.status,
    photoUrl: u.photoUrl, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  }
}

// ---------- aggregates ----------

function revenueAgg(db, orgId, { from, to, eventId, deviceId, status } = {}) {
  let pays = db.payments.filter((p) => (!orgId || p.organizationId === orgId) && p.status !== 'failed')
  if (from) pays = pays.filter((p) => new Date(p.createdAt) >= new Date(from))
  if (to) pays = pays.filter((p) => new Date(p.createdAt) <= new Date(to))
  if (eventId) pays = pays.filter((p) => p.eventId === eventId)
  if (deviceId) pays = pays.filter((p) => p.deviceId === deviceId)
  const byStatus = { paid: 0, pending: 0, failed: 0 }
  for (const p of db.payments.filter((p) => !orgId || p.organizationId === orgId)) {
    if (p.status === 'failed') byStatus.failed += 1
    else byStatus[p.status] = (byStatus[p.status] || 0) + 1
  }
  const total = pays.reduce((s, p) => s + p.amount, 0)
  const prints = pays.reduce((s, p) => s + p.printCount, 0)
  return { total, prints, transactions: pays.length, byStatus }
}

function monthSeries(db, orgId, months = 8) {
  const out = []
  const now = NOW()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const v = db.payments
      .filter((p) => (!orgId || p.organizationId === orgId) && p.status === 'paid')
      .filter((p) => monthKey(new Date(p.createdAt)) === key)
      .reduce((s, p) => s + p.amount, 0)
    out.push({ key, value: v })
  }
  return out
}

function subRevenueSeries(db, months = 8) {
  const out = []
  const now = NOW()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const v = db.subscriptions
      .filter((s) => s.paidAt && s.amount > 0 && monthKey(new Date(s.paidAt)) === key)
      .reduce((sum, s) => sum + s.amount, 0)
    out.push({ key, value: v })
  }
  return out
}

// =====================================================================
// Route handler
// =====================================================================

export function handle(method, path, body, token) {
  const db = getDb()
  const url = new URL(path, 'http://x')
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const p = parts[0]
  const p2 = parts[1]
  const p3 = parts[2]

  // ---- auth (public routes first) ----
  if (p === 'auth' && p2 === 'login' && method === 'POST') {
    const { email, password } = body || {}
    const u = db.users.find((x) => x.email.toLowerCase() === String(email || '').toLowerCase())
    if (!u || u.status !== 'active' || String(password || '').length < 6) {
      throw new ApiError(401, 'Invalid email or password.')
    }
    u.lastLoginAt = NOW().toISOString()
    persist()
    logAudit(db, {
      actorId: u.id,
      action: (isOrgRole(u.role) ? 'organisation' : 'platform') + '.auth.login',
      entity: 'user',
      summary: `${u.name} signed in to CRM`,
    })
    persist()
    return { status: 200, data: { token: `mock:${u.id}`, user: userPublic(u) } }
  }

  let user = null
  if (token && token.startsWith('mock:')) {
    user = db.users.find((u) => u.id === token.slice(5))
    if (!user || user.status !== 'active') user = null
  }
  const authed = (req) => {
    if (!user) throw new ApiError(401, 'Not authenticated.')
    if (req) requirePerm(user, req)
    return user
  }

  if (p === 'auth') {
    if (p2 === 'me' && method === 'GET') {
      authed()
      return { status: 200, data: { user: userPublic(user) } }
    }
    if (p2 === 'profile' && method === 'PUT') {
      authed(PERMS.PROFILE_EDIT)
      if (body.name) user.name = String(body.name).trim()
      if (body.photoUrl != null) user.photoUrl = body.photoUrl
      persist()
      return { status: 200, data: { user: userPublic(user) } }
    }
    if (p2 === 'password' && method === 'POST') {
      authed(PERMS.PROFILE_EDIT)
      if (String(body.newPassword || '').length < 6) throw new ApiError(400, 'New password must be at least 6 characters.')
      user.password = body.newPassword
      persist()
      logAudit(db, { actorId: user.id, action: 'platform.auth.password_change', entity: 'user', summary: `${user.name} changed their password`, organizationId: user.organizationId })
      persist()
      return { status: 200, data: { ok: true } }
    }
  }

  // ================= PLATFORM =================
  if (p === 'platform') {
    if (p2 === 'dashboard' && method === 'GET') {
      authed(PERMS.PLATFORM_DASHBOARD_VIEW)
      const orgs = db.organisations
      const devices = db.devices
      const events = db.events
      const subs = db.subscriptions
      const online = devices.filter(computeDeviceOnline).length
      const activeOrgs = orgs.filter((o) => computePlanStatus(o, subs) === 'active').length
      const trialOrgs = orgs.filter((o) => computePlanStatus(o, subs) === 'trial').length
      const expiring = orgs
        .map((o) => ({ o, ps: planSummary(o, subs) }))
        .filter(({ ps }) => ps.status === 'expiring_soon')
        .sort((a, b) => a.ps.daysLeft - b.ps.daysLeft)
      const nearLimits = orgs
        .map((o) => {
          const lim = orgLimits(o)
          const dUsed = devices.filter((d) => d.organizationId === o.id).length
          const eUsed = events.filter((e) => e.organizationId === o.id && computeEventStatus(e) === 'active').length
          return { org: o, deviceUsed: dUsed, deviceLimit: lim.devices, eventUsed: eUsed, eventLimit: lim.events }
        })
        .filter((x) => x.deviceUsed >= x.deviceLimit * 0.8 || x.eventUsed >= x.eventLimit * 0.8)
      return {
        status: 200,
        data: {
          orgs: { total: orgs.length, active: activeOrgs, trial: trialOrgs, suspended: orgs.filter((o) => o.status === 'suspended').length, banned: orgs.filter((o) => o.status === 'banned').length },
          devices: { total: devices.length, online, offline: devices.length - online, operational: devices.filter((d) => d.status === 'active').length },
          events: { active: events.filter((e) => computeEventStatus(e) === 'active').length, upcoming: events.filter((e) => computeEventStatus(e) === 'upcoming').length, finished: events.filter((e) => computeEventStatus(e) === 'finished').length },
          expiringSoon: expiring.map(({ o, ps }) => ({ id: o.id, name: o.name, plan: ps.planName, status: ps.status, daysLeft: ps.daysLeft })),
          nearLimits: nearLimits.map((x) => ({ id: x.org.id, name: x.org.name, deviceUsed: x.deviceUsed, deviceLimit: x.deviceLimit, eventUsed: x.eventUsed, eventLimit: x.eventLimit })),
          recentSignups: [...orgs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5)
            .map((o) => ({ id: o.id, name: o.name, createdAt: o.createdAt, plan: planSummary(o, subs).planName })),
          alerts: [
            ...expiring.map(({ ps }) => ({ kind: 'plan_expiring', text: `${ps.planName} plan expiring in ${ps.daysLeft} days`, tone: 'warn' })),
            ...orgs.filter((o) => o.status === 'suspended').map((o) => ({ kind: 'suspended', text: `Organisation ${o.name} is suspended`, tone: 'warn' })),
            ...orgs.filter((o) => o.status === 'banned').map((o) => ({ kind: 'banned', text: `Organisation ${o.name} is banned`, tone: 'danger' })),
          ].slice(0, 6),
        },
      }
    }

    if (p2 === 'revenue' && method === 'GET') {
      authed(PERMS.PLATFORM_REVENUE_VIEW)
      const now = NOW()
      const fy = fyStart(now)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const subs = db.subscriptions.filter((s) => s.amount > 0)
      const net = subs.reduce((s, x) => s + x.amount, 0)
      const fyRev = subs.filter((s) => new Date(s.paidAt) >= fy).reduce((s, x) => s + x.amount, 0)
      const monthRev = subs.filter((s) => new Date(s.paidAt) >= monthStart).reduce((s, x) => s + x.amount, 0)
      const orgRows = db.organisations.map((o) => {
        const sub = db.subscriptions.find((s) => s.organizationId === o.id && s.amount > 0)
        const ps = planSummary(o, db.subscriptions)
        const thisMonth = sub && new Date(sub.paidAt) >= monthStart ? sub.amount : 0
        const inFy = sub && new Date(sub.paidAt) >= fy ? sub.amount : 0
        return {
          id: o.id, name: o.name, email: o.email, plan: ps.planName, planStatus: ps.status,
          expiry: ps.endDate, daysLeft: ps.daysLeft, revenue: sub ? sub.amount : 0,
          revenueThisMonth: thisMonth, revenueFY: inFy,
        }
      })
      return {
        status: 200,
        data: {
          net, fyRevenue: fyRev, monthRevenue: monthRev,
          monthWise: subRevenueSeries(db, 12).map((m) => ({ ...m, label: monthLabelOf(m.key) })),
          quarterWise: quarterSeries(db, now.getFullYear()),
          orgs: orgRows,
          yearOptions: [2026, 2025],
        },
      }
    }

    if (p2 === 'organisations' && method === 'GET') {
      authed(PERMS.PLATFORM_ORGS_VIEW)
      const q = url.searchParams
      let rows = db.organisations.map((o) => {
        const ps = planSummary(o, db.subscriptions)
        const devices = db.devices.filter((d) => d.organizationId === o.id)
        const events = db.events.filter((e) => e.organizationId === o.id)
        return {
          ...o,
          planStatus: ps.status, planName: ps.planName,
          planExpiry: ps.endDate, planDaysLeft: ps.daysLeft,
          devices: devices.length,
          onlineDevices: devices.filter(computeDeviceOnline).length,
          activeEvents: events.filter((e) => computeEventStatus(e) === 'active').length,
          totalEvents: events.length,
        }
      })
      if (q.get('status')) rows = rows.filter((r) => r.planStatus === q.get('status'))
      if (q.get('plan')) rows = rows.filter((r) => r.plan === q.get('plan'))
      if (q.get('search')) {
        const s = q.get('search').toLowerCase()
        rows = rows.filter((r) => r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || r.ownerName.toLowerCase().includes(s))
      }
      return { status: 200, data: paginated(rows, { page: q.get('page'), limit: q.get('limit') || 25 }) }
    }

    if (p2 === 'organisations' && p3 && method === 'GET') {
      authed(PERMS.PLATFORM_ORGS_VIEW)
      const o = db.organisations.find((x) => x.id === p3)
      if (!o) throw new ApiError(404, 'Organisation not found.')
      const ps = planSummary(o, db.subscriptions)
      const devices = db.devices.filter((d) => d.organizationId === o.id).map((d) => ({ ...d, online: computeDeviceOnline(d) }))
      const events = db.events.filter((e) => e.organizationId === o.id).map((e) => ({ ...e, status: computeEventStatus(e) }))
      const sub = db.subscriptions.find((s) => s.organizationId === o.id)
      const rev = revenueAgg(db, o.id)
      return { status: 200, data: { ...o, plan: ps, subscription: sub || null, devices, events, revenue: rev } }
    }

    if (p2 === 'organisations' && p3 && parts[3] && method === 'POST') {
      authed(PERMS.PLATFORM_ORG_SUSPEND)
      const o = db.organisations.find((x) => x.id === p3)
      if (!o) throw new ApiError(404, 'Organisation not found.')
      const action = parts[3]
      const reason = String((body && body.reason) || '').trim()
      if (action === 'suspend') {
        if (!reason) throw new ApiError(400, 'A reason is required to suspend an organisation.')
        o.status = 'suspended'
        o.suspendReason = reason
        logAudit(db, { actorId: user.id, action: 'platform.organisation.suspended', entity: 'organisation', summary: `Organisation “${o.name}” suspended — ${reason}`, organizationId: o.id, severity: 'warn' })
      } else if (action === 'ban') {
        if (!reason) throw new ApiError(400, 'A reason is required to ban an organisation.')
        o.status = 'banned'
        o.suspendReason = reason
        logAudit(db, { actorId: user.id, action: 'platform.organisation.banned', entity: 'organisation', summary: `Organisation “${o.name}” banned — ${reason}`, organizationId: o.id, severity: 'danger' })
      } else if (action === 'restore') {
        o.status = 'active'
        o.suspendReason = null
        logAudit(db, { actorId: user.id, action: 'platform.organisation.restored', entity: 'organisation', summary: `Organisation “${o.name}” restored`, organizationId: o.id })
      } else throw new ApiError(404, 'Unknown action.')
      persist()
      return { status: 200, data: { ok: true, organisation: o } }
    }

    if (p2 === 'audit' && method === 'GET') {
      authed(PERMS.PLATFORM_AUDIT_VIEW)
      const q = url.searchParams
      let rows = db.audit.filter((a) => !a.organizationId) // platform scope
      if (q.get('from')) rows = rows.filter((a) => new Date(a.at) >= new Date(q.get('from')))
      if (q.get('to')) rows = rows.filter((a) => new Date(a.at) <= new Date(q.get('to') + 'T23:59:59'))
      if (q.get('action')) rows = rows.filter((a) => a.action.includes(q.get('action')))
      if (q.get('actor')) {
        const u = db.users.find((x) => x.id === q.get('actor'))
        rows = rows.filter((a) => a.actorId === (u ? u.id : q.get('actor')))
      }
      return {
        status: 200,
        data: {
          ...paginated(rows, { page: q.get('page'), limit: q.get('limit') || 20 }),
          actors: db.users.filter((u) => !u.organizationId),
        },
      }
    }

    if (p2 === 'users' && !p3) {
      if (method === 'GET') {
        authed() // any platform role can view the internal team; mutations stay Owner-only
        return { status: 200, data: { users: db.users.filter((u) => !u.organizationId).map(userPublic) } }
      }
      if (method === 'POST') {
        authed(PERMS.PLATFORM_USERS_MANAGE)
        const { name, email, password, role } = body || {}
        if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required.')
        if (![ROLES.PLATFORM_ADMIN, ROLES.SUPPORT_MANAGER].includes(role)) {
          throw new ApiError(400, 'Only Platform Admin and Support Manager accounts can be created from CRM. Owner is a single bootstrap account.')
        }
        if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new ApiError(409, 'A user with this email already exists.')
        const nu = { id: uid('usr'), name, email, password, role, organizationId: null, status: 'active', photoUrl: null, createdAt: NOW().toISOString(), lastLoginAt: null }
        db.users.push(nu)
        logAudit(db, { actorId: user.id, action: 'platform.user.created', entity: 'user', summary: `Internal user ${name} created (${role === ROLES.PLATFORM_ADMIN ? 'Platform Admin' : 'Support Manager'})` })
        persist()
        return { status: 201, data: { user: userPublic(nu) } }
      }
    }
    if (p2 === 'users' && p3 && method === 'PUT') {
      authed(PERMS.PLATFORM_USERS_MANAGE)
      const u = db.users.find((x) => x.id === p3 && !x.organizationId)
      if (!u) throw new ApiError(404, 'User not found.')
      if (body.name) u.name = body.name
      if (body.email) u.email = body.email
      if (body.status) u.status = body.status
      logAudit(db, { actorId: user.id, action: 'platform.user.updated', entity: 'user', summary: `Internal user ${u.name} updated`, severity: u.status === 'inactive' ? 'warn' : 'info' })
      persist()
      return { status: 200, data: { user: userPublic(u) } }
    }
    if (p2 === 'users' && p3 && parts[3] === 'reset-password' && method === 'POST') {
      authed(PERMS.PLATFORM_USERS_MANAGE)
      const u = db.users.find((x) => x.id === p3 && !x.organizationId)
      if (!u) throw new ApiError(404, 'User not found.')
      const temp = 'Hap' + Math.random().toString(36).slice(2, 10)
      u.password = temp
      logAudit(db, { actorId: user.id, action: 'platform.user.password_reset', entity: 'user', summary: `Password reset for ${u.name}`, severity: 'warn' })
      persist()
      return { status: 200, data: { tempPassword: temp } }
    }

    if (p2 === 'templates') {
      if (!p3 && method === 'GET') {
        authed(roleHasPermission(user.role, PERMS.GLOBAL_TEMPLATES_MANAGE) ? null : PERMS.GLOBAL_TEMPLATES_USE)
        return { status: 200, data: { templates: db.templates } }
      }
      if (!p3 && method === 'POST') {
        authed(PERMS.GLOBAL_TEMPLATES_MANAGE)
        // Template creation (v2, same flow as the original HappyPix CRM):
        //   name + category + design scope (universal | specific)
        //   specific → orientation + slot count → photoSlots computed
        //   server-side from the Architecture V1 engine (clients never
        //   send coordinates). Manual uploads carry a background image;
        //   AI-generated templates are saved after preview approval.
        const { name, description, category, imageScope, orientation, slotCount, backgroundUrl, status } = body || {}
        if (!name || !String(name).trim()) throw new ApiError(400, 'Template name is required.')
        const scope = imageScope === 'general' ? 'general' : 'specific'
        let layout = null
        if (scope === 'specific') {
          if (!ORIENTATIONS.includes(orientation)) throw new ApiError(400, 'Orientation must be portrait, landscape, strip or square.')
          if (!SLOT_COUNTS.includes(Number(slotCount))) throw new ApiError(400, 'Photo slots must be one of 1, 2, 3, 4, 6.')
          layout = slotsFor(orientation, Number(slotCount))
        }
        const t = {
          id: uid('tpl'),
          name: String(name).trim(),
          description: description || '',
          category: category || 'Custom',
          imageScope: scope,
          orientation: scope === 'specific' ? orientation : 'universal',
          slotCount: scope === 'specific' ? Number(slotCount) : 0,
          canvas: scope === 'specific' ? layout.canvas : { width: 1200, height: 1800 },
          photoSlots: scope === 'specific' ? layout.photoSlots : [],
          backgroundUrl: backgroundUrl || null,
          source: body.source === 'ai_generated' ? 'ai_generated' : 'manual',
          status: status || 'published',
          active: true,
          usage: 0,
          createdAt: NOW().toISOString(),
          updatedAt: NOW().toISOString(),
        }
        db.templates.unshift(t)
        logAudit(db, { actorId: user.id, action: 'platform.template.created', entity: 'template', summary: `Global template “${t.name}” created (${t.category}, ${scope === 'specific' ? `${layout.photoSlots.length} slots · ${orientation}` : 'universal background'})` })
        persist()
        return { status: 201, data: { template: t } }
      }
    }
    if (p2 === 'templates' && p3 === 'ai-generate' && method === 'POST') {
      // Mock AI generation — deterministic, returns a DRAFT for preview.
      // The real backend hits the generation service; the client only
      // persists it after the user approves the preview.
      authed(PERMS.GLOBAL_TEMPLATES_MANAGE)
      const { prompt, imageScope, orientation, slotCount } = body || {}
      if (!prompt || !String(prompt).trim()) throw new ApiError(400, 'A prompt is required.')
      const scope = imageScope === 'general' ? 'general' : 'specific'
      let layout = null
      if (scope === 'specific') {
        if (!ORIENTATIONS.includes(orientation)) throw new ApiError(400, 'Orientation must be portrait, landscape, strip or square.')
        if (!SLOT_COUNTS.includes(Number(slotCount))) throw new ApiError(400, 'Photo slots must be one of 1, 2, 3, 4, 6.')
        layout = slotsFor(orientation, Number(slotCount))
      }
      const p = String(prompt).trim().toLowerCase()
      const palettes = [
        ['#5F4CAA', '#3A3170'], ['#EA097F', '#5F4CAA'], ['#3871C1', '#1E3E70'],
        ['#6E1F2A', '#3A3170'], ['#D9B44A', '#8C6D1F'], ['#14532D', '#0B2E1B'],
      ]
      let h = 0
      for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0
      const [c1, c2] = palettes[h % palettes.length]
      const words = String(prompt).trim().split(/\s+/).slice(0, 4).map((w) => w[0].toUpperCase() + w.slice(1))
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="200" cy="240" r="90" fill="rgba(255,255,255,0.14)"/><circle cx="120" cy="440" r="50" fill="rgba(255,255,255,0.1)"/><circle cx="300" cy="480" r="70" fill="rgba(255,255,255,0.08)"/></svg>`
      const draft = {
        name: words.join(' ') || 'AI Design',
        description: `Generated: ${String(prompt).trim()}`,
        category: 'Custom',
        imageScope: scope,
        orientation: scope === 'specific' ? orientation : 'universal',
        slotCount: scope === 'specific' ? Number(slotCount) : 0,
        canvas: scope === 'specific' ? layout.canvas : { width: 1200, height: 1800 },
        photoSlots: scope === 'specific' ? layout.photoSlots : [],
        backgroundUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
        source: 'ai_generated',
        status: 'draft',
      }
      return { status: 200, data: { draft } }
    }
    if (p2 === 'templates' && p3 && p3 !== 'ai-generate' && method === 'PUT') {
      authed(PERMS.GLOBAL_TEMPLATES_MANAGE)
      const t = db.templates.find((x) => x.id === p3)
      if (!t) throw new ApiError(404, 'Template not found.')
      Object.assign(t, pickDefined(body, ['name', 'category', 'description', 'active', 'status']))
      t.updatedAt = NOW().toISOString()
      logAudit(db, { actorId: user.id, action: body.active === false ? 'platform.template.disabled' : 'platform.template.updated', entity: 'template', summary: `Global template “${t.name}” ${body.status === 'published' && t.status === 'draft' ? 'saved from AI preview' : 'updated'}` })
      persist()
      return { status: 200, data: { template: t } }
    }
    if (p2 === 'templates' && p3 && p3 !== 'ai-generate' && method === 'DELETE') {
      authed(PERMS.GLOBAL_TEMPLATES_MANAGE)
      const t = db.templates.find((x) => x.id === p3)
      if (!t) throw new ApiError(404, 'Template not found.')
      const used = db.events.some((e) => (e.templateIds || []).includes(t.id))
      if (used) throw new ApiError(409, 'This template is used by events. Disable it instead of deleting.')
      db.templates = db.templates.filter((x) => x.id !== p3)
      logAudit(db, { actorId: user.id, action: 'platform.template.deleted', entity: 'template', summary: `Global template “${t.name}” deleted`, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }

    // ---------------- Frames (platform catalogue; Owner adds/removes) ----------------
    if (p2 === 'frames' && !p3) {
      if (method === 'GET') {
        authed()
        return { status: 200, data: { frames: db.frames.map((f) => ({ ...f, enabledOrgs: frameUsage(db, f.id) })) } }
      }
      if (method === 'POST') {
        if (user.role !== ROLES.OWNER) throw new ApiError(403, 'Only the Owner can modify the frame catalogue.')
        const { name, background, defaultPrice } = body || {}
        if (!name || !String(name).trim()) throw new ApiError(400, 'Frame name is required.')
        if (!background || !background.type || !(background.colors || []).length) throw new ApiError(400, 'Background type and colours are required.')
        if (db.frames.some((f) => f.name.toLowerCase() === String(name).trim().toLowerCase())) throw new ApiError(409, 'A frame with this name already exists.')
        const f = {
          id: uid('frame'),
          name: String(name).trim(),
          description: body.description || 'Custom frame added by the platform.',
          background: {
            type: background.type === 'gradient' ? 'gradient' : 'solid',
            colors: background.colors.slice(0, background.type === 'gradient' ? 2 : 1),
            pattern: ['none', 'dots', 'stripes'].includes(background.pattern) ? background.pattern : 'none',
          },
          text: body.text || (background.colors[0] && /^#([0-2]|3[0-9])/i.test(background.colors[0]) ? '#FFFFFF' : '#3A3344'),
          defaultPrice: Math.max(0, Number(defaultPrice) || 0),
        }
        db.frames.push(f)
        logAudit(db, { actorId: user.id, action: 'platform.frame.created', entity: 'frame', summary: `Frame “${f.name}” added to the catalogue` })
        persist()
        return { status: 201, data: { frame: f } }
      }
    }
    if (p2 === 'frames' && p3 && method === 'DELETE') {
      if (user.role !== ROLES.OWNER) throw new ApiError(403, 'Only the Owner can modify the frame catalogue.')
      const f = db.frames.find((x) => x.id === p3)
      if (!f) throw new ApiError(404, 'Frame not found.')
      const enabled = frameUsage(db, f.id)
      if (enabled > 0) throw new ApiError(409, `Frame is enabled at ${enabled} organisation(s). Disable it in their Organisation Defaults first.`)
      db.frames = db.frames.filter((x) => x.id !== p3)
      logAudit(db, { actorId: user.id, action: 'platform.frame.deleted', entity: 'frame', summary: `Frame “${f.name}” removed from the catalogue`, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }
  }

  // ================= ORGANISATION =================
  if (p === 'org') {
    const u = authed()
    if (!isOrgRole(u.role)) throw new ApiError(403, 'Organisation APIs require an organisation user.')
    const orgId = u.organizationId
    const org = db.organisations.find((o) => o.id === orgId)
    if (!org) throw new ApiError(404, 'Organisation not found.')
    const ps = planSummary(org, db.subscriptions)
    const orgPlanBlocked = ['suspended', 'banned'].includes(org.status) || ps.status === 'expired'

    if (p2 === 'dashboard' && method === 'GET') {
      authed(PERMS.ORG_DASHBOARD_VIEW)
      const devices = db.devices.filter((d) => d.organizationId === orgId)
      const events = db.events.filter((e) => e.organizationId === orgId).map((e) => ({ ...e, status: computeEventStatus(e) }))
      const tickets = db.tickets.filter((t) => t.organizationId === orgId)
      const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress')
      const warnings = []
      if (ps.status === 'expiring_soon') warnings.push({ kind: 'plan_expiring', text: `Your ${ps.planName} plan expires in ${ps.daysLeft} day(s).`, tone: 'warn' })
      if (ps.status === 'expired') warnings.push({ kind: 'plan_expired', text: 'Your plan has expired. Renew to create new events and register devices.', tone: 'danger' })
      if (devices.length >= ps.deviceLimit) warnings.push({ kind: 'device_limit', text: `Device limit reached (${devices.length}/${ps.deviceLimit}). Upgrade to add more booths.`, tone: 'warn' })
      const activeCount = events.filter((e) => e.status === 'active').length
      if (activeCount >= ps.eventLimit) warnings.push({ kind: 'event_limit', text: `Parallel active event limit reached (${activeCount}/${ps.eventLimit}).`, tone: 'warn' })
      const offline = devices.filter((d) => !computeDeviceOnline(d))
      if (org.status !== 'suspended' && org.status !== 'banned' && offline.length) warnings.push({ kind: 'booth_offline', text: `${offline.length} booth(s) currently offline.`, tone: 'info' })
      if (orgPlanBlocked) warnings.push({ kind: 'org_blocked', text: org.status === 'banned' ? 'Your organisation access is currently banned. Contact HappyPix support.' : 'Your organisation is suspended. Contact HappyPix support.', tone: 'danger' })

      const data = {
        organisation: { id: org.id, name: org.name, ownerName: org.ownerName, email: org.email },
        plan: ps,
        usage: {
          devicesUsed: devices.length, deviceLimit: ps.deviceLimit,
          eventsUsed: activeCount, eventLimit: ps.eventLimit,
        },
        devices: { total: devices.length, online: devices.length - offline.length, offline: offline.length },
        events: {
          active: events.filter((e) => e.status === 'active'),
          upcoming: events.filter((e) => e.status === 'upcoming'),
          finished: events.filter((e) => e.status === 'finished').slice(0, 3),
          paused: events.filter((e) => e.status === 'paused'),
        },
        tickets: { open: openTickets.length, list: openTickets.slice(0, 5) },
        warnings,
      }
      if (u.role === ROLES.ORG_ADMIN) {
        const rev = revenueAgg(db, orgId)
        const now = NOW()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        data.revenue = {
          total: rev.total,
          thisMonth: db.payments.filter((x) => x.organizationId === orgId && x.status === 'paid' && new Date(x.createdAt) >= monthStart).reduce((s, x) => s + x.amount, 0),
        }
      }
      return { status: 200, data }
    }

    if (p2 === 'revenue' && method === 'GET') {
      authed(PERMS.ORG_REVENUE_VIEW)
      const q = url.searchParams
      const now = NOW()
      const fy = fyStart(now)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const all = revenueAgg(db, orgId)
      const byEvent = db.events
        .filter((e) => e.organizationId === orgId)
        .map((e) => {
          const r = revenueAgg(db, orgId, { eventId: e.id })
          return { id: e.id, name: e.name, status: computeEventStatus(e), ...r }
        })
        .sort((a, b) => b.total - a.total)
      const byDevice = db.devices
        .filter((d) => d.organizationId === orgId)
        .map((d) => {
          const r = revenueAgg(db, orgId, { deviceId: d.id })
          return { id: d.id, name: d.deviceName, online: computeDeviceOnline(d), ...r }
        })
        .sort((a, b) => b.total - a.total)
      return {
        status: 200,
        data: {
          total: all.total,
          thisMonth: db.payments.filter((x) => x.organizationId === orgId && x.status === 'paid' && new Date(x.createdAt) >= monthStart).reduce((s, x) => s + x.amount, 0),
          fy: db.payments.filter((x) => x.organizationId === orgId && x.status === 'paid' && new Date(x.createdAt) >= fy).reduce((s, x) => s + x.amount, 0),
          byEvent, byDevice,
          byStatus: {
            paid: db.payments.filter((x) => x.organizationId === orgId && x.status === 'paid').length,
            pending: db.payments.filter((x) => x.organizationId === orgId && x.status === 'pending').length,
            failed: db.payments.filter((x) => x.organizationId === orgId && x.status === 'failed').length,
          },
          monthWise: monthSeries(db, orgId, 8).map((m) => ({ ...m, label: monthLabelOf(m.key) })),
          events: db.events.filter((e) => e.organizationId === orgId).map((e) => ({ id: e.id, name: e.name })),
          devices: db.devices.filter((d) => d.organizationId === orgId).map((d) => ({ id: d.id, name: d.deviceName })),
          filters: { from: q.get('from'), to: q.get('to'), eventId: q.get('eventId'), deviceId: q.get('deviceId') },
        },
      }
    }

    if (p2 === 'events' && !p3) {
      if (method === 'GET') {
        authed(PERMS.EVENTS_DEVICES_MANAGE)
        const q = url.searchParams
        let events = db.events.filter((e) => e.organizationId === orgId).map((e) => {
          const assigned = db.devices.filter((d) => d.assignedEventId === e.id).map((d) => ({ id: d.id, name: d.deviceName, online: computeDeviceOnline(d) }))
          return { ...e, status: computeEventStatus(e), assignedDevices: assigned, deviceCount: assigned.length }
        })
        if (q.get('status')) events = events.filter((e) => e.status === q.get('status'))
        if (q.get('search')) events = events.filter((e) => e.name.toLowerCase().includes(q.get('search').toLowerCase()) || (e.location || '').toLowerCase().includes(q.get('search').toLowerCase()))
        events.sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
        return { status: 200, data: { events, canCreate: !orgPlanBlocked && events.filter((e) => e.status === 'active').length < ps.eventLimit } }
      }
      if (method === 'POST') {
        authed(PERMS.EVENT_CREATE)
        // v2 event creation — General + Customisation + Branding.
        // There is NO price and NO passkey here: print pricing lives in
        // Organisation Defaults (per frame), and booth access is via the
        // booth app, not a CRM-entered passkey.
        const { name, location, clientName, startDate, endDate, digitalCopy, filters, templateIds, branding } = body || {}
        if (!name || !startDate || !endDate) throw new ApiError(400, 'Event name, start and end are required.')
        if (new Date(startDate) >= new Date(endDate)) throw new ApiError(400, 'End time must be after start time.')
        if (orgPlanBlocked) throw new ApiError(403, org.status === 'expired' || ps.status === 'expired' ? 'Plan expired — renew your plan to create events.' : 'Organisation is ' + org.status + ' — new events are blocked.')
        const active = db.events.filter((e) => e.organizationId === orgId && computeEventStatus(e) === 'active').length
        if (active >= ps.eventLimit) throw new ApiError(403, `Your ${ps.planName} plan allows a maximum of ${ps.eventLimit} parallel active event(s).`)
        const tids = Array.isArray(templateIds) ? templateIds : []
        for (const tid of tids) {
          const tpl = db.templates.find((t) => t.id === tid)
          if (!tpl) throw new ApiError(400, 'A selected template does not exist.')
          if (!tpl.active) throw new ApiError(400, `Template “${tpl.name}” is disabled by the platform.`)
        }
        const fids = Array.isArray(filters) ? filters : []
        for (const fid of fids) {
          if (!FILTERS.some((f) => f.id === fid)) throw new ApiError(400, `Unknown photo filter “${fid}”.`)
        }
        const ev = {
          id: uid('evt'), organizationId: orgId, name: String(name).trim(),
          location: location || '', clientName: clientName || '',
          startDate, endDate, paused: false,
          templateIds: tids,
          filters: fids,
          digitalCopy: !!digitalCopy,
          branding: { logoUrl: (branding && branding.logoUrl) || null, tagline: (branding && branding.tagline) || '' },
          shortCode: name.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, '') + String(Math.floor(10 + Math.random() * 90)),
          createdAt: NOW().toISOString(),
        }
        db.events.push(ev)
        logAudit(db, { actorId: u.id, action: 'event.created', entity: 'event', summary: `Event “${ev.name}” created (${tids.length} template(s), digital copy ${ev.digitalCopy ? 'on' : 'off'})`, organizationId: orgId })
        persist()
        return { status: 201, data: { event: { ...ev, status: computeEventStatus(ev), assignedDevices: [] } } }
      }
    }
    if (p2 === 'events' && p3 && method === 'PUT') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const e = db.events.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!e) throw new ApiError(404, 'Event not found.')
      for (const tid of (body && body.templateIds) || []) {
        const tpl = db.templates.find((t) => t.id === tid)
        if (!tpl) throw new ApiError(400, 'A selected template does not exist.')
        if (!tpl.active) throw new ApiError(400, `Template “${tpl.name}” is disabled by the platform.`)
      }
      for (const fid of (body && body.filters) || []) {
        if (!FILTERS.some((f) => f.id === fid)) throw new ApiError(400, `Unknown photo filter “${fid}”.`)
      }
      Object.assign(e, pickDefined(body, ['name', 'location', 'clientName', 'startDate', 'endDate', 'templateIds', 'filters', 'digitalCopy', 'branding']))
      logAudit(db, { actorId: u.id, action: 'event.updated', entity: 'event', summary: `Event “${e.name}” updated`, organizationId: orgId })
      persist()
      return { status: 200, data: { event: e } }
    }
    if (p2 === 'events' && p3 && parts[3] === 'pause' && method === 'POST') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const e = db.events.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!e) throw new ApiError(404, 'Event not found.')
      e.paused = true
      logAudit(db, { actorId: u.id, action: 'event.paused', entity: 'event', summary: `Event “${e.name}” paused`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'events' && p3 && parts[3] === 'resume' && method === 'POST') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const e = db.events.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!e) throw new ApiError(404, 'Event not found.')
      e.paused = false
      logAudit(db, { actorId: u.id, action: 'event.resumed', entity: 'event', summary: `Event “${e.name}” resumed`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'events' && p3 && method === 'DELETE') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const e = db.events.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!e) throw new ApiError(404, 'Event not found.')
      if (computeEventStatus(e) === 'active') throw new ApiError(409, 'Pause the event before deleting it.')
      db.events = db.events.filter((x) => x.id !== p3)
      db.devices.forEach((d) => { if (d.assignedEventId === p3) d.assignedEventId = null })
      db.coupons.forEach((c) => { c.eventIds = (c.eventIds || []).filter((id) => id !== p3) })
      logAudit(db, { actorId: u.id, action: 'event.deleted', entity: 'event', summary: `Event “${e.name}” deleted`, organizationId: orgId, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }

    if (p2 === 'devices') {
      if (method === 'GET') {
        authed(PERMS.EVENTS_DEVICES_MANAGE)
        const devices = db.devices.filter((d) => d.organizationId === orgId).map((d) => {
          const ev = d.assignedEventId ? db.events.find((e) => e.id === d.assignedEventId) : null
          return { ...d, online: computeDeviceOnline(d), assignedEvent: ev ? { id: ev.id, name: ev.name, status: computeEventStatus(ev) } : null }
        })
        return { status: 200, data: { devices, limit: { used: devices.length, allowed: ps.deviceLimit }, canRegister: !orgPlanBlocked && devices.length < ps.deviceLimit } }
      }
    }
    if (p2 === 'devices' && p3 && parts[3] === 'assign' && method === 'POST') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const d = db.devices.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!d) throw new ApiError(404, 'Device not found.')
      const ev = db.events.find((e) => e.id === body.eventId && e.organizationId === orgId)
      if (!ev) throw new ApiError(404, 'Event not found.')
      const st = computeEventStatus(ev)
      if (st === 'finished') throw new ApiError(409, 'Cannot assign a finished event to a device.')
      d.assignedEventId = ev.id
      logAudit(db, { actorId: u.id, action: 'event.assigned_to_device', entity: 'event', summary: `Event “${ev.name}” assigned to ${d.deviceName}`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'devices' && p3 && parts[3] === 'unassign' && method === 'POST') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const d = db.devices.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!d) throw new ApiError(404, 'Device not found.')
      const evName = d.assignedEventId ? db.events.find((e) => e.id === d.assignedEventId)?.name : null
      d.assignedEventId = null
      logAudit(db, { actorId: u.id, action: 'event.unassigned_from_device', entity: 'event', summary: `Event ${evName ? `“${evName}”` : 'assignment'} removed from ${d.deviceName}`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'devices' && p3 && method === 'DELETE') {
      authed(PERMS.EVENTS_DEVICES_MANAGE)
      const d = db.devices.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!d) throw new ApiError(404, 'Device not found.')
      db.devices = db.devices.filter((x) => x.id !== p3)
      logAudit(db, { actorId: u.id, action: 'device.removed', entity: 'device', summary: `Device “${d.deviceName}” removed`, organizationId: orgId, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }

    if (p2 === 'tickets' && !p3) {
      if (method === 'GET') {
        authed(PERMS.TICKETS_RESOLVE)
        const q = url.searchParams
        let tix = db.tickets.filter((t) => t.organizationId === orgId)
        if (q.get('status')) tix = tix.filter((t) => t.status === q.get('status'))
        if (q.get('priority')) tix = tix.filter((t) => t.priority === q.get('priority'))
        tix = tix.map(withTicketRefs)
        tix.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
        db.tickets.filter((t) => t.organizationId === orgId).forEach((t) => { counts[t.status]++ })
        return { status: 200, data: { tickets: tix, counts } }
      }
    }
    if (p2 === 'tickets' && p3 && method === 'GET') {
      authed(PERMS.TICKETS_RESOLVE)
      const t = db.tickets.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!t) throw new ApiError(404, 'Ticket not found.')
      return { status: 200, data: { ticket: withTicketRefs(t) } }
    }
    if (p2 === 'tickets' && p3 && parts[3] === 'reply' && method === 'POST') {
      authed(PERMS.TICKETS_RESOLVE)
      const t = db.tickets.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!t) throw new ApiError(404, 'Ticket not found.')
      if (!String((body && body.message) || '').trim()) throw new ApiError(400, 'Message cannot be empty.')
      const roleLabel = u.role === ROLES.ORG_ADMIN ? 'Organisation Admin' : 'Organisation Manager'
      t.messages.push({ id: uid('m'), author: `${u.name} (${roleLabel})`, at: NOW().toISOString(), text: String(body.message).trim() })
      if (t.status === 'open') t.status = 'in_progress'
      t.updatedAt = NOW().toISOString()
      persist()
      return { status: 200, data: { ticket: withTicketRefs(t) } }
    }
    if (p2 === 'tickets' && p3 && parts[3] === 'resolve' && method === 'POST') {
      authed(PERMS.TICKETS_RESOLVE)
      const t = db.tickets.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!t) throw new ApiError(404, 'Ticket not found.')
      t.status = 'resolved'
      t.resolution = String((body && body.note) || t.resolution || 'Resolved by organisation team.')
      t.updatedAt = NOW().toISOString()
      logAudit(db, { actorId: u.id, action: 'ticket.resolved', entity: 'ticket', summary: `Ticket “${t.subject}” resolved`, organizationId: orgId })
      persist()
      return { status: 200, data: { ticket: withTicketRefs(t) } }
    }
    if (p2 === 'tickets' && p3 && parts[3] === 'reopen' && method === 'POST') {
      authed(PERMS.TICKETS_RESOLVE)
      const t = db.tickets.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!t) throw new ApiError(404, 'Ticket not found.')
      t.status = 'open'
      t.updatedAt = NOW().toISOString()
      persist()
      return { status: 200, data: { ticket: withTicketRefs(t) } }
    }

    if (p2 === 'defaults') {
      // Frames are always presented as the FULL platform catalogue:
      // entries saved by the org override price/allowed; catalogue frames
      // the org has never touched appear disabled at the suggested price.
      const fullFrames = (saved) => {
        const list = saved && Array.isArray(saved.frames) ? saved.frames : []
        return db.frames.map((f) => {
          const entry = list.find((x) => x.frameId === f.id)
          if (entry) return { frameId: f.id, price: Math.max(0, Number(entry.price) || 0), allowed: !!entry.allowed }
          return { frameId: f.id, price: f.defaultPrice, allowed: false }
        })
      }
      if (method === 'GET') {
        authed(PERMS.DEFAULTS_VIEW)
        const saved = db.orgDefaults[orgId]
        return {
          status: 200,
          data: {
            name: (saved && saved.name) || org.name,
            logoUrl: (saved && saved.logoUrl) || null,
            boothTimeoutSec: (saved && saved.boothTimeoutSec) || 600,
            frames: fullFrames(saved),
          },
        }
      }
      if (method === 'PUT') {
        authed(PERMS.DEFAULTS_EDIT)
        const saved = db.orgDefaults[orgId] || {}
        const cur = {
          name: saved.name || org.name,
          logoUrl: saved.logoUrl || null,
          boothTimeoutSec: saved.boothTimeoutSec || 600,
          frames: fullFrames(saved),
        }
        if (body.name) { cur.name = String(body.name).trim(); org.name = cur.name }
        if (body.logoUrl != null) cur.logoUrl = body.logoUrl
        if (body.boothTimeoutSec != null) {
          const sec = Number(body.boothTimeoutSec)
          if (!Number.isFinite(sec) || sec < 10 || sec > 86400) throw new ApiError(400, 'Booth idle timeout must be between 10 and 86400 seconds.')
          cur.boothTimeoutSec = sec
        }
        if (Array.isArray(body.frames)) {
          // frame ids must exist in the platform catalogue; price >= 0.
          // Frames the org did not send are kept (unseen frames stay disabled).
          const sent = body.frames.map((f) => {
            const meta = db.frames.find((x) => x.id === f.frameId)
            if (!meta) throw new ApiError(400, `Frame “${f.frameId}” does not exist.`)
            return { frameId: f.frameId, price: Math.max(0, Number(f.price) || 0), allowed: !!f.allowed }
          })
          cur.frames = fullFrames({ frames: sent.concat(cur.frames.filter((x) => !sent.some((s) => s.frameId === x.frameId))) })
        }
        db.orgDefaults[orgId] = cur
        logAudit(db, { actorId: u.id, action: 'organisation.defaults.updated', entity: 'organisation', summary: `Organisation defaults updated for ${org.name}`, organizationId: orgId })
        persist()
        return { status: 200, data: cur }
      }
    }

    if (p2 === 'coupons' && !p3) {
      if (method === 'GET') {
        authed(PERMS.COUPONS_MANAGE)
        const rows = db.coupons
          .filter((c) => c.organizationId === orgId)
          .map((c) => ({ ...c, events: (c.eventIds || []).map((id) => { const e = db.events.find((x) => x.id === id); return e ? { id, name: e.name } : null }).filter(Boolean), isExhausted: c.usedCount >= c.quantity, expired: new Date(c.expiryDate) < NOW() }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        return { status: 200, data: { coupons: rows, events: db.events.filter((e) => e.organizationId === orgId).map((e) => ({ id: e.id, name: e.name })) } }
      }
      if (method === 'POST') {
        authed(PERMS.COUPONS_MANAGE)
        const { type, value, quantity, expiryDate, eventIds } = body || {}
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (!code || !type || !value || !quantity || !expiryDate) throw new ApiError(400, 'Code, discount, quantity and expiry are required.')
        if (type === 'percentage' && (value <= 0 || value > 100)) throw new ApiError(400, 'Percentage must be between 1 and 100.')
        if (type === 'fixed' && value <= 0) throw new ApiError(400, 'Fixed discount must be positive.')
        if (db.coupons.some((c) => c.organizationId === orgId && c.code.toLowerCase() === code.toLowerCase())) throw new ApiError(409, 'A coupon with this code already exists.')
        const c = { id: uid('cup'), organizationId: orgId, code: code.toUpperCase(), type, value, quantity, usedCount: 0, expiryDate, eventIds: eventIds || [], status: 'active', createdAt: NOW().toISOString(), updatedAt: NOW().toISOString() }
        db.coupons.push(c)
        logAudit(db, { actorId: u.id, action: 'coupon.created', entity: 'coupon', summary: `Coupon ${c.code} created (${type === 'percentage' ? c.value + '%' : '₹' + c.value} off, ${c.quantity} uses)`, organizationId: orgId })
        persist()
        return { status: 201, data: { coupon: c } }
      }
    }
    if (p2 === 'coupons' && p3 && method === 'PUT') {
      authed(PERMS.COUPONS_MANAGE)
      const c = db.coupons.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!c) throw new ApiError(404, 'Coupon not found.')
      Object.assign(c, pickDefined(body, ['code', 'type', 'value', 'quantity', 'expiryDate', 'eventIds']))
      c.updatedAt = NOW().toISOString()
      logAudit(db, { actorId: u.id, action: 'coupon.updated', entity: 'coupon', summary: `Coupon ${c.code} updated`, organizationId: orgId })
      persist()
      return { status: 200, data: { coupon: c } }
    }
    if (p2 === 'coupons' && p3 && parts[3] === 'pause' && method === 'POST') {
      authed(PERMS.COUPONS_MANAGE)
      const c = db.coupons.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!c) throw new ApiError(404, 'Coupon not found.')
      c.status = 'paused'
      logAudit(db, { actorId: u.id, action: 'coupon.paused', entity: 'coupon', summary: `Coupon ${c.code} paused`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'coupons' && p3 && parts[3] === 'activate' && method === 'POST') {
      authed(PERMS.COUPONS_MANAGE)
      const c = db.coupons.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!c) throw new ApiError(404, 'Coupon not found.')
      c.status = 'active'
      logAudit(db, { actorId: u.id, action: 'coupon.updated', entity: 'coupon', summary: `Coupon ${c.code} re-activated`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'coupons' && p3 && method === 'DELETE') {
      authed(PERMS.COUPONS_MANAGE)
      const c = db.coupons.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!c) throw new ApiError(404, 'Coupon not found.')
      db.coupons = db.coupons.filter((x) => x.id !== p3)
      logAudit(db, { actorId: u.id, action: 'coupon.deleted', entity: 'coupon', summary: `Coupon ${c.code} deleted`, organizationId: orgId, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }

    if (p2 === 'team' && !p3) {
      if (method === 'GET') {
        authed()
        const members = db.users.filter((x) => x.organizationId === orgId).map((x) => ({ ...userPublic(x), roleLabel: x.role }))
        return { status: 200, data: { members, canManage: u.role === ROLES.ORG_ADMIN } }
      }
      if (method === 'POST') {
        authed(PERMS.ORG_TEAM_MANAGE)
        const { name, email, password } = body || {}
        if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required.')
        if (db.users.some((x) => x.email.toLowerCase() === email.toLowerCase())) throw new ApiError(409, 'A user with this email already exists.')
        // Role is server-selected: ORG_MANAGER. The client can never pick it.
        const nu = { id: uid('usr'), name, email, password, role: ROLES.ORG_MANAGER, organizationId: orgId, status: 'active', photoUrl: null, createdAt: NOW().toISOString(), lastLoginAt: null }
        db.users.push(nu)
        logAudit(db, { actorId: u.id, action: 'organisation.team.created', entity: 'user', summary: `Organisation Manager ${name} created`, organizationId: orgId })
        persist()
        return { status: 201, data: { user: userPublic(nu) } }
      }
    }
    if (p2 === 'team' && p3 && method === 'PUT') {
      authed(PERMS.ORG_TEAM_MANAGE)
      const m = db.users.find((x) => x.id === p3 && x.organizationId === orgId && x.role === ROLES.ORG_MANAGER)
      if (!m) throw new ApiError(404, 'Team member not found.')
      if (body.name) m.name = body.name
      if (body.email) m.email = body.email
      logAudit(db, { actorId: u.id, action: 'organisation.team.updated', entity: 'user', summary: `Organisation Manager ${m.name} updated`, organizationId: orgId })
      persist()
      return { status: 200, data: { user: userPublic(m) } }
    }
    if (p2 === 'team' && p3 && parts[3] === 'deactivate' && method === 'POST') {
      authed(PERMS.ORG_TEAM_MANAGE)
      const m = db.users.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!m) throw new ApiError(404, 'Team member not found.')
      m.status = 'inactive'
      logAudit(db, { actorId: u.id, action: 'organisation.team.deactivated', entity: 'user', summary: `Organisation Manager ${m.name} deactivated`, organizationId: orgId, severity: 'warn' })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'team' && p3 && parts[3] === 'activate' && method === 'POST') {
      authed(PERMS.ORG_TEAM_MANAGE)
      const m = db.users.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!m) throw new ApiError(404, 'Team member not found.')
      m.status = 'active'
      logAudit(db, { actorId: u.id, action: 'organisation.team.updated', entity: 'user', summary: `Organisation Manager ${m.name} re-activated`, organizationId: orgId })
      persist()
      return { status: 200, data: { ok: true } }
    }
    if (p2 === 'team' && p3 && parts[3] === 'reset-password' && method === 'POST') {
      authed(PERMS.ORG_TEAM_MANAGE)
      const m = db.users.find((x) => x.id === p3 && x.organizationId === orgId)
      if (!m) throw new ApiError(404, 'Team member not found.')
      const temp = 'Hap' + Math.random().toString(36).slice(2, 10)
      m.password = temp
      logAudit(db, { actorId: u.id, action: 'organisation.team.password_reset', entity: 'user', summary: `Password reset for ${m.name}`, organizationId: orgId, severity: 'warn' })
      persist()
      return { status: 200, data: { tempPassword: temp } }
    }

    if (p2 === 'audit' && method === 'GET') {
      authed(PERMS.ORG_AUDIT_VIEW)
      const q = url.searchParams
      let rows = db.audit.filter((a) => a.organizationId === orgId)
      if (q.get('from')) rows = rows.filter((a) => new Date(a.at) >= new Date(q.get('from')))
      if (q.get('to')) rows = rows.filter((a) => new Date(a.at) <= new Date(q.get('to') + 'T23:59:59'))
      if (q.get('action')) rows = rows.filter((a) => a.action.includes(q.get('action')))
      const actors = db.users.filter((x) => x.organizationId === orgId)
      return { status: 200, data: { ...paginated(rows, { page: q.get('page'), limit: q.get('limit') || 20 }), actors } }
    }
  }

  throw new ApiError(404, `No route: ${method} ${path}`)

  function withTicketRefs(t) {
    const ev = t.eventId ? db.events.find((e) => e.id === t.eventId) : null
    const dev = t.deviceId ? db.devices.find((d) => d.id === t.deviceId) : null
    return {
      ...t,
      event: ev ? { id: ev.id, name: ev.name } : null,
      device: dev ? { id: dev.id, name: dev.deviceName } : null,
    }
  }
}

function pickDefined(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

function monthLabelOf(key) {
  const [y, m] = key.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${String(y).slice(2)}`
}

function quarterSeries(db, year) {
  const out = []
  for (let q = 1; q <= 4; q++) {
    const start = new Date(year, (q - 1) * 3, 1)
    const end = new Date(year, q * 3, 1)
    const v = db.subscriptions
      .filter((s) => s.paidAt && s.amount > 0)
      .filter((s) => { const d = new Date(s.paidAt); return d >= start && d < end })
      .reduce((sum, s) => sum + s.amount, 0)
    out.push({ key: `Q${q}`, label: `Q${q} ${String(year).slice(2)}`, value: v })
  }
  return out
}
