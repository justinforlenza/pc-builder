// Build rules and grading. Framework-free so it runs in the browser, in node:test,
// and (phase 2) in the LTI worker to re-grade a submitted log.

export type Kind =
  | 'standoffs' | 'motherboard' | 'cpu' | 'paste' | 'cooler' | 'ram'
  | 'm2' | 'gpu' | 'psu' | 'cable24' | 'cableEps' | 'cablePcie'
  | 'ssd' | 'cableSataPower' | 'sataData'

export type PartId =
  | 'standoffs' | 'motherboard' | 'cpu' | 'paste' | 'cooler' | 'ram1' | 'ram2'
  | 'm2' | 'gpu' | 'psu' | 'cable24' | 'cableEps' | 'cablePcie'
  | 'ssd' | 'cableSataPower' | 'sataData1' | 'sataData2'

export type SlotId =
  | 'standoffs' | 'motherboard' | 'socket' | 'paste' | 'cooler'
  | 'dimmA1' | 'dimmA2' | 'dimmB1' | 'dimmB2' | 'm2' | 'pcie1' | 'pcie2'
  | 'psu' | 'atx24' | 'eps8' | 'pciePower'
  | 'driveBay' | 'sataPower' | 'sata1' | 'sata2' | 'sata3' | 'sata4' | 'ssdData'

/** One action. slot = where the part was installed (or moved to); null = removed. t = ms since the build started. */
export interface PlaceEvent { part: PartId; slot: SlotId | null; t: number }

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
  ssd: { name: '2.5" SATA SSD', kind: 'ssd' },
  cableSataPower: { name: 'SATA power cable', kind: 'cableSataPower' },
  // The two (identical) ends of one SATA data cable: either end fits the SSD or a motherboard port.
  sataData1: { name: 'SATA data cable', kind: 'sataData' },
  sataData2: { name: 'SATA data cable', kind: 'sataData' },
}

/**
 * accepts: which part kind fits. requires: kinds that must already be installed for the
 * slot to be reachable. hiddenBy: kinds that block the slot once installed, which is
 * what makes a skipped step (standoffs, paste) permanent and gradable.
 */
export const SLOTS: Record<SlotId, { name: string; accepts: Kind; requires?: Kind[]; hiddenBy?: Kind[] }> = {
  standoffs: { name: 'case standoff holes', accepts: 'standoffs', hiddenBy: ['motherboard'] },
  motherboard: { name: 'motherboard tray', accepts: 'motherboard' },
  socket: { name: 'CPU socket', accepts: 'cpu', requires: ['motherboard'], hiddenBy: ['cooler'] },
  paste: { name: 'top of the CPU', accepts: 'paste', requires: ['cpu'], hiddenBy: ['cooler'] },
  cooler: { name: 'CPU cooler mount', accepts: 'cooler', requires: ['motherboard'] }, // fits on an empty socket too, by mistake
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
  driveBay: { name: 'drive cage', accepts: 'ssd' },
  sataPower: { name: 'SSD power connector', accepts: 'cableSataPower', requires: ['ssd', 'psu'] },
  ssdData: { name: 'SSD data connector', accepts: 'sataData', requires: ['ssd'] },
  sata1: { name: 'SATA port 1', accepts: 'sataData', requires: ['motherboard'] },
  sata2: { name: 'SATA port 2', accepts: 'sataData', requires: ['motherboard'] },
  sata3: { name: 'SATA port 3', accepts: 'sataData', requires: ['motherboard'] },
  sata4: { name: 'SATA port 4', accepts: 'sataData', requires: ['motherboard'] },
}

/** Teacher-editable grading rules. Points are deducted from 100. */
export const RULES = {
  missing: {
    standoffs: [15, 'No standoffs: the motherboard sits directly on the metal case and can short out.'],
    paste: [15, 'No thermal paste: the CPU cannot transfer heat to the cooler and will overheat.'],
    cable24: [10, '24-pin ATX cable not connected: the motherboard gets no power.'],
    cableEps: [10, '8-pin EPS cable not connected: the CPU gets no power.'],
    cablePcie: [10, 'PCIe power cable not connected: the graphics card gets no power.'],
    cableSataPower: [10, 'SATA power cable not connected: the SSD gets no power.'],
  } as Partial<Record<PartId, [number, string]>>,
  missingDefault: 15,
  /** Graded by what's plugged into these slots rather than by part (for cables whose ends are interchangeable). */
  connections: [
    { slots: ['sata1', 'sata2', 'sata3', 'sata4'], points: 10, message: 'SATA data cable not plugged into the motherboard: the SSD will not be detected.' },
    { slots: ['ssdData'], points: 10, message: 'SATA data cable not plugged into the SSD: it will not be detected.' },
  ] as { slots: SlotId[]; points: number; message: string }[],
  placement: [
    { parts: ['ram1', 'ram2'], slots: ['dimmA2', 'dimmB2'], points: 5,
      message: 'RAM should go in slots A2 and B2 so it runs in dual-channel mode (check the motherboard manual).' },
    { parts: ['gpu'], slots: ['pcie1'], points: 5,
      message: 'The graphics card belongs in the top PCIe x16 slot, which has the full x16 lanes from the CPU.' },
  ] as { parts: PartId[]; slots: SlotId[]; points: number; message: string }[],
  order: [
    { first: ['ram1', 'ram2'], then: 'cooler', points: 5,
      message: 'Install RAM before the CPU cooler; large coolers block access to the DIMM slots.' },
  ] as { first: PartId[]; then: PartId; points: number; message: string }[],
  timeLimitMin: 8,
  timePerMin: 1,
  timeCap: 10,
  letters: [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F']] as [number, string][],
}

/** Replays the log: what is installed now, where, and at which log index it was last placed. */
export function installed(log: PlaceEvent[]): Map<PartId, { slot: SlotId; i: number }> {
  const at = new Map<PartId, { slot: SlotId; i: number }>()
  log.forEach((e, i) => (e.slot ? at.set(e.part, { slot: e.slot, i }) : at.delete(e.part)))
  return at
}

const kindsOf = (at: Map<PartId, unknown>, except?: PartId) =>
  new Set([...at.keys()].filter(p => p !== except).map(p => PARTS[p].kind))

export function isSlotOpen(slot: SlotId, log: PlaceEvent[]): boolean {
  const s = SLOTS[slot]
  const at = installed(log)
  const kinds = kindsOf(at)
  return ![...at.values()].some(x => x.slot === slot)
    && (s.requires ?? []).every(k => kinds.has(k))
    && !(s.hiddenBy ?? []).some(k => kinds.has(k))
}

/**
 * Installed parts that must come off before `part` can be removed: whatever covers its slot
 * (hiddenBy), and whatever sits in a slot that requires it (unless another part of the same kind remains).
 */
export function removalBlockers(part: PartId, log: PlaceEvent[]): PartId[] {
  const at = installed(log)
  const mine = at.get(part)
  if (!mine) return []
  const kind = PARTS[part].kind
  const stillProvided = kindsOf(at, part).has(kind)
  return [...at].filter(([p, { slot }]) => p !== part && (
    (SLOTS[mine.slot].hiddenBy ?? []).includes(PARTS[p].kind) ||
    (!stillProvided && (SLOTS[slot].requires ?? []).includes(kind))
  )).map(([p]) => p)
}

export function grade(log: PlaceEvent[], elapsedMs: number): GradeResult {
  const deductions: Deduction[] = []
  const at = installed(log) // grade the finished build; fixed mistakes only cost time

  const byConnection = new Set(RULES.connections.flatMap(c => c.slots.map(s => SLOTS[s].accepts)))
  const used = new Set([...at.values()].map(x => x.slot))
  for (const part of Object.keys(PARTS) as PartId[]) {
    if (at.has(part) || byConnection.has(PARTS[part].kind)) continue
    const [points, message] = RULES.missing[part] ?? [RULES.missingDefault, `${PARTS[part].name} is not installed.`]
    deductions.push({ category: 'Forgotten', points, message })
  }
  for (const c of RULES.connections) {
    if (!c.slots.some(s => used.has(s))) deductions.push({ category: 'Forgotten', points: c.points, message: c.message })
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
