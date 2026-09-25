// ============================================================
// Template architecture — port of "Default Templates Fallback (Architecture V1)".
// A template = canvas + grid of photo slots; the bottom 15% of the
// canvas height is always reserved for branding (logo + tagline).
// ============================================================

// Helper function to generate a grid of photo slots
export const generateGridSlots = (canvasWidth, canvasHeight, cols, rows, margin = 40, spacing = 20) => {
  const slots = []
  const footerSpace = canvasHeight * 0.15 // Reserve 15% of the total height at the bottom for branding
  const topMargin = margin
  const bottomMargin = margin + footerSpace
  const leftMargin = margin
  const rightMargin = margin

  const totalSpacingX = spacing * (cols - 1)
  const totalSpacingY = spacing * (rows - 1)

  const slotWidth = (canvasWidth - leftMargin - rightMargin - totalSpacingX) / cols
  const slotHeight = (canvasHeight - topMargin - bottomMargin - totalSpacingY) / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        id: `slot-${r * cols + c + 1}`,
        x: leftMargin + c * (slotWidth + spacing),
        y: topMargin + r * (slotHeight + spacing),
        width: slotWidth,
        height: slotHeight,
      })
    }
  }
  return slots
}

// Layout mapping helper
export const createTemplate = (id, name, orientation, width, height, cols, rows, margin = 40, spacing = 20) => ({
  id,
  name,
  orientation,
  canvas: { width, height },
  photoSlots: generateGridSlots(width, height, cols, rows, margin, spacing),
})

// The full Architecture V1 catalogue.
export const ARCHITECTURE_TEMPLATES = [
  // ==========================================
  // VERTICAL (PORTRAIT) TEMPLATES
  // ==========================================
  // 4x6 Media (1200x1800)
  createTemplate('P1-46-T01-V', '4x6 Single', 'portrait', 1200, 1800, 1, 1),
  createTemplate('P1-46-T02-V', '4x6 Duo', 'portrait', 1200, 1800, 1, 2),
  createTemplate('P1-46-T04-V', '4x6 Grid 4', 'portrait', 1200, 1800, 2, 2),
  createTemplate('P1-46-T06-V', '4x6 Grid 6', 'portrait', 1200, 1800, 2, 3),

  // 2x6 Strips (600x1800)
  createTemplate('P2-46-T02-V', 'Strip 2', 'portrait', 600, 1800, 1, 2),
  createTemplate('P2-46-T03-V', 'Strip 3', 'portrait', 600, 1800, 1, 3),
  createTemplate('P2-46-T04-V', 'Strip 4', 'portrait', 600, 1800, 1, 4),

  // 5x7 Media (1500x2100)
  createTemplate('P1-57-T01-V', '5x7 Single', 'portrait', 1500, 2100, 1, 1),
  createTemplate('P1-57-T02-V', '5x7 Duo', 'portrait', 1500, 2100, 1, 2),
  createTemplate('P1-57-T04-V', '5x7 Grid 4', 'portrait', 1500, 2100, 2, 2),
  createTemplate('P1-57-T06-V', '5x7 Grid 6', 'portrait', 1500, 2100, 2, 3),

  // 6x8 Media (1800x2400)
  createTemplate('P1-68-T01-V', '6x8 Single', 'portrait', 1800, 2400, 1, 1),
  createTemplate('P1-68-T02-V', '6x8 Duo', 'portrait', 1800, 2400, 1, 2),
  createTemplate('P1-68-T04-V', '6x8 Grid 4', 'portrait', 1800, 2400, 2, 2),
  createTemplate('P1-68-T06-V', '6x8 Grid 6', 'portrait', 1800, 2400, 2, 3),
  createTemplate('P1-68-T08-V', '6x8 Grid 8', 'portrait', 1800, 2400, 2, 4),

  // 4 Strips on 6x8 (600x1800 each)
  createTemplate('P4-68-26-T03-V', 'Multi-Strip 3', 'portrait', 600, 1800, 1, 3),
  createTemplate('P4-68-26-T04-V', 'Multi-Strip 4', 'portrait', 600, 1800, 1, 4),

  // ==========================================
  // HORIZONTAL (LANDSCAPE) TEMPLATES
  // ==========================================
  // 4x6 Media (1800x1200)
  createTemplate('P1-46-T01-H', 'Wide 4x6 Single', 'landscape', 1800, 1200, 1, 1),
  createTemplate('P1-46-T02-H', 'Wide 4x6 Duo', 'landscape', 1800, 1200, 2, 1),
  createTemplate('P1-46-T04-H', 'Wide 4x6 Grid 4', 'landscape', 1800, 1200, 2, 2),
  createTemplate('P1-46-T06-H', 'Wide 4x6 Grid 6', 'landscape', 1800, 1200, 3, 2),

  // Wide Strips (1800x600)
  createTemplate('P2-46-T02-H', 'Wide Strip 2', 'landscape', 1800, 600, 2, 1),
  createTemplate('P2-46-T03-H', 'Wide Strip 3', 'landscape', 1800, 600, 3, 1),
  createTemplate('P2-46-T04-H', 'Wide Strip 4', 'landscape', 1800, 600, 4, 1),

  // 5x7 Media (2100x1500)
  createTemplate('P1-57-T01-H', 'Wide 5x7 Single', 'landscape', 2100, 1500, 1, 1),
  createTemplate('P1-57-T02-H', 'Wide 5x7 Duo', 'landscape', 2100, 1500, 2, 1),
  createTemplate('P1-57-T04-H', 'Wide 5x7 Grid 4', 'landscape', 2100, 1500, 2, 2),
  createTemplate('P1-57-T06-H', 'Wide 5x7 Grid 6', 'landscape', 2100, 1500, 3, 2),

  // 6x8 Media (2400x1800)
  createTemplate('P1-68-T01-H', 'Wide 6x8 Single', 'landscape', 2400, 1800, 1, 1),
  createTemplate('P1-68-T02-H', 'Wide 6x8 Duo', 'landscape', 2400, 1800, 2, 1),
  createTemplate('P1-68-T04-H', 'Wide 6x8 Grid 4', 'landscape', 2400, 1800, 2, 2),
  createTemplate('P1-68-T06-H', 'Wide 6x8 Grid 6', 'landscape', 2400, 1800, 3, 2),
  createTemplate('P1-68-T08-H', 'Wide 6x8 Grid 8', 'landscape', 2400, 1800, 4, 2),

  // 4 Strips on 6x8 (1800x600 each)
  createTemplate('P4-68-26-T03-H', 'Wide Multi-Strip 3', 'landscape', 1800, 600, 3, 1),
  createTemplate('P4-68-26-T04-H', 'Wide Multi-Strip 4', 'landscape', 1800, 600, 4, 1),

  // ==========================================
  // SQUARE TEMPLATES
  // ==========================================
  // 6x6 Media (1800x1800)
  createTemplate('P1-66-T01-S', 'Square Single', 'square', 1800, 1800, 1, 1),
  createTemplate('P1-66-T02-S', 'Square Duo', 'square', 1800, 1800, 2, 1),
  createTemplate('P1-66-T04-S', 'Square Grid 4', 'square', 1800, 1800, 2, 2),
  createTemplate('P1-66-T06-S', 'Square Grid 6', 'square', 1800, 1800, 3, 2),
]

export const SLOT_COUNTS = [1, 2, 3, 4, 6]
export const ORIENTATIONS = ['portrait', 'landscape', 'strip', 'square']

// Which architecture layout backs a (orientation, slot count) pick.
const ARCH_INDEX = {
  portrait: { 1: 'P1-46-T01-V', 2: 'P1-46-T02-V', 3: 'P2-46-T03-V', 4: 'P1-46-T04-V', 6: 'P1-46-T06-V' },
  landscape: { 1: 'P1-46-T01-H', 2: 'P1-46-T02-H', 3: 'P2-46-T03-H', 4: 'P1-46-T04-H', 6: 'P1-46-T06-H' },
  strip: { 1: 'P1-46-T01-V', 2: 'P2-46-T02-V', 3: 'P2-46-T03-V', 4: 'P2-46-T04-V', 6: 'P1-46-T06-V' },
  square: { 1: 'P1-66-T01-S', 2: 'P1-66-T02-S', 3: 'P1-66-T06-S', 4: 'P1-66-T04-S', 6: 'P1-66-T06-S' },
}

export function architectureFor(orientation, slotCount) {
  const id = (ARCH_INDEX[orientation] || {})[slotCount] || 'P1-46-T01-V'
  return ARCHITECTURE_TEMPLATES.find((t) => t.id === id)
}

// Compute the real photoSlots for a specific-layout template (server-side,
// so clients can never send hand-rolled coordinates).
export function slotsFor(orientation, slotCount) {
  const arch = architectureFor(orientation, slotCount)
  return {
    orientation,
    slotCount,
    canvas: arch.canvas,
    photoSlots: arch.photoSlots,
  }
}

export function templateSlotsLabel(t) {
  if (!t) return ''
  if (t.imageScope === 'general') return 'Universal'
  return `${t.photoSlots?.length || t.slotCount || 0} slots · ${t.orientation}`
}
