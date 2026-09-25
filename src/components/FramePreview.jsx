// Consistent frame renderer — used everywhere a print is previewed
// (Org Defaults, Templates & Frames, event editor).
//
// Renders: frame background (solid/gradient/pattern) → template photo
// slots → the 15% branding footer (logo + tagline).

import React from 'react'

let gradSeq = 0

export function FrameBackground({ frame, W, H, svgId }) {
  const bg = frame?.background || { type: 'solid', colors: ['#FFFFFF'], pattern: 'none' }
  const [c1, c2] = bg.colors
  const gid = `fg-${svgId}-${++gradSeq}`
  return (
    <g>
      <defs>
        {bg.type === 'gradient' ? (
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2 || c1} />
          </linearGradient>
        ) : null}
      </defs>
      <rect x="0" y="0" width={W} height={H} fill={bg.type === 'gradient' ? `url(#${gid})` : c1} />
      {bg.pattern === 'dots' ? (
        <g opacity="0.14" fill={frame?.text || '#ffffff'}>
          {Array.from({ length: Math.max(6, Math.floor(H / 90)) }).map((_, i) =>
            Array.from({ length: Math.max(4, Math.floor(W / 90)) }).map((_, j) => (
              <circle key={`${i}-${j}`} cx={(j * 90 + (i % 2) * 45) % W} cy={i * 90 + 45} r={5} />
            ))
          )}
        </g>
      ) : null}
      {bg.pattern === 'stripes' ? (
        <g opacity="0.08" stroke={frame?.text || '#ffffff'} strokeWidth="22">
          {Array.from({ length: Math.floor((W + H) / 70) }).map((_, i) => (
            <line key={i} x1={-H + i * 70} y1={H} x2={i * 70} y2={0} />
          ))}
        </g>
      ) : null}
    </g>
  )
}

export default function FramePreview({ frame, template, branding, width = 140, className = '', children }) {
  const W = template?.canvas?.width || 1200
  const H = template?.canvas?.height || 1800
  const slots = template?.photoSlots || []
  const footerH = H * 0.15
  const svgId = React.useId().replace(/[:]/g, '')
  const textColor = frame?.text || '#3A3344'

  return (
    <div
      className={`frame-preview ${className}`}
      style={{
        width,
        aspectRatio: `${W} / ${H}`,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--line)',
        boxShadow: '0 1px 2px rgba(20,16,32,0.08)',
        background: frame?.background?.colors?.[0] || '#fff',
        position: 'relative',
        flex: 'none',
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {template?.backgroundUrl ? (
          <image href={template.backgroundUrl} x="0" y="0" width={W} height={H} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <FrameBackground frame={frame} W={W} H={H} svgId={svgId} />
        )}

        {slots.map((s) => (
          <g key={s.id}>
            <rect x={s.x} y={s.y} width={s.width} height={s.height} rx={8} fill="#FFFFFF" fillOpacity="0.92" stroke={textColor} strokeOpacity="0.18" strokeWidth={3} />
            {/* camera glyph */}
            <g transform={`translate(${s.x + s.width / 2}, ${s.y + s.height / 2}) scale(${Math.min(s.width, s.height) / 24})`} opacity="0.3" stroke={textColor} fill="none" strokeWidth="1.6">
              <rect x="-10" y="-7" width="20" height="14" rx="2.5" />
              <circle cx="0" cy="0" r="4" />
              <path d="M -4 -7 L -2.5 -9.5 L 2.5 -9.5 L 4 -7" />
            </g>
          </g>
        ))}

        {/* branding footer — bottom 15% */}
        <g>
          <line x1={W * 0.08} y1={H - footerH} x2={W * 0.92} y2={H - footerH} stroke={textColor} strokeOpacity="0.35" strokeWidth={3} />
          {branding?.logoUrl ? (
            <image href={branding.logoUrl} x={W * 0.08} y={H - footerH * 0.72} width={footerH * 0.56} height={footerH * 0.56} preserveAspectRatio="xMidYMid meet" />
          ) : null}
          <text
            x={branding?.logoUrl ? W * 0.92 : W * 0.5}
            y={H - footerH * 0.38}
            textAnchor={branding?.logoUrl ? 'end' : 'middle'}
            fontFamily="Georgia, 'Times New Roman', serif"
            fontStyle="italic"
            fontSize={footerH * 0.3}
            fill={textColor}
            opacity="0.85"
          >
            {branding?.tagline || (branding?.logoUrl ? '' : '')}
          </text>
        </g>
      </svg>
      {children}
    </div>
  )
}
