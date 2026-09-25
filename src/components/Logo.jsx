// HappyPix brand mark — camera + magenta flash arc, built from the
// logo geometry (magenta #EA097F arc, blue #3871C1, green #85C536).

export function BrandMark({ size = 34, onDark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill={onDark ? '#1E1730' : '#141020'} />
      <path
        d="M46 22h-7l-4.5-7H29.5L25 22H18a6 6 0 0 0-6 6v14a6 6 0 0 0 6 6h28a6 6 0 0 0 6-6V28a6 6 0 0 0-6-6z"
        fill="#FFFFFF"
      />
      <circle cx="32" cy="35" r="8.6" fill="none" stroke="#141020" strokeWidth="3.2" />
      <circle cx="32" cy="35" r="3.2" fill="#3871C1" />
      <path
        d="M13.5 31.5C17.5 24 24.3 19 32 19s14.5 5 18.5 12.5"
        fill="none"
        stroke="#EA097F"
        strokeWidth="4.4"
        strokeLinecap="round"
        opacity="0.95"
      />
      <circle cx="47" cy="25.5" r="2.4" fill="#85C536" />
    </svg>
  )
}

export function Wordmark({ size = 19, onDark = false, sub = null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
      <span
        style={{
          fontSize: size,
          fontWeight: 780,
          letterSpacing: '-0.03em',
          color: onDark ? '#FFFFFF' : '#191424',
        }}
      >
        Happy<span style={{ color: '#EA097F' }}>Pix</span>
        <span style={{ fontWeight: 560, color: onDark ? 'rgba(255,255,255,0.55)' : '#6E6780', marginLeft: 6, fontSize: size - 2 }}>
          CRM
        </span>
      </span>
      {sub ? (
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em', color: onDark ? 'rgba(255,255,255,0.42)' : '#9C95AD' }}>
          {sub}
        </span>
      ) : null}
    </div>
  )
}
