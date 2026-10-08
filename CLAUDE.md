# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev       # Vite dev server
npm run build     # tsc (typecheck only, noEmit) && vite build → dist/
npm run preview   # serve dist/ on :4173
npm test          # node:test on src/grade.test.ts via Node 22 type stripping
node --experimental-strip-types --no-warnings --test --test-name-pattern="RAM in A1" src/grade.test.ts   # single test
```

There's no linter. `npx tsc` is the only static check.

## Constraints

- **Static site only:** no server and no database. `vite.config.ts` sets `base: './'` so `dist/` works under any subpath (GitHub Pages at `/pc-builder/`, an LMS iframe). Every push to `main` deploys via `.github/workflows/deploy.yml`, and the tests gate that deploy.
- **Node runs `src/grade.ts` directly** with `--experimental-strip-types`. So in `grade.ts` and anything it imports:
  - no enums or namespaces (use string-literal unions)
  - relative imports keep the `.ts` extension (`allowImportingTsExtensions` is on)
- **`grade.ts` must stay framework-free and DOM-free.** Phase 2 (LTI 1.3 grade passback through a small serverless function) will import it server-side to re-grade a submitted event log.

## Architecture

There are three layers, and data flows one way: scene → `onChange` / `onBlocked` → app state → `grade()`.

- **`src/grade.ts`: rules and grading, the single source of truth for gameplay.**
  - `PARTS` maps each part to a `kind`.
  - `SLOTS` lists, for each slot, the kind it `accepts`, the kinds it `requires`, and the kinds it is `hiddenBy`.
  - The log is a list of `PlaceEvent`s. An event with `slot: null` is a removal, and a new slot for a part that's already installed is a move. `installed(log)` replays the log into the current state: each part's slot and the index of its last install.
  - `isSlotOpen(slot, log)` decides whether a slot can be used right now, and `removalBlockers(part, log)` lists what must come off before a part can be removed (parts covering its slot, or parts in slots that require it). The scene uses both while dragging.
  - `grade(log, elapsedMs)` grades the replayed final state, so a fixed mistake costs only time. Order rules use each part's last install index. It applies `RULES`, which covers missing parts, placement, order and time. `RULES` is the teacher-editable table.
  - `hiddenBy` makes a skipped step stick until the student takes parts back out. The standoffs slot closes once the motherboard is placed, and the socket and paste slots close once the cooler is placed. The cooler only `requires` the motherboard, so it can go on an empty socket by mistake.
  - Wrong but compatible slots (RAM in A1/B1, GPU in the bottom x16) are allowed on purpose, because they're what the placement rules grade.
- **`src/models.ts`: untextured three.js geometry and world layout.**
  - `SLOT_POS` gives each slot's world position, and `GPU_POWER_OFFSET` and `PSU_CABLE_EXIT` are relative offsets. `buildDesk()` builds the desk, the anti-static mat and the mat's ground cord. The case's feet stand on `DESK_TOP`.
  - Before a part is installed, `placeAtRest(id, g)` poses it. A part lies on the mat at its `MAT_SPOT` (x, z), rotated by `MAT_ROT` (face-up by default), and its height is derived from its bounding box. A cable waits at its `CABLE_SPOT` in front of the case. The returned pose is stored as `userData.rest`. Snapping into a slot resets the rotation to none, and a missed drop restores the rest pose.
  - Each `buildPartMesh` group has its origin at its mount point, so snapping a part means `position.copy(slotPos)`.
  - The world frame: the motherboard tray is the z=0 plane, the open side faces +z toward the camera, and the case's rear wall (I/O, expansion slots, PSU cutouts) is at x=-2.3. One unit is about 9.5 cm.
  - Moving a board slot or the PSU means keeping the rear-wall cutouts in `buildCase()` lined up with it.
  - `pciePower` has no fixed position. It's computed from wherever the GPU was placed.
- **`src/scene.ts`: interaction.**
  - Holds the renderer, OrbitControls, labels (canvas sprites, never raycast), pointer drag on a camera-facing plane, and snapping to the nearest open, compatible slot within `SNAP_PX` in screen space.
  - It keeps its own copy of the log and reports each install, move or removal through `onChange(part, slot | null)`. A removal refused by `removalBlockers` is reported through `onBlocked`.
  - Pointer down on a loose part starts a drag. On an installed part it waits (`pending`): pointer up without movement is a click, which reveals cables for the PSU or SSD, and movement past `CLICK_PX` starts a removal drag if nothing blocks it. Dropping away from every slot removes the part, and dropping on a different open slot moves it.
  - `setInstalledLook` (models) swaps between a part's two looks. The thermal paste is a syringe on the mat and a grey disc on the CPU.
  - The `pointerdown` listener is registered in the capture phase so it runs before OrbitControls.
  - **Cables start hidden.** `CABLE_OWNER` maps each cable to the component that reveals it (`psu` or `ssd`). A click (pointer up within `CLICK_PX` of pointer down, with no drag) on that component, once it's installed, calls `reveal()`. A click anywhere else hides the loose cables.
  - Revealed cables wait at their `CABLE_SPOT` in front of the case. A cable's run is drawn by `updateTube`: PSU cables run from `PSU_CABLE_EXIT`, and the two SATA data ends share one tube between them. A data end stays visible while its other end is plugged in.
- **`src/main.tsx`: Preact HUD.**
  - Shows the timer, the "Finish build" button and the results `<dialog>`.
  - Adds timestamps to the event log, then calls `grade()`.
  - There's deliberately no parts checklist, because it would reveal forgotten steps.

## Verifying visual or interaction changes

Unit tests only cover `grade.ts`. To check scene or model changes:
1. `npm run build && npm run preview`.
2. Drive drag-and-drop with Playwright. The headless Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; launch it with `--use-gl=swiftshader --enable-unsafe-swiftshader`.
3. Compute screen coordinates by projecting rest poses (build the part with `buildPartMesh`, then call `placeAtRest`) and `SLOT_POS` through a camera that matches the initial one: position (4.6, 6, 14), looking at (4.6, -1.4, 1.6), fov 45.
