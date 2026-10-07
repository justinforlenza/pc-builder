import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grade, isSlotOpen, type PlaceEvent, type PartId, type SlotId } from './grade.ts'

const PERFECT: [PartId, SlotId][] = [
  ['standoffs', 'standoffs'], ['motherboard', 'motherboard'], ['cpu', 'socket'], ['ram1', 'dimmA2'],
  ['ram2', 'dimmB2'], ['m2', 'm2'], ['paste', 'paste'], ['cooler', 'cooler'], ['psu', 'psu'],
  ['gpu', 'pcie1'], ['cable24', 'atx24'], ['cableEps', 'eps8'], ['cablePcie', 'pciePower'],
  ['ssd', 'driveBay'], ['cableSataPower', 'sataPower'], ['sataDataDrive', 'ssdData'], ['sataDataMb', 'sata1'],
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

test('SATA2 is a placement deduction only while an M.2 SSD is installed', () => {
  const steps = PERFECT.map(([p, s]): [PartId, SlotId] => [p, p === 'sataDataMb' ? 'sata2' : s])
  assert.equal(grade(log(steps), 0).score, 95)
  assert.equal(grade(log(steps.filter(([p]) => p !== 'm2')), 0).score, 85) // only the missing M.2 (-15)
})
