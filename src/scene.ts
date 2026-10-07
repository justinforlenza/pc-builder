import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PARTS, SLOTS, isSlotOpen, type PartId, type PlaceEvent, type SlotId } from './grade.ts'

// World layout: the case's motherboard tray is the z=0 plane, the open side faces +z (the camera).
// Every part mesh is built with its origin at its mount point, so snapping = copy slot position.

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const BOARD = v(-0.3, 0.6, 0.12) // motherboard back face, sitting on 0.12-tall standoffs
const onBoard = (x: number, y: number, z = 0.06) => BOARD.clone().add(v(x, y, z))
const SOCKET = onBoard(-0.5, 0.7)
const PSU = v(-1, -2.05, 1)

const SLOT_POS: Record<Exclude<SlotId, 'pciePower'>, THREE.Vector3> = {
  standoffs: BOARD.clone().setZ(0),
  motherboard: BOARD,
  socket: SOCKET,
  paste: SOCKET.clone().add(v(0, 0, 0.08)),
  cooler: SOCKET.clone().add(v(0, 0, 0.09)),
  dimmA1: onBoard(0.45, 0.7), dimmA2: onBoard(0.6, 0.7), dimmB1: onBoard(0.75, 0.7), dimmB2: onBoard(0.9, 0.7),
  m2: onBoard(-0.5, -0.95),
  pcie1: onBoard(-0.2, -0.65), pcie2: onBoard(-0.2, -1.3),
  psu: PSU,
  atx24: onBoard(1.5, 0.3),
  eps8: onBoard(-1.4, 1.45),
}
const GPU_POWER_OFFSET = v(0.9, -0.15, 1.1)

// Where each part hangs on the pegboard before it's installed.
const REST: Record<PartId, THREE.Vector3> = {
  motherboard: v(5, 1.1, 0.05), standoffs: v(5, -2.1, 0.05),
  cooler: v(7.6, 1.9, 0.05), gpu: v(10.3, 2.4, 0.05), psu: v(10.6, 0.7, 0.8),
  cpu: v(7.4, 0.3, 0.05), paste: v(8.6, 0.3, 0.05), m2: v(7.6, -0.9, 0.05),
  ram1: v(9.4, -1.4, 0.05), ram2: v(10.6, -1.4, 0.05),
  cable24: v(7.4, -3, 0.05), cableEps: v(9.5, -3, 0.05), cablePcie: v(11.5, -3, 0.05),
}

function box(w: number, h: number, d: number, color: number, at = v(0, 0, d / 2)) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.copy(at)
  return m
}

function cylZ(r: number, h: number, color: number, at: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), new THREE.MeshStandardMaterial({ color, metalness: 0.5 }))
  m.rotation.x = Math.PI / 2
  m.position.copy(at)
  return m
}

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
  const g = new THREE.Group()
  const add = (...o: THREE.Object3D[]) => g.add(...o)
  switch (id) {
    case 'standoffs':
      for (const [x, y] of [[-1.4, 1.4], [1.4, 1.4], [-1.4, 0], [1.4, 0], [-1.4, -1.4], [1.4, -1.4]])
        add(cylZ(0.06, 0.12, 0xd4af37, v(x, y, 0.06)))
      break
    case 'motherboard': {
      add(box(3.2, 3.2, 0.06, 0x1f5130))
      const deco = (x: number, y: number, w: number, h: number, color = 0x111111) => add(box(w, h, 0.03, color, onBoard(x, y, 0.075).sub(BOARD)))
      deco(-0.5, 0.7, 0.6, 0.6, 0x9a9a9a) // socket
      for (const x of [0.45, 0.6, 0.75, 0.9]) deco(x, 0.7, 0.07, 1.4)
      deco(-0.5, -0.95, 0.9, 0.18, 0x333333) // M.2
      deco(-0.2, -0.65, 2, 0.09)
      deco(-0.2, -1.3, 2, 0.09)
      deco(1.5, 0.3, 0.12, 0.6, 0xe8e8e8) // 24-pin header
      deco(-1.4, 1.45, 0.35, 0.12, 0xe8e8e8) // EPS header
      ;['A1', 'A2', 'B1', 'B2'].forEach((t, i) => add(label(t, onBoard(0.45 + i * 0.15, 1.55, 0.1).sub(BOARD), 0.14)))
      add(label('PCIe x16 #1', onBoard(-1.6, -0.65, 0.1).sub(BOARD), 0.14))
      add(label('PCIe x16 #2', onBoard(-1.6, -1.3, 0.1).sub(BOARD), 0.14))
      break
    }
    case 'cpu': add(box(0.45, 0.45, 0.05, 0xc0c0c8)); break
    case 'paste': add(cylZ(0.12, 0.02, 0x8a8a8a, v(0, 0, 0.01))); break
    case 'cooler':
      add(box(0.6, 0.6, 0.1, 0xb87333), box(0.9, 0.9, 0.6, 0xaaaaaa, v(0, 0, 0.4)), cylZ(0.42, 0.12, 0x222222, v(0, 0, 0.76)))
      break
    case 'ram1': case 'ram2': add(box(0.05, 1.35, 0.4, 0x2e7d32)); break
    case 'm2': add(box(0.9, 0.2, 0.03, 0x1a237e)); break
    case 'gpu':
      add(box(2.6, 0.3, 1.1, 0x303030, v(0.2, -0.15, 0.55)), box(2.6, 0.04, 0.2, 0xb71c1c, v(0.2, -0.32, 0.9)))
      break
    case 'psu': add(box(1.6, 0.8, 1.5, 0x202020, v(0, 0, 0))); break
    case 'cable24': add(box(0.12, 0.6, 0.15, 0x111111)); break
    case 'cableEps': add(box(0.35, 0.12, 0.15, 0x111111)); break
    case 'cablePcie': add(box(0.3, 0.12, 0.15, 0x111111)); break
  }
  g.userData.label = label(PARTS[id].name, v(0, id === 'motherboard' ? 1.8 : id === 'gpu' ? 0.25 : 0.45, 1.3))
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

  // Case: back tray plus top/bottom/front/rear panels; side panel left off.
  const caseColor = 0x3a3f4b
  scene.add(
    box(4.6, 5, 0.1, caseColor, v(0, 0, -0.05)),
    box(4.6, 0.1, 2.2, caseColor, v(0, 2.55, 1.1)), box(4.6, 0.1, 2.2, caseColor, v(0, -2.55, 1.1)),
    box(0.1, 5.2, 2.2, caseColor, v(-2.35, 0, 1.1)), box(0.1, 5.2, 2.2, caseColor, v(2.35, 0, 1.1)),
    box(9.2, 6.8, 0.1, 0xc8a27a, v(7.8, -0.4, -0.05)), // pegboard
  )

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

  const SNAP_PX = 70

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

  // Visual-only cable run from the top of the PSU to the plug.
  const cableTube = (to: THREE.Vector3) => {
    const from = parts.get('psu')!.position.clone().add(v(0.5, 0.4, 0.3))
    const curve = new THREE.CatmullRomCurve3([from, from.clone().add(v(0, 0.4, 0.6)), to.clone().add(v(0, 0, 0.6)), to.clone().add(v(0, 0, 0.1))])
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
