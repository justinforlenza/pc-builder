// Build rules and grading. Framework-free so it runs in the browser, in node:test,
// and (phase 2) in the LTI worker to re-grade a submitted log.

export type Kind =
  | 'standoffs' | 'motherboard' | 'cpu' | 'paste' | 'cooler' | 'ram'
  | 'm2' | 'gpu' | 'psu' | 'cable24' | 'cableEps' | 'cablePcie'

export type PartId =
  | 'standoffs' | 'motherboard' | 'cpu' | 'paste' | 'cooler' | 'ram1' | 'ram2'
  | 'm2' | 'gpu' | 'psu' | 'cable24' | 'cableEps' | 'cablePcie'

export type SlotId =
  | 'standoffs' | 'motherboard' | 'socket' | 'paste' | 'cooler'
  | 'dimmA1' | 'dimmA2' | 'dimmB1' | 'dimmB2' | 'm2' | 'pcie1' | 'pcie2'
  | 'psu' | 'atx24' | 'eps8' | 'pciePower'

/** One install action. t = ms since the build started. */
export interface PlaceEvent { part: PartId; slot: SlotId; t: number }

export interface Deduction { category: 'Forgotten' | 'Placement' | 'Order' | 'Time'; points: number; message: string }
export interface GradeResult { score: number; letter: string; deductions: Deduction[] }

export const PARTS: Record<PartId, { name: string; kind: Kind }> = {
  standoffs: { name: 'Motherboard standoffs', kind: 'standoffs' },
  motherboard: { name: 'Motherboard', kind: 'motherboard' },
  cpu: { name: 'CPU', kind: 'cpu' },
  paste: { name: 'Thermal paste', kind: 'paste' },
  cooler: { name: 'CPU cooler', kind: 'cooler' },
  ram1: { name: 'RAM stick', kind: 'ram' },
  ram2: { name: 'RAM stick', kind: 'ram' },
  m2: { name: 'M.2 SSD', kind: 'm2' },
  gpu: { name: 'Graphics card', kind: 'gpu' },
  psu: { name: 'Power supply', kind: 'psu' },
  cable24: { name: '24-pin ATX cable', kind: 'cable24' },
  cableEps: { name: '8-pin EPS (CPU) cable', kind: 'cableEps' },
  cablePcie: { name: 'PCIe power cable', kind: 'cablePcie' },
}

/**
 * accepts: which part kind fits. requires: kinds that must already be installed for the
 * slot to be reachable. hiddenBy: kinds that block the slot once installed, which is
 * what makes a skipped step (standoffs, paste) permanent and gradable.
 */
export const SLOTS: Record<SlotId, { name: string; accepts: Kind; requires?: Kind[]; hiddenBy?: Kind[] }> = {
  standoffs: { name: 'case standoff holes', accepts: 'standoffs', hiddenBy: ['motherboard'] },
  motherboard: { name: 'motherboard tray', accepts: 'motherboard' },
  socket: { name: 'CPU socket', accepts: 'cpu', requires: ['motherboard'] },
  paste: { name: 'top of the CPU', accepts: 'paste', requires: ['cpu'], hiddenBy: ['cooler'] },
  cooler: { name: 'CPU cooler mount', accepts: 'cooler', requires: ['cpu'] },
  dimmA1: { name: 'DIMM slot A1', accepts: 'ram', requires: ['motherboard'] },
  dimmA2: { name: 'DIMM slot A2', accepts: 'ram', requires: ['motherboard'] },
  dimmB1: { name: 'DIMM slot B1', accepts: 'ram', requires: ['motherboard'] },
  dimmB2: { name: 'DIMM slot B2', accepts: 'ram', requires: ['motherboard'] },
  m2: { name: 'M.2 slot', accepts: 'm2', requires: ['motherboard'] },
  pcie1: { name: 'top PCIe x16 slot', accepts: 'gpu', requires: ['motherboard'] },
  pcie2: { name: 'bottom PCIe x16 slot', accepts: 'gpu', requires: ['motherboard'] },
  psu: { name: 'PSU bay', accepts: 'psu' },
  atx24: { name: '24-pin ATX header', accepts: 'cable24', requires: ['motherboard', 'psu'] },
  eps8: { name: '8-pin EPS header', accepts: 'cableEps', requires: ['motherboard', 'psu'] },
  pciePower: { name: 'GPU power connector', accepts: 'cablePcie', requires: ['gpu', 'psu'] },
}

/** Teacher-editable grading rules. Points are deducted from 100. */
export const RULES = {
  missing: {
    standoffs: [15, 'No standoffs: the motherboard sits directly on the metal case and can short out.'],
    paste: [15, 'No thermal paste: the CPU cannot transfer heat to the cooler and will overheat.'],
    cable24: [10, '24-pin ATX cable not connected: the motherboard gets no power.'],
    cableEps: [10, '8-pin EPS cable not connected: the CPU gets no power.'],
    cablePcie: [10, 'PCIe power cable not connected: the graphics card gets no power.'],
  } as Partial<Record<PartId, [number, string]>>,
  missingDefault: 15,
  placement: [
    { parts: ['ram1', 'ram2'], slots: ['dimmA2', 'dimmB2'], points: 5,
      message: 'RAM should go in slots A2 and B2 so it runs in dual-channel mode (check the motherboard manual).' },
    { parts: ['gpu'], slots: ['pcie1'], points: 5,
      message: 'The graphics card belongs in the top PCIe x16 slot, which has the full x16 lanes from the CPU.' },
  ] as { parts: PartId[]; slots: SlotId[]; points: number; message: string }[],
  order: [
    { first: ['ram1', 'ram2'], then: 'cooler', points: 5,
      message: 'Install RAM before the CPU cooler; large coolers block access to the DIMM slots.' },
    { first: ['m2'], then: 'gpu', points: 5,
      message: 'Install the M.2 SSD before the graphics card; the GPU often covers the M.2 slot.' },
  ] as { first: PartId[]; then: PartId; points: number; message: string }[],
  timeLimitMin: 8,
  timePerMin: 1,
  timeCap: 10,
  letters: [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F']] as [number, string][],
}

export function isSlotOpen(slot: SlotId, log: PlaceEvent[]): boolean {
  const s = SLOTS[slot]
  const kinds = new Set(log.map(e => PARTS[e.part].kind))
  return !log.some(e => e.slot === slot)
    && (s.requires ?? []).every(k => kinds.has(k))
    && !(s.hiddenBy ?? []).some(k => kinds.has(k))
}

export function grade(log: PlaceEvent[], elapsedMs: number): GradeResult {
  const deductions: Deduction[] = []
  const at = new Map(log.map((e, i) => [e.part, { slot: e.slot, i }]))

  for (const part of Object.keys(PARTS) as PartId[]) {
    if (at.has(part)) continue
    const [points, message] = RULES.missing[part] ?? [RULES.missingDefault, `${PARTS[part].name} was never installed.`]
    deductions.push({ category: 'Forgotten', points, message })
  }

  for (const r of RULES.placement) {
    if (r.parts.some(p => at.has(p) && !r.slots.includes(at.get(p)!.slot)))
      deductions.push({ category: 'Placement', points: r.points, message: r.message })
  }

  for (const r of RULES.order) {
    const then = at.get(r.then)
    if (then && r.first.some(p => at.has(p) && at.get(p)!.i > then.i))
      deductions.push({ category: 'Order', points: r.points, message: r.message })
  }

  const overMin = Math.floor(Math.max(0, elapsedMs - RULES.timeLimitMin * 60_000) / 60_000)
  if (overMin > 0)
    deductions.push({ category: 'Time', points: Math.min(RULES.timeCap, overMin * RULES.timePerMin),
      message: `Took ${overMin} min over the ${RULES.timeLimitMin} min target.` })

  const score = Math.max(0, 100 - deductions.reduce((sum, d) => sum + d.points, 0))
  const letter = RULES.letters.find(([min]) => score >= min)![1]
  return { score, letter, deductions }
}
