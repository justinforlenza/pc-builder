import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PARTS, SLOTS, isSlotOpen, type PartId, type PlaceEvent, type SlotId } from './grade.ts'
import { buildCase, buildPartMesh, v, GPU_POWER_OFFSET, PSU_CABLE_EXIT, REST, SLOT_POS } from './models.ts'

const SNAP_PX = 70

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
  }
  const b = new THREE.Box3().setFromObject(g)
  g.userData.label = label(PARTS[id].name, v((b.min.x + b.max.x) / 2, b.max.y + 0.15, b.max.z + 0.1))
  g.add(g.userData.label)
  g.userData.part = id
  g.position.copy(REST[id])
  return g
}

export function createScene(canvas: HTMLCanvasElement, onPlace: (part: PartId, slot: SlotId) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xdfe3ea)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(5, 1, 14)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(4, 8, 10)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2), sun)

  scene.add(buildCase())
  const pegboard = new THREE.Mesh(new THREE.BoxGeometry(9.2, 6.8, 0.1), new THREE.MeshStandardMaterial({ color: 0xc8a27a }))
  pegboard.position.set(7.8, -0.4, -0.05)
  scene.add(pegboard)

  const parts = new Map((Object.keys(PARTS) as PartId[]).map(id => [id, buildPart(id)]))
  parts.forEach(p => scene.add(p))
  const log: PlaceEvent[] = []

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
  controls.target.set(5, -0.4, 0)
  controls.enableDamping = true

  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const plane = new THREE.Plane()
  const grab = new THREE.Vector3()
  const hit = new THREE.Vector3()
  let drag: { id: PartId; group: THREE.Group; candidates: SlotId[] } | null = null
  let nearest: SlotId | null = null

  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
  }

  const screenDist = (a: THREE.Vector3, b: THREE.Vector3) => {
    const r = canvas.getBoundingClientRect()
    const pa = a.clone().project(camera), pb = b.clone().project(camera)
    return Math.hypot((pa.x - pb.x) * r.width / 2, (pa.y - pb.y) * r.height / 2)
  }

  const onDown = (e: PointerEvent) => {
    toNdc(e)
    const loose = [...parts.values()].filter(g => !log.some(l => l.part === g.userData.part))
    let o: THREE.Object3D | null = ray.intersectObjects(loose, true)[0]?.object ?? null
    while (o && !o.userData.part) o = o.parent
    if (!o) return
    const group = o as THREE.Group
    const id = group.userData.part as PartId
    controls.enabled = false
    canvas.setPointerCapture(e.pointerId)
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), group.position)
    ray.ray.intersectPlane(plane, hit)
    grab.copy(group.position).sub(hit)
    const candidates = (Object.keys(SLOTS) as SlotId[]).filter(s => SLOTS[s].accepts === PARTS[id].kind && isSlotOpen(s, log))
    candidates.forEach(s => markers.get(s)!.position.copy(slotPos(s)))
    candidates.forEach(s => (markers.get(s)!.visible = true))
    drag = { id, group, candidates }
  }

  const onMove = (e: PointerEvent) => {
    if (!drag) return
    toNdc(e)
    if (ray.ray.intersectPlane(plane, hit)) drag.group.position.copy(hit).add(grab)
    nearest = null
    let best = SNAP_PX
    for (const s of drag.candidates) {
      const d = screenDist(drag.group.position, slotPos(s))
      if (d < best) [best, nearest] = [d, s]
    }
    drag.candidates.forEach(s => (markers.get(s)!.material = s === nearest ? hotMat : markerMat))
  }

  const onUp = () => {
    if (!drag) return
    const { id, group } = drag
    markers.forEach(m => (m.visible = false))
    if (nearest) {
      group.position.copy(slotPos(nearest))
      group.userData.label.visible = false
      log.push({ part: id, slot: nearest, t: 0 })
      if (PARTS[id].kind.startsWith('cable')) scene.add(cableTube(group.position))
      onPlace(id, nearest)
    } else {
      group.position.copy(REST[id])
    }
    drag = null
    nearest = null
    controls.enabled = true
  }

  // Visual-only cable run from the PSU's modular panel to the plug.
  const cableTube = (to: THREE.Vector3) => {
    const from = parts.get('psu')!.position.clone().add(PSU_CABLE_EXIT)
    const curve = new THREE.CatmullRomCurve3([from, from.clone().add(v(0.3, 0.3, 0.6)), to.clone().add(v(0, 0, 0.6)), to.clone().add(v(0, 0, 0.1))])
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.04, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }))
  }

  canvas.addEventListener('pointerdown', onDown, { capture: true }) // before OrbitControls sees it
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

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
    dispose() {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      controls.dispose()
      canvas.removeEventListener('pointerdown', onDown, { capture: true })
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      renderer.dispose()
    },
  }
}
