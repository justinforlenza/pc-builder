import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PARTS, SLOTS, installed, isSlotOpen, removalBlockers, type PartId, type PlaceEvent, type SlotId } from './grade.ts'
import { buildCase, buildDesk, buildPartMesh, placeAtRest, setInstalledLook, v, GPU_POWER_OFFSET, PSU_CABLE_EXIT, SATA_RED, SLOT_POS } from './models.ts'

const SNAP_PX = 70
const CLICK_PX = 5
const HOVER_GLOW = 0x1e4a66

/** Cables stay hidden until their installed component is clicked. */
const CABLE_OWNER: Partial<Record<PartId, PartId>> = {
  cable24: 'psu', cableEps: 'psu', cablePcie: 'psu', cableSataPower: 'psu',
  sataDataMb: 'ssd', sataDataDrive: 'ssd',
}
const CABLES = Object.keys(CABLE_OWNER) as PartId[]
const partner = (id: PartId): PartId | null =>
  id === 'sataDataMb' ? 'sataDataDrive' : id === 'sataDataDrive' ? 'sataDataMb' : null
/** Both data-cable ends share one tube, keyed 'sataData'. */
const tubeKey = (id: PartId) => (partner(id) ? 'sataData' : id)

function label(text: string, at: THREE.Vector3, height = 0.24) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 40px system-ui, sans-serif'
  c.width = Math.ceil(ctx.measureText(text).width) + 24
  c.height = 56
  ctx.fillStyle = 'rgba(20,20,28,0.8)'
  ctx.roundRect(0, 0, c.width, c.height, 12)
  ctx.fill()
  ctx.font = 'bold 40px system-ui, sans-serif'
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 12, c.height / 2 + 2)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
  s.scale.set((height * c.width) / c.height, height, 1)
  s.position.copy(at)
  s.renderOrder = 10
  s.raycast = () => {} // labels never block a grab
  return s
}

function buildPart(id: PartId): THREE.Group {
  const g = buildPartMesh(id)
  if (id === 'motherboard') {
    ;['A1', 'A2', 'B1', 'B2'].forEach((t, i) => g.add(label(t, v(0.45 + i * 0.15, 1.58, 0.2), 0.12)))
    g.add(label('PCIe x16 #1', v(0.15, -0.65, 0.2), 0.12), label('PCIe x16 #2', v(0.15, -1.3, 0.2), 0.12))
    g.add(label('M.2', v(-1.2, -0.15, 0.2), 0.1))
    for (let i = 0; i < 4; i++) g.add(label(`SATA${i + 1}`, v(1.24, -0.65 - i * 0.14, 0.2), 0.1))
  }
  g.userData.rest = placeAtRest(id, g)
  // Label above the part where it waits (worldToLocal undoes the rest pose).
  const b = new THREE.Box3().setFromObject(g)
  g.userData.label = label(PARTS[id].name, g.worldToLocal(v((b.min.x + b.max.x) / 2, b.max.y + 0.15, b.max.z + 0.1)))
  g.add(g.userData.label)
  g.userData.part = id
  g.visible = !CABLE_OWNER[id]
  return g
}

export interface SceneEvents {
  /** A part was installed in / moved to `slot`, or removed (slot = null). */
  onChange(part: PartId, slot: SlotId | null): void
  /** The student tried to pull out a part that other installed parts are attached to or covering. */
  onBlocked(part: PartId, blockers: PartId[]): void
}

/** Visual aids, both off by default: floating part names, and the blue dots on open slots while dragging. */
export interface SceneOptions { labels: boolean; guides: boolean }

export function createScene(canvas: HTMLCanvasElement, { onChange, onBlocked }: SceneEvents) {
  const options: SceneOptions = { labels: false, guides: false }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xdfe3ea)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(4.6, 6, 14)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(4, 8, 10)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2), sun)

  scene.add(buildCase())
  scene.add(buildDesk())

  const parts = new Map((Object.keys(PARTS) as PartId[]).map(id => [id, buildPart(id)]))
  parts.forEach(p => scene.add(p))
  const log: PlaceEvent[] = []
  const isPlaced = (id: PartId) => installed(log).has(id)
  const syncLabels = () => parts.forEach((g, id) => (g.userData.label.visible = options.labels && !isPlaced(id)))
  syncLabels()

  // Visual-only cable runs: PSU cables from the modular panel, the SATA data cable between its two ends.
  const tubes = new Map<string, THREE.Mesh>()
  const updateTube = (key: string) => {
    const old = tubes.get(key)
    if (old) { scene.remove(old); old.geometry.dispose() }
    tubes.delete(key)
    const z = (p: THREE.Vector3, dz: number) => p.clone().add(v(0, 0, dz))
    let pts: THREE.Vector3[]
    if (key === 'sataData') {
      const a = parts.get('sataDataMb')!, b = parts.get('sataDataDrive')!
      if (!a.visible || !b.visible) return
      pts = [z(a.position, 0.15), z(a.position, 0.5), z(b.position, 0.5), z(b.position, 0.15)]
    } else {
      const c = parts.get(key as PartId)!
      if (!c.visible) return
      const from = parts.get('psu')!.position.clone().add(PSU_CABLE_EXIT)
      pts = [from, from.clone().add(v(0.3, 0.3, 0.6)), z(c.position, 0.6), z(c.position, 0.15)]
    }
    const color = key === 'sataData' ? SATA_RED : 0x111111
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.04, 8), new THREE.MeshStandardMaterial({ color }))
    tubes.set(key, m)
    scene.add(m)
  }

  /** Show the loose cables of an installed `owner` (or none). A data-cable end stays out while its other end is plugged in. */
  let revealed: PartId | null = null
  const reveal = (owner: PartId | null) => {
    revealed = owner
    for (const id of CABLES) {
      if (isPlaced(id)) continue
      const p = partner(id)
      parts.get(id)!.visible = (CABLE_OWNER[id] === owner && isPlaced(owner!)) || (p !== null && isPlaced(p))
      parts.get(id)!.position.copy(parts.get(id)!.userData.rest.position)
    }
    new Set(CABLES.map(tubeKey)).forEach(updateTube)
  }

  const slotPos = (s: SlotId) =>
    s === 'pciePower' ? parts.get('gpu')!.position.clone().add(GPU_POWER_OFFSET) : SLOT_POS[s]

  const markerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.45, depthTest: false })
  const hotMat = markerMat.clone()
  hotMat.opacity = 0.9
  const markers = new Map((Object.keys(SLOTS) as SlotId[]).map(s => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), markerMat)
    m.visible = false
    m.renderOrder = 5
    scene.add(m)
    return [s, m]
  }))

  const controls = new OrbitControls(camera, canvas)
  controls.target.set(4.6, -1.4, 1.6)
  controls.enableDamping = true

  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const plane = new THREE.Plane()
  const grab = new THREE.Vector3()
  const hit = new THREE.Vector3()
  let drag: { id: PartId; group: THREE.Group; candidates: SlotId[]; from: SlotId | null } | null = null
  /** Pointer went down on an installed part: a click (reveal cables) or, once it moves, a removal drag. */
  let pending: { id: PartId; group: THREE.Group } | null = null
  let nearest: SlotId | null = null
  let downAt: { x: number; y: number } | null = null

  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
  }

  const pick = (candidates: THREE.Object3D[]) => {
    let o: THREE.Object3D | null = ray.intersectObjects(candidates, true)[0]?.object ?? null
    while (o && !o.userData.part) o = o.parent
    return o as THREE.Group | null
  }

  const screenDist = (a: THREE.Vector3, b: THREE.Vector3) => {
    const r = canvas.getBoundingClientRect()
    const pa = a.clone().project(camera), pb = b.clone().project(camera)
    return Math.hypot((pa.x - pb.x) * r.width / 2, (pa.y - pb.y) * r.height / 2)
  }

  /** Lift a part (from the mat, or out of its slot) and light up every slot it could go in. Expects `ray` at the pointer. */
  // Hover highlight: tint every mesh of the part under the pointer (each mesh has its own material).
  let hovered: THREE.Group | null = null
  const setHover = (g: THREE.Group | null) => {
    if (g === hovered) return
    const tint = (target: THREE.Group | null, hex: number) => target?.traverse(o => {
      const m = (o as THREE.Mesh).material
      if (m instanceof THREE.MeshStandardMaterial) m.emissive.setHex(hex)
    })
    tint(hovered, 0x000000)
    tint(g, HOVER_GLOW)
    hovered = g
    canvas.style.cursor = g ? 'grab' : ''
  }

  const startDrag = (id: PartId, group: THREE.Group) => {
    const from = installed(log).get(id)?.slot ?? null
    const lifted: PlaceEvent[] = from ? [...log, { part: id, slot: null, t: 0 }] : log
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), group.position)
    ray.ray.intersectPlane(plane, hit)
    grab.copy(group.position).sub(hit)
    const candidates = (Object.keys(SLOTS) as SlotId[]).filter(s => SLOTS[s].accepts === PARTS[id].kind && isSlotOpen(s, lifted))
    candidates.forEach(s => markers.get(s)!.position.copy(slotPos(s)))
    candidates.forEach(s => (markers.get(s)!.visible = options.guides))
    drag = { id, group, candidates, from }
    setHover(group)
    canvas.style.cursor = 'grabbing'
  }

  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY }
    toNdc(e)
    const group = pick([...parts.values()].filter(g => g.visible))
    if (!group) return
    const id = group.userData.part as PartId
    controls.enabled = false
    canvas.setPointerCapture(e.pointerId)
    if (isPlaced(id)) pending = { id, group }
    else startDrag(id, group)
  }

  const onMove = (e: PointerEvent) => {
    toNdc(e)
    if (pending && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= CLICK_PX) {
      const blockers = removalBlockers(pending.id, log)
      if (blockers.length) onBlocked(pending.id, blockers)
      else startDrag(pending.id, pending.group)
      pending = null
    }
    if (!drag && !downAt) setHover(pick([...parts.values()].filter(g => g.visible))) // not while orbiting
    if (!drag) return
    if (ray.ray.intersectPlane(plane, hit)) drag.group.position.copy(hit).add(grab)
    if (CABLE_OWNER[drag.id]) updateTube(tubeKey(drag.id))
    nearest = null
    let best = SNAP_PX
    for (const s of drag.candidates) {
      const d = screenDist(drag.group.position, slotPos(s))
      if (d < best) [best, nearest] = [d, s]
    }
    drag.candidates.forEach(s => (markers.get(s)!.material = s === nearest ? hotMat : markerMat))
  }

  // A click (no drag) on an installed PSU or SSD shows its cables; a click anywhere else hides them.
  const onClick = () => {
    const owner = pick((['psu', 'ssd'] as PartId[]).filter(isPlaced).map(id => parts.get(id)!))
    reveal(owner ? owner.userData.part : null)
  }

  const commit = (id: PartId, slot: SlotId | null) => {
    log.push({ part: id, slot, t: 0 })
    onChange(id, slot)
  }

  const onUp = (e: PointerEvent) => {
    const wasClick = e.type === 'pointerup' && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < CLICK_PX
    downAt = null
    pending = null
    controls.enabled = true
    if (!drag) {
      if (wasClick) { toNdc(e); onClick() }
      return
    }
    const { id, group, from } = drag
    const to = nearest
    drag = null
    nearest = null
    markers.forEach(m => (m.visible = false))
    setHover(null) // before any look swap, so the swapped-out look isn't left tinted
    if (to) { // install, move, or put back where it was
      group.position.copy(slotPos(to))
      group.rotation.set(0, 0, 0)
      setInstalledLook(group, true)
      if (to !== from) commit(id, to)
    } else { // back to the mat (removing it, if it was installed)
      group.position.copy(group.userData.rest.position)
      group.rotation.copy(group.userData.rest.rotation)
      setInstalledLook(group, false)
      if (from) commit(id, null)
    }
    // A pulled cable goes back to its spot beside its component; removing a PSU/SSD hides its loose cables.
    reveal(from && !to && CABLE_OWNER[id] ? CABLE_OWNER[id]! : revealed)
    if (CABLE_OWNER[id]) updateTube(tubeKey(id))
    syncLabels()
  }

  canvas.addEventListener('pointerdown', onDown, { capture: true }) // before OrbitControls sees it
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  const onLeave = () => { if (!drag) setHover(null) }
  canvas.addEventListener('pointerleave', onLeave)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  return {
    setOptions(o: SceneOptions) {
      Object.assign(options, o)
      syncLabels()
    },
    dispose() {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      controls.dispose()
      canvas.removeEventListener('pointerdown', onDown, { capture: true })
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      renderer.dispose()
    },
  }
}
