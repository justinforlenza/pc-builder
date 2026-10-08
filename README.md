# PC Builder

A 3D PC assembly simulator for students. Drag the core components from the anti-static mat on the desk into the case, press **Finish build**, and get a grade with an explanation of every deduction.

A welcome screen explains the controls and grading, and the timer starts when the student presses Start. Two helpers are off by default and can be turned on from the welcome screen or the top bar: **Part names** (floating labels on the parts, plus the port names printed on the motherboard) and **Placement guides** (blue dots on the slots a dragged part fits).

It's a static site with no server and no database.

## Run

```sh
npm install
npm run dev      # local dev server
npm test         # grading rule tests
npm run build    # static site in dist/
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. The first time, set **Settings → Pages → Source** to **GitHub Actions**.

You can also host `dist/` anywhere static, such as GitHub Pages, Netlify or a school web server. It also works under a subpath or embedded in an LMS page with an `<iframe>`.

## Grading

All of the rules are in [`src/grade.ts`](src/grade.ts) and can be edited. Each build starts at 100.

| Category | Default deductions |
|---|---|
| Forgotten | standoffs −15, thermal paste −15, any other part −15, each unplugged cable connection −10 (24-pin, EPS, PCIe power, SATA power, SATA data at the motherboard, SATA data at the SSD) |
| Placement | RAM not in A2 + B2 −5, GPU not in the top x16 slot −5 |
| Order | RAM after the cooler −5 |
| Time | −1 per minute over 8 minutes, capped at −10 |

The PSU's cables aren't on the mat. Clicking the installed PSU shows them, and clicking anything else hides the loose ones again. The CPU (EPS 4+4) and GPU (PCIe 6+2) plugs are shaped differently and stamped "CPU" and "PCIe", like real modular cables. The SATA data cable lies on the mat. Dragging the cable (or either end) brings the whole cable along; once that end is plugged into the SSD or a motherboard SATA port, the free end waits beside it to be plugged into the other.

Students can drag an installed part back out, to remove it or move it to another slot. Anything attached to it or covering it has to come off first: for example, the cooler before the CPU, or the cables before the PSU. A skipped step therefore means taking parts back out. The standoff holes are covered once the motherboard is in, and the CPU socket (and its paste) once the cooler is on, even if the cooler went on before the CPU by mistake.

The grade is based on the finished build, so a mistake that gets fixed only costs time.

## Roadmap

- Phase 2: LTI 1.3 grade passback through a small serverless function. `grade()` is pure and the build is recorded as a serializable event log, so the server can re-grade a submission.
