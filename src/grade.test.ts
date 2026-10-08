import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grade, isSlotOpen, removalBlockers, type PlaceEvent, type PartId, type SlotId } from './grade.ts'

const PERFECT: [PartId, SlotId][] = [
  ['standoffs', 'standoffs'], ['motherboard', 'motherboard'], ['cpu', 'socket'], ['ram1', 'dimmA2'],
  ['ram2', 'dimmB2'], ['m2', 'm2'], ['paste', 'paste'], ['cooler', 'cooler'], ['psu', 'psu'],
  ['gpu', 'pcie1'], ['cable24', 'atx24'], ['cableEps', 'eps8'], ['cablePcie', 'pciePower'],
  ['ssd', 'driveBay'], ['cableSataPower', 'sataPower'], ['sataData1', 'ssdData'], ['sataData2', 'sata1'],
]
const log = (steps: [PartId, SlotId][]): PlaceEvent[] => steps.map(([part, slot], t) => ({ part, slot, t }))
const without = (part: PartId) => PERFECT.filter(([p]) => p !== part)
const MIN = 60_000

test('perfect build scores 100 / A', () => {
  assert.deepEqual(grade(log(PERFECT), 5 * MIN), { score: 100, letter: 'A', deductions: [] })
})

test('every step in the perfect build was reachable in that order', () => {
  PERFECT.forEach(([, slot], i) => assert.ok(isSlotOpen(slot, log(PERFECT.slice(0, i))), slot))
})

test('forgotten thermal paste costs 15', () => {
  const r = grade(log(without('paste')), 0)
  assert.equal(r.score, 85)
  assert.equal(r.deductions[0].category, 'Forgotten')
})

test('paste slot closes once the cooler is on', () => {
  assert.equal(isSlotOpen('paste', log(without('paste'))), false)
})

test('RAM in A1 is a placement deduction', () => {
  const steps = PERFECT.map(([p, s]): [PartId, SlotId] => [p, p === 'ram1' ? 'dimmA1' : s])
  assert.equal(grade(log(steps), 0).score, 95)
})

test('RAM after cooler is an order deduction', () => {
  const steps = [...without('ram1'), ['ram1', 'dimmA2'] as [PartId, SlotId]]
  const r = grade(log(steps), 0)
  assert.deepEqual(r.deductions.map(d => d.category), ['Order'])
  assert.equal(r.score, 95)
})

test('time penalty is per full minute over 8 and capped at 10', () => {
  assert.equal(grade(log(PERFECT), 10.5 * MIN).score, 98)
  assert.equal(grade(log(PERFECT), 60 * MIN).score, 90)
})

test('empty build clamps to 0 / F', () => {
  assert.deepEqual(grade([], 0).score, 0)
  assert.equal(grade([], 0).letter, 'F')
})

test('M.2 and SATA SSD together, on any SATA port, is not penalized', () => {
  const steps = PERFECT.map(([p, s]): [PartId, SlotId] => [p, p === 'sataData2' ? 'sata2' : s])
  assert.equal(grade(log(steps), 0).score, 100)
})

test('cooler can go on an empty socket by mistake, which covers the socket', () => {
  const l = log([['standoffs', 'standoffs'], ['motherboard', 'motherboard']])
  assert.ok(isSlotOpen('cooler', l))
  const covered = [...l, { part: 'cooler', slot: 'cooler', t: 0 } as PlaceEvent]
  assert.equal(isSlotOpen('socket', covered), false)
  assert.deepEqual(removalBlockers('motherboard', covered), ['cooler'])
})

test('a fixed mistake is graded on the finished build', () => {
  const steps = log([['standoffs', 'standoffs'], ['motherboard', 'motherboard'], ['cooler', 'cooler']])
  steps.push({ part: 'cooler', slot: null, t: 0 }) // remove it again
  const rest = log(PERFECT.slice(2))
  assert.equal(grade([...steps, ...rest], 0).score, 100)
})

test('moving a part uses its final slot and install time', () => {
  const l = log(PERFECT)
  l.push({ part: 'ram1', slot: 'dimmA1', t: 0 })
  assert.deepEqual(grade(l, 0).deductions.map(d => d.category), ['Placement', 'Order'])
})

test('a removed part counts as missing', () => {
  const l = [...log(PERFECT), { part: 'cablePcie', slot: null, t: 0 } as PlaceEvent]
  assert.equal(grade(l, 0).score, 90)
})

test('parts attached to or covering a part block its removal', () => {
  const l = log(PERFECT)
  assert.deepEqual(removalBlockers('cpu', l).sort(), ['cooler', 'paste'])
  assert.deepEqual(removalBlockers('psu', l).sort(), ['cable24', 'cableEps', 'cablePcie', 'cableSataPower'])
  assert.deepEqual(removalBlockers('ram1', l), []) // the other stick still provides RAM; nothing depends on it
  assert.deepEqual(removalBlockers('standoffs', l), ['motherboard'])
})

test('SATA data cable ends are interchangeable; each missing connection costs 10', () => {
  const swapped = PERFECT.map(([p, s]): [PartId, SlotId] => [p, p === 'sataData1' ? 'sata3' : p === 'sataData2' ? 'ssdData' : s])
  assert.equal(grade(log(swapped), 0).score, 100)
  const bothInBoard = PERFECT.map(([p, s]): [PartId, SlotId] => [p, p === 'sataData1' ? 'sata3' : s])
  assert.deepEqual(grade(log(bothInBoard), 0).deductions.map(d => d.message), ['SATA data cable not plugged into the SSD: it will not be detected.'])
  assert.equal(grade(log(PERFECT.filter(([p]) => !p.startsWith('sataData'))), 0).score, 80)
})
