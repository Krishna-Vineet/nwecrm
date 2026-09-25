import { useEffect, useState, useCallback } from 'react'
import { api } from '../../api/index.js'
import { useApp } from '../../context/AppContext.jsx'
import { Card, Chip, PageLoader, Select, Button, Drawer, TextArea, EmptyState, Field } from '../../components/ui.jsx'
import { Icon } from '../../lib/icons.jsx'
import { relativeTime, dateMed, initials, avatarColor } from '../../lib/format.js'
import { TICKET_STATUSES, TICKET_PRIORITIES } from '../../lib/plans.js'

const CATEGORY_ICONS = { device: 'monitor', payment: 'wallet', photo: 'image', event: 'calendar', general: 'headset' }

export default function Support() {
  const { toast } = useApp()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [openId, setOpenId] = useState(null)
  const [ticket, setTicket] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    const q = new URLSearchParams()
    if (status) q.set('status', status)
    if (priority) q.set('priority', priority)
    api.org.tickets(q.toString() ? '?' + q : '').then(setData).catch((e) => toast(e.message, 'error'))
  }, [status, priority])

  useEffect(() => { load() }, [load])

  const open = (id) => {
    setOpenId(id)
    setTicket(null)
    api.org.ticket(id).then((r) => setTicket(r.ticket)).catch((e) => { toast(e.message, 'error'); setOpenId(null) })
  }

  const sendReply = async () => {
    if (!reply.trim() || !openId) return
    setBusy(true)
    try {
      const r = await api.org.replyTicket(openId, reply.trim())
      setTicket(r.ticket)
      setReply('')
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async () => {
    if (!openId) return
    setBusy(true)
    try {
      const note = reply.trim() || undefined
      const r = await api.org.resolveTicket(openId, note)
      setTicket(r.ticket)
      setReply('')
      toast('Ticket marked resolved')
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const reopen = async () => {
    if (!openId) return
    setBusy(true)
    try {
      const r = await api.org.reopenTicket(openId)
      setTicket(r.ticket)
      toast('Ticket reopened', 'info')
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Support</div>
          <div className="page-sub">Guest issues raised from your booths and download pages. Platform support is handled outside the CRM.</div>
        </div>
      </div>

      <Card>
        <div className="row wrap gap-12" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="row gap-8">
            {['', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
              <button
                key={s || 'all'}
                className={`chip${status === s ? ' chip-pink' : ' chip-neutral'}`}
                style={{ height: 28, cursor: 'pointer', border: 'none', fontSize: 12 }}
                onClick={() => setStatus(s)}
              >
                {s ? TICKET_STATUSES[s].label : 'All'}
                {data ? ` · ${s ? data.counts[s] : Object.values(data.counts).reduce((a, b) => a + b, 0)}` : ''}
              </button>
            ))}
          </div>
          <div className="grow" />
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 130, height: 34, fontSize: 12.5 }}>
            <option value="">All priorities</option>
            {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>

        {!data ? (
          <PageLoader />
        ) : data.tickets.length === 0 ? (
          <EmptyState icon="headset" title="No tickets here" message="When guests raise an issue from a booth or download page, it lands in this inbox." />
        ) : (
          <div className="table-wrap">
            <table className="hp-table">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Event</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Guest</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => open(t.id)}>
                    <td>
                      <div className="row gap-10">
                        <span className="stat-ico" style={{ width: 30, height: 30, background: 'var(--surface-2)', color: 'var(--muted)' }}>
                          <Icon name={CATEGORY_ICONS[t.category] || 'headset'} size={15} />
                        </span>
                        <div>
                          <div className="cell-main">{t.subject}</div>
                          <div className="cell-sub">{t.messages?.length || 0} message(s)</div>
                        </div>
                      </div>
                    </td>
                    <td className="t13">{t.event?.name || '—'}</td>
                    <td><Chip tone={TICKET_PRIORITIES[t.priority].chip.replace('chip-', '')}>{TICKET_PRIORITIES[t.priority].label}</Chip></td>
                    <td><Chip tone={TICKET_STATUSES[t.status].chip.replace('chip-', '')} dot>{TICKET_STATUSES[t.status].label}</Chip></td>
                    <td>
                      <div className="t13">{t.guest?.name || '—'}</div>
                      {t.guest?.contact ? <div className="t11 faint">{t.guest.contact}</div> : null}
                    </td>
                    <td className="t12 muted">{relativeTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={!!openId}
        onClose={() => { setOpenId(null); setReply('') }}
        title={ticket?.subject || 'Ticket'}
        sub={ticket ? `${ticket.event?.name || 'General'}${ticket.device ? ` · ${ticket.device.name}` : ''} · raised ${dateMed(ticket.createdAt)}` : ''}
        icon="headset"
        footer={
          ticket ? (
            <div>
              <div className="row gap-12">
                <TextArea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={ticket.status === 'resolved' || ticket.status === 'closed' ? 'Add a note…' : 'Write a reply or note for the conversation…'}
                  style={{ flex: 1 }}
                />
                <Button variant="primary" icon="send" onClick={sendReply} disabled={busy || !reply.trim()}>Send</Button>
              </div>
              <div className="row gap-12 mt-12">
                {ticket.status === 'resolved' || ticket.status === 'closed' ? (
                  <Button variant="outline" icon="refresh" onClick={reopen} disabled={busy} style={{ flex: 1 }}>Reopen ticket</Button>
                ) : (
                  <>
                    <Button variant="outline" style={{ flex: 1 }} onClick={resolve} disabled={busy}>
                      <Icon name="check" size={15} /> Mark resolved {reply.trim() ? '(with note)' : ''}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {!ticket ? (
          <div className="page-load" style={{ padding: '60px 0' }}><span className="spinner" /></div>
        ) : (
          <div>
            <div className="row wrap gap-8 mb-16">
              <Chip tone={TICKET_STATUSES[ticket.status].chip.replace('chip-', '')} dot>{TICKET_STATUSES[ticket.status].label}</Chip>
              <Chip tone={TICKET_PRIORITIES[ticket.priority].chip.replace('chip-', '')}>{TICKET_PRIORITIES[ticket.priority].label} priority</Chip>
              <Chip tone="neutral">{ticket.category}</Chip>
              {ticket.device ? <Chip tone="info">Booth: {ticket.device.name}</Chip> : null}
            </div>
            {ticket.guest?.name ? (
              <div className="card card-pad mb-16" style={{ background: 'var(--surface-2)', borderColor: 'var(--line-soft)' }}>
                <div className="row gap-10">
                  <span className="avatar" style={{ width: 30, height: 30, fontSize: 11, background: avatarColor(ticket.guest.name) }}>{initials(ticket.guest.name)}</span>
                  <div>
                    <div className="t13 fw6">{ticket.guest.name}</div>
                    <div className="t11 muted">{ticket.guest.contact || 'No contact provided'}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              {ticket.messages.map((m) => {
                const mine = m.author.includes('Organisation')
                return (
                  <div key={m.id} className="thread-msg" style={mine ? { flexDirection: 'row-reverse' } : undefined}>
                    <span className="avatar" style={{ width: 28, height: 28, fontSize: 10.5, background: mine ? 'var(--hp-pink)' : avatarColor(m.author), flex: 'none' }}>
                      {initials(mine ? 'Me' : m.author)}
                    </span>
                    <div style={{ maxWidth: '88%' }}>
                      <div className="thread-meta" style={mine ? { textAlign: 'right' } : undefined}>{m.author} · {relativeTime(m.at)}</div>
                      <div className={`thread-bubble${mine ? ' mine' : ''}`}>{m.text}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {ticket.resolution && (ticket.status === 'resolved' || ticket.status === 'closed') ? (
              <div className="card card-pad mt-16" style={{ background: 'var(--hp-green-soft)', borderColor: 'rgba(111,168,43,.25)' }}>
                <div className="row gap-8 t12 fw7 mb-8" style={{ color: 'var(--hp-green-ink)' }}>
                  <Icon name="check-circle" size={14} /> RESOLUTION
                </div>
                <p className="t13" style={{ color: '#3D5C11' }}>{ticket.resolution}</p>
              </div>
            ) : null}
          </div>
        )}
      </Drawer>
    </div>
  )
}
