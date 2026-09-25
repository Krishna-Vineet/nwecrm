# Backend changes required for CRM v2

CRM v2 (this repo) is built against a **v2 API contract** (`src/api/mock/server.js` implements
it 1:1, including RBAC, tenancy scoping, plan-limit and suspend/ban rules). The current backend
(see `backend/02-api-reference.md`) does not expose several of these endpoints and needs new
models. Below is exactly what must be added/changed. All routes assume the existing
`Authorization: Bearer <jwt>` auth and the existing `getOrgFilter` tenancy helper (which must
be made fail-closed for internal roles per P0 SEC-03).

Conventions: errors are `{ "error": "message" }` with the status code
(400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict).

---

## 1. New models (Mongo collections)

### `organisationStatus` (lifecycle state)
Stored on the `Organization` document:
```json
{
  "status": "active | suspended | banned",   // default "active"
  "suspendReason": "string | null",
  "suspendedAt": "ISO | null",
  "suspendedBy": "userId"
}
```
- `suspended`: CRM login restricted to a limited "account suspended" view; event creation,
  device registration and pair-unpair blocked.
- `banned`: CRM login fully blocked; booth pairing/connection blocked.
- Restore reverts to `active` and recomputes plan state.

### `trialExtensions` (on `Organization`)
```json
{ "trialExtensionCount": 0 | 1, "trialExtendedUntil": "ISO | null" }
```
Trial ends at `max(originalTrialEnd, trialExtendedUntil)`. A second extension is rejected.

### `Subscription` (new collection — server-owned billing lifecycle, P1)
```json
{
  "id": "ObjectId",
  "organizationId": "ObjectId",
  "plan": "starter | basic | professional | business | custom",
  "amount": 2999,                       // INR paid for this purchase
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_... | null",
  "razorpaySignature": "string | null",
  "invoiceNo": "HAP-INV-2609-000421",
  "startDate": "ISO", "endDate": "ISO",
  "status": "paid | pending | failed",
  "createdBy": "userId", "createdAt": "ISO"
}
```
Plan *status* (trial/active/expiring_soon/expired/…) is **always computed** from this +
`organizationStatus` — never stored as a string.

### `Template` (new collection — global, platform-owned)
```json
{
  "id": "ObjectId",
  "name": "4x6 Duo",
  "category": "Classic",
  "description": "string",
  "imageScope": "general | specific",        // general = universal background, any layout
  "orientation": "portrait | landscape | strip | square | universal",
  "slotCount": 4,                            // 1 | 2 | 3 | 4 | 6 (0 for general)
  "canvas": { "width": 1200, "height": 1800 },
  "photoSlots": [{ "id": "slot-1", "x": 40, "y": 40, "width": 1120, "height": 730 }],
  "backgroundUrl": "https://cdn/.../bg.png | null",   // required in practice for general; optional art for specific
  "source": "manual | ai_generated",
  "status": "draft | published",
  "active": true,                            // disabled templates are not selectable
  "usage": 3,
  "createdBy": "userId", "createdAt": "ISO", "updatedAt": "ISO"
}
```
- `photoSlots` for `specific` templates **must be computed server-side** by the
  Architecture V1 slot engine (canvas grid with the **bottom 15% reserved for the
  branding footer**) — clients never send coordinates. The mock implements the engine in
  `src/lib/templates.js` (33 canonical layouts: 4x6/5x7/6x8 portrait, wide/strip
  landscape, 6x6 square).
- AI generation (`POST /api/platform/templates/ai-generate`) returns an **unsaved draft**
  (`{ draft }`); the client shows it in a preview and only persists it (as
  `source: "ai_generated"`, `status: "published"`) after the user clicks *Save to
  Templates*.
- Only `OWNER` / `PLATFORM_ADMIN` may create/update/delete (Support Manager has no access
  to the template surface). **Events reference `templateIds: [ObjectId]`** (multi-select,
  all active platform templates are shown at event creation).

### `Frame` (new collection — the platform frame catalogue)
```json
{
  "id": "ObjectId",
  "name": "Royal Black",
  "description": "string",
  "background": {
    "type": "solid | gradient",
    "colors": ["#191420"] ,                  // 1 for solid, 2 for gradient
    "pattern": "none | dots | stripes"
  },
  "text": "#FFFFFF",                          // footer/tagline colour on this frame
  "defaultPrice": 60                          // suggested ₹; orgs price freely
}
```
A **frame is the canvas a print is made on**: the background design carries the template's
photo slots, and the complete output print (photos + the 15% branding footer) is printed
on the frame. The catalogue is platform data — **only `OWNER` may add or remove frames**
(`PLATFORM_ADMIN` reads it for the same *Templates & Frames* screen). **A frame cannot be
removed while it is enabled (`allowed: true`) in any organisation's defaults → 409.**
Orgs price each frame and switch booth availability in `OrganizationDefaults`.

### `OrganizationDefaults` (new collection — the single org config doc)
```json
{
  "organizationId": "ObjectId",   // unique
  "name": "Sunset Weddings",
  "logoUrl": "https://cdn/.../logo.png | null",
  "frames": [
    { "frameId": "ObjectId", "price": 50, "allowed": true }
  ],
  "boothTimeoutSec": 600
}
```
- **There is no `printPrice` / `downloadPrice` here and none anywhere in the CRM.** The
  per-frame `price` entries *are* the pricing surface — a guest's print cost is
  `frame.price` (plus any coupon discount computed server-side).
- `boothTimeoutSec` is the kiosk idle timeout, **in seconds** (10–86400).
- This doc stores **only** `allowed` + `price` per frame. The frame catalogue itself is
  platform data (`Frame`); when the backend reads this doc it should **merge in the full
  current catalogue** (frames the org has never touched appear as
  `{ frameId, price: <defaultPrice>, allowed: false }`) so newly added frames show up
  without the org re-saving, and removed frames never surface.

### `Event` (new/changed shape — no price, no passkey)
```json
{
  "id": "ObjectId",
  "organizationId": "ObjectId",
  "name": "Kapoor–Verma Wedding",
  "clientName": "Rohan Kapoor",
  "location": "ITC Maurya, New Delhi",
  "startDate": "ISO", "endDate": "ISO",
  "paused": false,
  "templateIds": ["ObjectId", "ObjectId"],   // multi-select from active platform templates
  "filters": ["warm", "bw", "vintage"],      // ⊆ the 8 photo filters (original, warm, cool,
                                             //   bw, vintage, neon, soft, party)
  "digitalCopy": true,                        // guests may receive a digital copy
  "branding": { "logoUrl": "https://cdn/... | null", "tagline": "Shubh Vivah" },
  "shortCode": "KAPWED",
  "createdAt": "ISO"
}
```
- **The event has NO `passkey`, NO `printPrice`, NO `frameIds`** — booth guest access is a
  booth-app concern, and pricing lives exclusively in `OrganizationDefaults` per frame.
- `branding.logoUrl` defaults to `null` (none); when set it renders in the 15% footer of
  every print alongside `branding.tagline`.

### `Coupon` (new collection — org-owned)
```json
{
  "id": "ObjectId",
  "organizationId": "ObjectId",
  "code": "WEDDING20",            // uppercase A-Z0-9, unique per org (case-insensitive)
  "type": "percentage | fixed",
  "value": 20,                    // % or ₹
  "quantity": 100,
  "usedCount": 3,                 // atomic $inc on redemption
  "expiryDate": "ISO",
  "eventIds": ["eventId"],        // [] = applies to all events
  "status": "active | paused",
  "createdAt": "ISO", "updatedAt": "ISO"
}
```
Redemption (booth): validate `active`, not expired, `usedCount < quantity`, and event scope —
in one transaction; then `$inc` `usedCount` atomically. **Never trust a client-computed
discount** (P0 SEC-07) — the server computes price from `OrganizationDefaults`.

### `Ticket` (new collection — guest support)
```json
{
  "id": "ObjectId",
  "organizationId": "ObjectId",
  "eventId": "ObjectId | null",
  "deviceId": "ObjectId | null",
  "category": "device | payment | photo | event | general",
  "subject": "string",
  "priority": "low | medium | high | urgent",
  "status": "open | in_progress | resolved | closed",
  "guest": { "name": "string", "contact": "string" },
  "messages": [ { "id": "ObjectId", "author": "string", "at": "ISO", "text": "string" } ],
  "resolution": "string | null",
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### `AuditLog` (new collection — append-only)
```json
{
  "id": "ObjectId",
  "actorId": "userId | null",     // null = system
  "organizationId": "ObjectId | null",  // null = platform-level
  "action": "platform.org.suspended",   // dotted, typed
  "entity": "organisation",
  "summary": "Suspended vishal — reason: billing dispute",
  "severity": "info | warn | danger",
  "ip": "string | null",
  "at": "ISO"
}
```
Indexes: `(organizationId, at)`, `(actorId, at)`.

### `User` (changes to existing model)
- Add fixed `role` enum: `OWNER | PLATFORM_ADMIN | SUPPORT_MANAGER | ORG_ADMIN | ORG_MANAGER`
  (replace the caller-supplied role bug, P0 SEC-01).
- `organizationId` is set only for org roles; null for platform roles.
- Password resets generate a temp password server-side and return it **once**.

---

## 2. New / changed endpoints

Auth — `POST /api/auth/me`
- `GET /api/auth/me` → `{ token, user }` (refresh session; 401 if expired).

Auth — profile
- `PUT /api/auth/profile` body `{ name?, photoUrl? }` → `{ user }`
- `POST /api/auth/password` body `{ currentPassword, newPassword }` → 200

### Platform (scope = platform role; revenue = OWNER only)

- `GET /api/platform/dashboard`
  → `{ orgs: { total, active, trial, suspended, banned, expired },
       devices: { total, online, offline, operational },
       events: { active, upcoming },
       expiringSoon: [{ id, name, plan, daysLeft }],
       nearLimits: [{ id, name, deviceUsed, deviceLimit, eventUsed, eventLimit }],
       alerts: [{ kind, tone, text }],
       recentSignups: [{ id, name, plan, createdAt }] }`

- `GET /api/platform/revenue` (OWNER only)
  → `{ monthWise: [{ label, value }], quarterWise: [{ label, value }], yearOptions: [2026, 2025],
       net, fyRevenue, monthRevenue,
       orgs: [{ id, name, email, plan, planName, planStatus, expiry, daysLeft,
                revenue, revenueThisMonth, revenueFY }] }`

- `GET /api/platform/organisations?search=&status=&plan=&page=&limit=`
  → `{ items: [{ id, name, email, ownerName, ownerEmail, plan, planName, status,
                 planStatus, planExpiry, planDaysLeft, devices, onlineDevices, activeEvents,
                 createdAt, lastActiveAt }], page, pages, total }`
- `GET /api/platform/organisations/:id`
  → full detail: `organisation, plan { planName, status, startDate, endDate, daysLeft,
     deviceLimit, eventLimit, amountPaid, invoiceNo }, subscription, devices[], events[],
     revenue { total }, suspendReason`
- `POST /api/platform/organisations/:id/suspend` body `{ reason }` (reason required) → 200
- `POST /api/platform/organisations/:id/ban` body `{ reason }` (reason required) → 200
- `POST /api/platform/organisations/:id/restore` → 200
  *(all three: OWNER only; audit-logged; blocks apply immediately to events/devices/booths)*

- `GET /api/platform/audit?search=&actor=&action=&page=&limit=`
  → `{ items: [{ id, at, actorId, actor, role, action, entity, summary, severity, ip }],
       page, pages, total, actors: [{ id, name, role }] }`

- `GET /api/platform/users` (OWNER) → `{ users: [{ id, name, email, role, status, lastLoginAt, createdAt }] }`
- `POST /api/platform/users` (OWNER) body `{ name, email, password, role: PLATFORM_ADMIN|SUPPORT_MANAGER }`
  → 201 `{ user }` (400 if role is Owner or org role; 409 on duplicate email)
- `PUT /api/platform/users/:id` body `{ name?, email?, status? }` (OWNER) → `{ user }`
- `POST /api/platform/users/:id/reset-password` (OWNER) → `{ tempPassword }`

- `GET /api/platform/templates` (OWNER/PA manage; org roles read via `GLOBAL_TEMPLATES_USE`
  so the event editor can list them) → `{ templates: [...] }`
- `POST /api/platform/templates` (OWNER/PLATFORM_ADMIN) body
  `{ name, category?, description?, imageScope: general|specific,
     orientation?: portrait|landscape|strip|square, slotCount?: 1|2|3|4|6,
     backgroundUrl?: string|null, source: manual|ai_generated }`
  → 201 `{ template }`
  — for `specific` the server computes `canvas` + `photoSlots` from the slot engine
  (400 on invalid orientation/slotCount); `general` ⇒ `orientation: "universal"`,
  `photoSlots: []`.
- `POST /api/platform/templates/ai-generate` (OWNER/PLATFORM_ADMIN) body
  `{ prompt, imageScope, orientation?, slotCount? }` → `{ draft }`
  (an **unsaved** template-shaped draft incl. generated `backgroundUrl`; the client
  previews it and persists via the create endpoint after user approval)
- `PUT /api/platform/templates/:id` body `{ name?, category?, description?, active?, status? }` → `{ template }`
- `DELETE /api/platform/templates/:id` → 200 (409 if any event's `templateIds` includes it → "disable instead")

### Frames (platform catalogue — same *Templates & Frames* screen)
- `GET /api/platform/frames` (any platform role) → `{ frames: [{ ...Frame, enabledOrgs: 3 }] }`
- `POST /api/platform/frames` (**OWNER only**) body
  `{ name, description?, background: { type, colors[], pattern }, text?, defaultPrice? }`
  → 201 `{ frame }` (409 on duplicate name)
- `DELETE /api/platform/frames/:id` (**OWNER only**) → 200
  (409 while `enabledOrgs > 0` — disable it in those organisations' defaults first)

### Organisation (scope = org role, tenant-scoped by org filter)

- `GET /api/org/dashboard`
  → `{ organisation { name, contact, status },
       plan { plan, planName, status, startDate, endDate, daysLeft, deviceLimit, eventLimit },
       usage { deviceLimit, eventLimit, devicesUsed, eventsUsed },
       revenue { total, thisMonth, fy, byStatus: { paid, pending, failed },
                 monthWise: [{ label, value }] },        // ORG_ADMIN only — omit for ORG_MANAGER
       devices { total, online, offline, list: [...] },
       events { active: [], upcoming: [], paused: [], finished: [] },
       tickets { open, list: [] },
       warnings: [{ kind, tone, text }] }`

- `GET /api/org/revenue?eventId=&deviceId=` (ORG_ADMIN only)
  → `{ total, thisMonth, fy, byStatus: { paid, pending, failed },
       monthWise: [{ label, value }],
       byEvent: [{ id, name, status, prints, transactions, total }],
       byDevice: [{ id, name, online, prints, transactions, total }],
       events: [{ id, name }], devices: [{ id, name }] }`

- `GET /api/org/events?search=&status=`
  → `{ events: [{ id, name, clientName, location, startDate, endDate, status,
                  templateIds, filters, digitalCopy, branding, assignedDevices: [{ id, name, online }],
                  deviceCount }], canCreate }`
- `POST /api/org/events` (both org roles) — **General + Customisation + Branding, no price**:
  body `{ name, clientName?, location?, startDate, endDate,
          digitalCopy?, filters?: string[], templateIds?: string[],
          branding?: { logoUrl?: string|null, tagline?: string } }`
  → 201 `{ event }`
  **Server checks (in order)**: required fields · end > start · org not suspended/banned ·
  plan not expired/not_subscribed · `activeCount < plan.eventLimit` (active = between start
  and end and not paused; finished never counts) · every `templateId` exists and is active ·
  every `filter` ∈ the 8-filter catalogue. `shortCode` is auto-derived from the name.
- `PUT /api/org/events/:id` — same body/validations as create (partial allowed);
  branding/tagline can be edited at any time
- `POST /api/org/events/:id/pause` / `POST /api/org/events/:id/resume` → 200
- `DELETE /api/org/events/:id` — 409 while the event is `active` (pause first)
- `GET /api/org/devices` → `{ devices: [{ id, deviceUuid, deviceName, location, hardware,
  online, lastSeenAt, registeredAt, assignedEvent: { id, name, status } | null }],
  limit: { used, allowed }, canRegister }`
  *(read-only in CRM — registration happens in the booth app via the existing
  `booth-login` + UUID pairing; the device token is never returned to CRM users)*
- `POST /api/org/devices/:id/assign` body `{ eventId }` — 409 if event finished; writes audit
- `POST /api/org/devices/:id/unassign` → 200
- `DELETE /api/org/devices/:id` — 409 if assigned to an active event; unregisters the UUID

- `GET /api/org/tickets?status=&priority=` → `{ tickets: [...with event/device refs],
  counts: { open, in_progress, resolved, closed } }`
- `GET /api/org/tickets/:id` → `{ ticket }`
- `POST /api/org/tickets/:id/reply` body `{ message }` — open → in_progress
- `POST /api/org/tickets/:id/resolve` body `{ note? }` — sets `resolution`, status resolved
- `POST /api/org/tickets/:id/reopen` — resolved/closed → open

- `GET /api/org/defaults` (ORG_ADMIN + ORG_MANAGER read) → the defaults doc **with the full
  current frame catalogue merged in** (see model above)
- `PUT /api/org/defaults` (ORG_ADMIN only) body
  `{ name?, logoUrl?, boothTimeoutSec?: 10..86400, frames?: [{ frameId, price, allowed }] }`
  → the merged doc (400 on unknown frameId or out-of-range timeout)
- `GET /api/org/coupons` → `{ coupons: [...with event names, isExhausted, expired flags],
  events: [{ id, name }] }`
- `POST /api/org/coupons` body `{ code, type, value, quantity, expiryDate, eventIds }`
  → 201 `{ coupon }` (code normalised to uppercase A-Z0-9; 409 on duplicate)
- `PUT /api/org/coupons/:id` (same body) → `{ coupon }`
- `POST /api/org/coupons/:id/pause` / `POST /api/org/coupons/:id/activate`
- `DELETE /api/org/coupons/:id`
- `GET /api/org/team` → `{ members: [...], canManage }`
- `POST /api/org/team` body `{ name, email, password }` (ORG_ADMIN) → 201
  **role is always ORG_MANAGER — never client-supplied**
- `PUT /api/org/team/:id` body `{ name?, email? }`
- `POST /api/org/team/:id/deactivate` / `POST /api/org/team/:id/activate`
- `POST /api/org/team/:id/reset-password` → `{ tempPassword }`
- `GET /api/org/audit?search=&actor=&action=&page=&limit=` → same shape as platform audit

### Booth (existing endpoints — contract notes, no new code needed)
- `POST /api/booth/login` already returns device context; it must also reject devices whose
  org is `banned` (403) and return a read-only banner state when `suspended`.
- Device "registration" stays a booth-app action (UUID pairing). **No CRM route registers
  devices** — the old CRM's "Add device" with a manual deviceToken is gone for good (P0 SEC-05).

---

## 3. Cross-cutting rules the backend must enforce

1. **RBAC matrix is fixed server-side** — the exact matrix in `src/lib/roles.js`. No
   permission tables in the DB, no admin UI for them.
2. **`getOrgFilter` fails closed**: internal roles never receive an org filter that
   degenerates to `{}` (P0 SEC-03); org roles always receive `{ organizationId }`.
3. **Plan limits and org status are checked on the server** for every create/assign/mutate —
   the CRM's `canCreate`/403s are UX, not the source of truth.
4. **Every mutating platform/org action writes an `AuditLog` row** (actor, action, entity,
   summary, severity, ip). Failed logins write `platform.auth.failed` with severity `danger`.
5. **Razorpay keys/verification** for `Subscription` stay server-side; the CRM never sees raw
   gateway payloads — it only reads `Subscription` records (per the v2 contract above).
6. **Coupon redemption** is a single atomic transaction (validate + `$inc`) — P0 SEC-07.
   The print cost the booth shows is always `OrganizationDefaults.frames[].price` for the
   chosen frame (minus coupon) — events carry no price of their own.
