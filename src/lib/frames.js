// ============================================================
// Frame catalogue (platform-owned).
//
// A FRAME is the canvas a print is made on: a background design
// (solid / gradient / patterned) on which the template's photo
// slots sit. The complete output print — photos, border and the
// 15% branding footer — is printed on the frame.
//
// Orgs price each frame (Organisation Defaults) and choose which
// frames are available at their booths. The platform (Owner) adds
// and removes frames from this catalogue.
// ============================================================

export const FRAME_CATALOGUE = [
  { id: 'frame-classic', name: 'Classic White', description: 'Clean white canvas. The standard every event runs on.', background: { type: 'solid', colors: ['#FFFFFF'], pattern: 'none' }, text: '#3A3344', defaultPrice: 0 },
  { id: 'frame-royal', name: 'Royal Black', description: 'Deep charcoal canvas with a soft sheen. Weddings and premium events.', background: { type: 'solid', colors: ['#191420'], pattern: 'none' }, text: '#FFFFFF', defaultPrice: 60 },
  { id: 'frame-blush', name: 'Blush Pink', description: 'Soft pink wash — mehendi, sangeet and engagement shoots.', background: { type: 'gradient', colors: ['#FBE7F0', '#F5CBDD'], pattern: 'none' }, text: '#7A2355', defaultPrice: 40 },
  { id: 'frame-purple', name: 'Royal Purple', description: 'House-purple gradient. The HappyPix signature look.', background: { type: 'gradient', colors: ['#5F4CAA', '#3A3170'], pattern: 'dots' }, text: '#FFFFFF', defaultPrice: 50 },
  { id: 'frame-blue', name: 'Midnight Blue', description: 'Corporate-blue gradient with fine dot texture.', background: { type: 'gradient', colors: ['#3871C1', '#1E3E70'], pattern: 'dots' }, text: '#FFFFFF', defaultPrice: 50 },
  { id: 'frame-maroon', name: 'Festive Maroon', description: 'Traditional maroon for weddings, pujas and anniversary galas.', background: { type: 'solid', colors: ['#6E1F2A'], pattern: 'stripes' }, text: '#FFE9D6', defaultPrice: 45 },
  { id: 'frame-neon', name: 'Neon Party', description: 'Magenta-to-purple glow for club nights and pop-up zones.', background: { type: 'gradient', colors: ['#EA097F', '#5F4CAA'], pattern: 'none' }, text: '#FFFFFF', defaultPrice: 75 },
  { id: 'frame-pastel', name: 'Pastel Dream', description: 'Light sky-to-blush wash. Kids events and brunch parties.', background: { type: 'gradient', colors: ['#DDEBFF', '#FFE9F2'], pattern: 'none' }, text: '#403952', defaultPrice: 40 },
  { id: 'frame-mono', name: 'Mono Studio', description: 'Editorial dark grey. Studio shoots and fashion events.', background: { type: 'solid', colors: ['#2E2B33'], pattern: 'stripes' }, text: '#FFFFFF', defaultPrice: 55 },
  { id: 'frame-gold', name: 'Gold Elegance', description: 'Champagne-gold gradient for premium reception prints.', background: { type: 'gradient', colors: ['#D9B44A', '#8C6D1F'], pattern: 'none' }, text: '#2B2109', defaultPrice: 80 },
  { id: 'frame-cream', name: 'Floral Cream', description: 'Warm cream canvas with a subtle dot pattern.', background: { type: 'solid', colors: ['#FAF3E7'], pattern: 'dots' }, text: '#6B5B3E', defaultPrice: 35 },
  { id: 'frame-emerald', name: 'Emerald Luxe', description: 'Deep emerald for holiday parties and corporate gifting.', background: { type: 'solid', colors: ['#14532D'], pattern: 'none' }, text: '#E8F5EC', defaultPrice: 55 },
]

export const FRAME_BY_ID = Object.fromEntries(FRAME_CATALOGUE.map((f) => [f.id, f]))

export const BACKGROUND_TYPES = ['solid', 'gradient']
export const FRAME_PATTERNS = ['none', 'dots', 'stripes']

export function frameUsage(db, frameId) {
  // How many organisations have the frame enabled at their booths.
  let enabled = 0
  for (const defaults of Object.values(db.orgDefaults || {})) {
    const entry = (defaults.frames || []).find((f) => f.frameId === frameId)
    if (entry?.allowed) enabled++
  }
  return enabled
}
