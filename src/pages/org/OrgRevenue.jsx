import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/index.js'
import { Card, CardHead, StatCard, Chip, PageLoader, Select } from '../../components/ui.jsx'
import { BarChart, Donut, ChartLegend } from '../../components/charts.jsx'
import { Icon } from '../../lib/icons.jsx'
import { inr } from '../../lib/format.js'

export default function OrgRevenue() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [eventId, setEventId] = useState('')
  const [deviceId, setDeviceId] = useState('')

  useEffect(() => {
    api.org.revenue().then(setData).catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    if (!data) return null
    // client-side refinement for the demo (real API accepts the same query params)
    let byEvent = data.byEvent
    let byDevice = data.byDevice
    if (eventId) byEvent = byEvent.filter((e) => e.id === eventId)
    if (deviceId) byDevice = byDevice.filter((d) => d.id === deviceId)
    return { ...data, byEvent, byDevice }
  }, [data, eventId, deviceId])

  if (error) return <div className="empty"><div className="empty-ico"><Icon name="alert" size={24} /></div><h3>Access denied</h3><p>{error}</p></div>
  if (!filtered) return <PageLoader />
  const d = filtered

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Organisation Revenue</div>
          <div className="page-sub">What your booths earn — print sales per event, per device. Read-only reporting.</div>
        </div>
        <div className="row gap-8">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ width: 190, height: 36 }}>
            <option value="">All events</option>
            {d.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ width: 170, height: 36 }}>
            <option value="">All booths</option>
            {d.devices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="stat-grid mb-16">
        <StatCard label="Total booth revenue" value={inr(d.total)} icon="revenue" foot="all paid prints, all time" />
        <StatCard label="This month" value={inr(d.thisMonth)} icon="calendar" iconBg="var(--hp-blue-soft)" iconColor="var(--hp-blue)" foot="September 2026" />
        <StatCard label="This financial year" value={inr(d.fy)} icon="zap" iconBg="var(--hp-green-soft)" iconColor="var(--hp-green-ink)" foot="Apr 2026 → Mar 2027" />
        <StatCard label="Payment health" value={`${Math.round((d.byStatus.paid / Math.max(1, d.byStatus.paid + d.byStatus.pending + d.byStatus.failed)) * 100)}%`} icon="check-circle" iconBg="var(--hp-purple-soft)" iconColor="var(--hp-purple)" foot={`${d.byStatus.paid} paid · ${d.byStatus.pending} pending · ${d.byStatus.failed} failed`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }} className="mb-16">
        <Card>
          <CardHead title="Monthly booth revenue" sub="Paid print sales, last 8 months" />
          <div style={{ padding: '14px 16px 8px' }}>
            <BarChart data={d.monthWise} height={185} formatValue={(v) => inr(v)} />
          </div>
        </Card>
        <Card>
          <CardHead title="Payment status" sub="All transactions" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '20px', flexWrap: 'wrap' }}>
            <Donut
              size={150}
              data={[
                { label: 'Paid', value: d.byStatus.paid, color: 'var(--hp-green)' },
                { label: 'Pending', value: d.byStatus.pending, color: '#B45309' },
                { label: 'Failed', value: d.byStatus.failed, color: 'var(--danger)' },
              ]}
              centerLabel={d.byStatus.paid + d.byStatus.pending + d.byStatus.failed}
              centerSub="transactions"
            />
            <ChartLegend
              items={[
                { color: 'var(--hp-green)', label: 'Paid', value: d.byStatus.paid },
                { color: '#B45309', label: 'Pending', value: d.byStatus.pending },
                { color: 'var(--danger)', label: 'Failed', value: d.byStatus.failed },
              ]}
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Revenue by event" sub="Highest earning first" />
        <div className="table-wrap">
          <table className="hp-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th className="t-right">Prints</th>
                <th className="t-right">Transactions</th>
                <th className="t-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {d.byEvent.map((e) => (
                <tr key={e.id}>
                  <td className="cell-main">{e.name}</td>
                  <td><Chip tone={e.status === 'active' ? 'active' : e.status === 'upcoming' ? 'info' : e.status === 'paused' ? 'warn' : 'neutral'} dot>{e.status[0].toUpperCase() + e.status.slice(1)}</Chip></td>
                  <td className="t-right num">{e.prints}</td>
                  <td className="t-right num muted">{e.transactions}</td>
                  <td className="t-right num fw7">{inr(e.total)}</td>
                </tr>
              ))}
              {d.byEvent.length === 0 ? <tr><td colSpan={5} className="t13 muted" style={{ textAlign: 'center', padding: 24 }}>No events yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-16">
        <CardHead title="Revenue by booth" sub="Which device earns what" />
        <div className="table-wrap">
          <table className="hp-table">
            <thead>
              <tr>
                <th>Booth</th>
                <th>Status</th>
                <th className="t-right">Prints</th>
                <th className="t-right">Transactions</th>
                <th className="t-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {d.byDevice.map((x) => (
                <tr key={x.id}>
                  <td>
                    <div className="row gap-10">
                      <Icon name="monitor" size={15} style={{ color: x.online ? 'var(--hp-green-ink)' : 'var(--faint)' }} />
                      <span className="cell-main">{x.name}</span>
                    </div>
                  </td>
                  <td><Chip tone={x.online ? 'active' : 'neutral'} dot>{x.online ? 'Online' : 'Offline'}</Chip></td>
                  <td className="t-right num">{x.prints}</td>
                  <td className="t-right num muted">{x.transactions}</td>
                  <td className="t-right num fw7">{inr(x.total)}</td>
                </tr>
              ))}
              {d.byDevice.length === 0 ? <tr><td colSpan={5} className="t13 muted" style={{ textAlign: 'center', padding: 24 }}>No devices yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
