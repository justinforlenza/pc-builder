import * as THREE from 'three'
import type { PartId, SlotId } from './grade.ts'

// Geometry and layout. Untextured: realism comes from shape and dimension only.
// World: the case's motherboard tray is the z=0 plane, the open side faces +z (the camera),
// rear of the case (I/O, PSU, expansion slots) is the x=-2.3 wall. 1 unit ≈ 9.5 cm.
// Every part is built with its origin at its mount point, so snapping = copy slot position.

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const BOARD = v(-0.6, 0.6, 0.12) // motherboard back face, sitting on 0.12-tall standoffs
const onBoard = (x: number, y: number, z = 0.06) => BOARD.clone().add(v(x, y, z))
const SOCKET = onBoard(-0.5, 0.7)

export const SLOT_POS: Record<Exclude<SlotId, 'pciePower'>, THREE.Vector3> = {
  standoffs: BOARD.clone().setZ(0),
  motherboard: BOARD,
  socket: SOCKET,
  paste: SOCKET.clone().add(v(0, 0, 0.08)),
  cooler: SOCKET.clone().add(v(0, 0, 0.09)),
  dimmA1: onBoard(0.45, 0.7), dimmA2: onBoard(0.6, 0.7), dimmB1: onBoard(0.75, 0.7), dimmB2: onBoard(0.9, 0.7),
  m2: onBoard(-0.5, -0.95),
  pcie1: onBoard(-0.78, -0.65), pcie2: onBoard(-0.78, -1.3),
  psu: v(-1.45, -2.05, 1),
  atx24: onBoard(1.5, 0.45),
  eps8: onBoard(-1, 1.48),
}
/** GPU power socket relative to the GPU's slot (the GPU can sit in either x16 slot). */
export const GPU_POWER_OFFSET = v(1.3, -0.05, 1.15)
/** Where cables leave the PSU's modular panel, relative to the PSU. */
export const PSU_CABLE_EXIT = v(0.82, 0.15, 0)

// Where each part hangs on the pegboard before it's installed.
export const REST: Record<PartId, THREE.Vector3> = {
  motherboard: v(5, 1.1, 0.05), standoffs: v(5, -2.1, 0.05),
  cooler: v(7.6, 1.6, 0.05), gpu: v(10, 2.4, 0.05), psu: v(10.6, 0.7, 0.8),
  cpu: v(7.4, 0.1, 0.05), paste: v(8.6, 0.1, 0.05), m2: v(7.6, -0.9, 0.05),
  ram1: v(9.4, -1.4, 0.05), ram2: v(10.6, -1.4, 0.05),
  cable24: v(7.4, -3, 0.05), cableEps: v(9.5, -3, 0.05), cablePcie: v(11.5, -3, 0.05),
}

// Palette
const PCB = 0x1f3d2b, BLACK = 0x161616, DARK = 0x2a2a2e, METAL = 0xa8acb2, ALU = 0xc9ccd1,
  GOLD = 0xd4af37, COPPER = 0xb87333, WHITE = 0xe8e8e8, CASE = 0x3a3f4b

function box(w: number, h: number, d: number, color: number, at = v(0, 0, d / 2), metal = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: 0.6 }))
  m.position.copy(at)
  return m
}

/** Cylinder along the given axis. */
function cyl(r: number, h: number, color: number, at: THREE.Vector3, axis: 'x' | 'y' | 'z' = 'z', seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }))
  if (axis === 'z') m.rotation.x = Math.PI / 2
  if (axis === 'x') m.rotation.z = Math.PI / 2
  m.position.copy(at)
  return m
}

function group(...children: THREE.Object3D[]) {
  const g = new THREE.Group()
  g.add(...children)
  return g
}

/** Fan of diameter d and thickness t in the XY plane, blowing along z, centered on the origin. */
function fan(d: number, t: number, color = BLACK) {
  const bar = 0.07 * d
  const g = group(
    box(d, bar, t, color, v(0, d / 2 - bar / 2, 0)), box(d, bar, t, color, v(0, -d / 2 + bar / 2, 0)),
    box(bar, d, t, color, v(d / 2 - bar / 2, 0, 0)), box(bar, d, t, color, v(-d / 2 + bar / 2, 0, 0)),
    cyl(0.17 * d, t * 0.9, color, v(0, 0, 0)),
  )
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(0.18 * d, 0.18 * d, t, color, v(sx * 0.41 * d, sy * 0.41 * d, 0)))
  for (let i = 0; i < 7; i++) {
    const blade = box(0.34 * d, 0.13 * d, t * 0.12, color, v(0.27 * d, 0, 0))
    blade.rotation.x = 0.45
    const arm = group(blade)
    arm.rotation.z = (i / 7) * Math.PI * 2
    g.add(arm)
  }
  return g
}

/** Finned heatsink sitting on z=0: a base plus n plates across its longer side. */
function heatsink(w: number, h: number, d: number, n: number, color = DARK) {
  const g = group(box(w, h, d * 0.3, color, v(0, 0, d * 0.15), 0.5))
  const along = w >= h
  const step = (along ? w : h) / n
  for (let i = 0; i < n; i++) {
    const o = -((along ? w : h) / 2) + step * (i + 0.5)
    g.add(along
      ? box(step * 0.45, h, d, color, v(o, 0, d / 2), 0.5)
      : box(w, step * 0.45, d, color, v(0, o, d / 2), 0.5))
  }
  return g
}

/** Flat panel with rectangular/circular holes, in its local XY plane, extruded along +z. */
function panel(x0: number, y0: number, x1: number, y1: number, depth: number,
  holes: ([number, number, number, number] | [number, number, number])[]) {
  const s = new THREE.Shape()
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.closePath()
  for (const h of holes) {
    const p = new THREE.Path()
    if (h.length === 3) p.absarc(h[0], h[1], h[2], 0, Math.PI * 2, true)
    else { p.moveTo(h[0], h[1]); p.lineTo(h[0], h[3]); p.lineTo(h[2], h[3]); p.lineTo(h[2], h[1]); p.closePath() }
    s.holes.push(p)
  }
  return new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: CASE, metalness: 0.3, roughness: 0.7 }))
}

export function buildCase(): THREE.Group {
  // Motherboard tray with a CPU-backplate cutout and cable-routing slots.
  const tray = panel(-2.3, -2.5, 2.3, 2.5, 0.1, [
    [-1.55, 0.85, -0.65, 1.75],
    [1.25, 0.5, 1.45, 1.6], [1.25, -1.1, 1.45, -0.1],
  ])
  tray.position.z = -0.1

  // Rear wall, drawn in (z, y) and turned to face -x. Cutouts: I/O shield, exhaust fan,
  // seven expansion-slot openings, PSU.
  const slots: [number, number, number, number][] = Array.from({ length: 7 }, (_, i) => [0.25, -0.16 - i * 0.21, 1.35, -0.05 - i * 0.21])
  const rear = panel(0, -2.5, 2.2, 2.5, 0.1, [
    [0.15, 0.6, 0.62, 2],
    [1.35, 1.35, 0.48],
    ...slots,
    [0.3, -2.4, 1.7, -1.7],
  ])
  rear.rotation.y = -Math.PI / 2
  rear.position.x = -2.3

  const rearFan = fan(1, 0.25)
  rearFan.rotation.y = Math.PI / 2
  rearFan.position.set(-2.16, 1.35, 1.35)

  const feet = [-1.9, 1.9].flatMap(x => [0.3, 1.9].map(z => box(0.4, 0.12, 0.25, BLACK, v(x, -2.66, z))))

  return group(
    tray, rear, rearFan, ...feet,
    box(4.6, 0.1, 2.2, CASE, v(0, 2.55, 1.1)), box(4.6, 0.1, 2.2, CASE, v(0, -2.55, 1.1)),
    box(0.1, 5.2, 2.2, CASE, v(2.35, 0, 1.1)),
  )
}

function motherboard(g: THREE.Group) {
  const B = (x: number, y: number, z = 0.06) => v(x, y, z) // local board coords, z=0.06 is the top surface
  const on = (w: number, h: number, d: number, color: number, x: number, y: number, metal = 0) =>
    g.add(box(w, h, d, color, B(x, y, 0.06 + d / 2), metal))

  g.add(box(3.2, 3.2, 0.06, PCB))
  for (const [x, y] of [[-1.4, 1.4], [1.4, 1.4], [-1.4, 0], [1.4, 0], [-1.4, -1.4], [1.4, -1.4]])
    g.add(cyl(0.07, 0.004, METAL, B(x, y, 0.062)))

  // LGA socket: base, gold pin field, retention frame, load lever.
  on(0.6, 0.6, 0.02, 0x555555, -0.5, 0.7)
  on(0.42, 0.42, 0.024, GOLD, -0.5, 0.7, 0.6)
  for (const [x, y, w, h] of [[-0.5, 0.98, 0.56, 0.04], [-0.5, 0.42, 0.56, 0.04], [-0.78, 0.7, 0.04, 0.6], [-0.22, 0.7, 0.04, 0.6]] as const)
    on(w, h, 0.05, METAL, x, y, 0.8)
  g.add(cyl(0.012, 0.62, METAL, B(-0.15, 0.7, 0.09), 'y'), cyl(0.012, 0.1, METAL, B(-0.1, 1.0, 0.09), 'x'))

  // VRM: chokes and finned heatsinks wrapping the socket on the rear and top sides.
  for (let i = 0; i < 6; i++) on(0.08, 0.08, 0.07, 0x444444, -0.92, 0.35 + i * 0.13)
  for (let i = 0; i < 6; i++) on(0.08, 0.08, 0.07, 0x444444, -0.82 + i * 0.13, 1.12)
  const vrmL = heatsink(0.22, 1.0, 0.24, 8); vrmL.position.copy(B(-1.12, 0.7)); g.add(vrmL)
  const vrmT = heatsink(1.0, 0.18, 0.24, 9); vrmT.position.copy(B(-0.5, 1.29)); g.add(vrmT)

  // Rear I/O block with ports facing the case's rear wall.
  on(0.32, 1.2, 0.44, METAL, -1.46, 0.7, 0.6)
  on(0.34, 1.22, 0.05, DARK, -1.46, 0.7)
  const port = (y: number, z: number, h: number, d: number, color: number) => g.add(box(0.03, h, d, color, B(-1.635, y, 0.06 + z)))
  for (const y of [0.22, 0.42]) { port(y, 0.12, 0.15, 0.06, 0x1565c0); port(y, 0.24, 0.15, 0.06, 0x1565c0) }
  port(0.65, 0.2, 0.17, 0.15, BLACK) // ethernet
  port(0.65, 0.36, 0.15, 0.06, BLACK) // USB-C
  port(0.88, 0.32, 0.18, 0.06, BLACK) // HDMI
  ;[0xf06292, 0x66bb6a, 0x42a5f5].forEach((c, i) => g.add(cyl(0.035, 0.03, c, B(-1.635, 1.0 + i * 0.1, 0.18), 'x')))

  // DIMM slots with latches.
  for (const x of [0.45, 0.6, 0.75, 0.9]) {
    on(0.07, 1.4, 0.06, BLACK, x, 0.7)
    on(0.08, 0.06, 0.1, 0x777777, x, 1.43)
    on(0.08, 0.06, 0.1, 0x777777, x, -0.03)
  }

  // PCIe x16 slots: key notch splits the slot, latch at the far end; top slot gets metal armor.
  for (const [y, armor] of [[-0.65, true], [-1.3, false]] as const) {
    if (armor) on(0.98, 0.11, 0.05, METAL, -0.78, y, 0.8)
    on(0.13, 0.075, 0.075, BLACK, -1.18, y)
    on(0.8, 0.075, 0.075, BLACK, -0.7, y)
    on(0.06, 0.09, 0.1, 0x777777, -0.27, y)
  }
  // PCIe x1 slot between them.
  on(0.26, 0.075, 0.07, BLACK, -1.1, -0.98)

  // M.2 socket and its standoff.
  on(0.06, 0.2, 0.05, BLACK, -0.97, -0.95)
  g.add(cyl(0.025, 0.04, GOLD, B(-0.04, -0.95, 0.08)))

  // Chipset heatsink, CMOS battery, SATA ports, headers, capacitors.
  on(0.5, 0.5, 0.06, DARK, 0.8, -1.0, 0.5)
  on(0.36, 0.36, 0.04, 0x3d3d44, 0.8, -1.0, 0.5)
  g.add(cyl(0.1, 0.03, ALU, B(0.25, -0.62, 0.075)))
  for (let i = 0; i < 4; i++) on(0.14, 0.1, 0.07, BLACK, 1.5, -0.65 - i * 0.14)
  on(0.12, 0.6, 0.12, WHITE, 1.5, 0.45) // 24-pin header
  on(0.35, 0.12, 0.12, WHITE, -1, 1.48) // EPS header
  on(0.35, 0.07, 0.05, BLACK, 0.85, -1.5) // front-panel header
  on(0.2, 0.07, 0.05, BLACK, 0.3, -1.5) // USB header
  for (const [x, y] of [[0.2, 1.45], [1.35, 1.45], [1.35, -0.2]]) on(0.1, 0.05, 0.06, WHITE, x, y) // fan headers
  for (let i = 0; i < 4; i++) g.add(cyl(0.035, 0.09, 0xf9a825, B(-1.3 + i * 0.1, -1.5, 0.105))) // audio caps
  for (let i = 0; i < 5; i++) g.add(cyl(0.03, 0.08, BLACK, B(-0.25 + i * 0.09, 1.45, 0.1)))
}

function gpu(g: THREE.Group) {
  // Origin = slot center at the board surface. Card is perpendicular to the board (z),
  // cooler shroud hangs below the PCB (-y), bracket at the rear (-x).
  const L = 2.48, cx = 0.36, D = 1.02, cz = 0.08 + D / 2
  g.add(
    box(L, 0.03, D, 0x1b3a26, v(cx, 0, cz)), // PCB
    box(0.9, 0.025, 0.08, GOLD, v(0, 0, 0.04), 0.6), // edge connector
    box(L, 0.02, D, DARK, v(cx, 0.03, cz), 0.6), // backplate
    box(L - 0.1, 0.18, D - 0.12, METAL, v(cx, -0.11, cz), 0.6), // fin stack, peeking out from the shroud
    box(L, 0.14, D, BLACK, v(cx, -0.27, cz)), // shroud
    box(L, 0.03, 0.06, 0xb71c1c, v(cx, -0.33, 0.08 + D - 0.04)), // accent strip
    box(0.03, 0.44, 1.2, ALU, v(-0.9, -0.17, 0.6), 0.8), // bracket
    box(0.3, 0.1, 0.1, BLACK, GPU_POWER_OFFSET.clone().setZ(1.1)), // 8-pin power socket
  )
  for (const x of [-0.45, 0.36, 1.17]) {
    const f = fan(0.72, 0.06)
    f.rotation.x = Math.PI / 2
    f.position.set(x, -0.37, cz)
    g.add(f)
  }
  for (const z of [0.3, 0.55, 0.8]) g.add(box(0.03, 0.06, 0.15, BLACK, v(-0.925, -0.1, z))) // DisplayPorts
  g.add(box(0.03, 0.06, 0.18, BLACK, v(-0.925, -0.25, 0.45))) // HDMI
  for (const z of [0.3, 0.55, 0.8, 1.05]) g.add(box(0.035, 0.12, 0.05, BLACK, v(-0.93, -0.28, z))) // vent slots
}

function psu(g: THREE.Group) {
  // Origin = center. Rear (-x) has the AC inlet, switch and vent; front (+x) the modular panel; fan on the bottom.
  g.add(box(1.6, 0.8, 1.5, 0x1e1e1e, v(0, 0, 0)))
  g.add(box(1.1, 0.5, 0.01, 0x3a3a40, v(0, 0, 0.755))) // spec label
  const f = fan(1.2, 0.04)
  f.rotation.x = Math.PI / 2
  f.position.set(0, -0.42, 0)
  g.add(f)
  g.add(box(0.03, 0.18, 0.26, BLACK, v(-0.815, 0.2, -0.45))) // AC inlet
  g.add(box(0.03, 0.12, 0.08, 0xc62828, v(-0.815, 0.2, -0.15))) // switch
  for (let i = 0; i < 7; i++) g.add(box(0.02, 0.6, 0.05, BLACK, v(-0.81, 0, 0.05 + i * 0.1))) // vent slats
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++)
    g.add(box(0.03, 0.14, 0.2, BLACK, v(0.815, 0.12 - r * 0.24, -0.5 + c * 0.25))) // modular sockets
}

function ram(g: THREE.Group) {
  // Origin = bottom edge center (seated in the DIMM slot).
  g.add(
    box(0.025, 1.33, 0.3, 0x1b5e20, v(0, 0, 0.15)), // PCB
    box(0.03, 1.25, 0.04, GOLD, v(0, 0, 0.02), 0.6), // contacts
  )
  // Flash chips on both faces, 4 + 4 split around the key notch.
  for (const x of [-0.0175, 0.0175])
    for (let i = 0; i < 8; i++) g.add(box(0.01, 0.13, 0.1, BLACK, v(x, -0.56 + i * 0.15 + (i >= 4 ? 0.04 : 0), 0.17)))
}

function cooler(g: THREE.Group) {
  // Tower cooler. Origin = bottom of the cold plate. Fan on the +x side blows toward the rear exhaust.
  g.add(box(0.42, 0.42, 0.06, COPPER, v(0, 0, 0.03), 0.8))
  g.add(box(0.9, 0.1, 0.03, METAL, v(0, 0, 0.075), 0.8)) // mounting bar
  for (const x of [-0.15, -0.05, 0.05, 0.15]) g.add(cyl(0.025, 0.4, COPPER, v(x, 0, 0.28)))
  for (let i = 0; i < 16; i++) g.add(box(0.5, 1.25, 0.015, ALU, v(0, 0, 0.42 + i * 0.07), 0.8))
  g.add(box(0.52, 1.27, 0.04, BLACK, v(0, 0, 1.52))) // top cover
  const f = fan(1.2, 0.12)
  f.rotation.y = Math.PI / 2
  f.position.set(0.32, 0, 0.95)
  g.add(f)
}

function cpu(g: THREE.Group) {
  g.add(
    box(0.45, 0.45, 0.02, 0x2e5d3a, v(0, 0, 0.03)), // substrate
    box(0.36, 0.42, 0.025, ALU, v(0, 0, 0.0525), 0.8), // heat spreader
    box(0.3, 0.3, 0.012, ALU, v(0, 0, 0.071), 0.8),
    box(0.04, 0.04, 0.004, GOLD, v(-0.2, -0.2, 0.042)), // pin-1 marker
  )
}

function m2(g: THREE.Group) {
  g.add(
    box(0.9, 0.2, 0.015, 0x0d1b4c, v(0, 0, 0.0075)),
    box(0.05, 0.18, 0.016, GOLD, v(-0.43, 0, 0.008), 0.6),
    box(0.14, 0.14, 0.02, BLACK, v(-0.25, 0, 0.025)), // controller
    box(0.2, 0.15, 0.02, BLACK, v(0.02, 0, 0.025)), box(0.2, 0.15, 0.02, BLACK, v(0.27, 0, 0.025)), // NAND
  )
}

function plug(g: THREE.Group, w: number, h: number) {
  g.add(box(w, h, 0.15, BLACK), box(Math.min(w, h) * 0.6, 0.04, 0.08, BLACK, v(0, h / 2 + 0.02, 0.1)))
}

export function buildPartMesh(id: PartId): THREE.Group {
  const g = new THREE.Group()
  switch (id) {
    case 'standoffs':
      for (const [x, y] of [[-1.4, 1.4], [1.4, 1.4], [-1.4, 0], [1.4, 0], [-1.4, -1.4], [1.4, -1.4]])
        g.add(cyl(0.06, 0.12, GOLD, v(x, y, 0.06), 'z', 6), cyl(0.025, 0.05, GOLD, v(x, y, 0.145)))
      break
    case 'motherboard': motherboard(g); break
    case 'cpu': cpu(g); break
    case 'paste': g.add(cyl(0.11, 0.015, 0x9e9e9e, v(0, 0, 0.008))); break
    case 'cooler': cooler(g); break
    case 'ram1': case 'ram2': ram(g); break
    case 'm2': m2(g); break
    case 'gpu': gpu(g); break
    case 'psu': psu(g); break
    case 'cable24': plug(g, 0.12, 0.6); break
    case 'cableEps': plug(g, 0.35, 0.12); break
    case 'cablePcie': plug(g, 0.3, 0.12); break
  }
  return g
}
