# PC Builder

A 3D PC assembly simulator for students. Drag the core components from the pegboard into the case, press **Finish build**, and get a grade with an explanation of every deduction.

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
| Placement | RAM not in A2 + B2 −5, GPU not in the top x16 slot −5, SATA data in SATA2 while an M.2 SSD is installed −5 (shared lanes) |
| Order | RAM after the cooler −5, M.2 after the GPU −5 |
| Time | −1 per minute over 8 minutes, capped at −10 |

Cables aren't on the pegboard. Clicking the installed PSU shows its cables, clicking the installed SSD shows the SATA data cable, and clicking anything else hides the loose ones again.

Students can't go back and fix a skipped step. The standoff holes are covered once the motherboard is in, and the top of the CPU is covered once the cooler is on.

## Roadmap

- Phase 2: LTI 1.3 grade passback through a small serverless function. `grade()` is pure and the build is recorded as a serializable event log, so the server can re-grade a submission.
