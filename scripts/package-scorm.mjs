// Zips dist/ once per preset in scorm-presets.json. A preset is just URL params on the
// manifest's launch href, which main.tsx reads as the starting options.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const presets = JSON.parse(readFileSync('scorm-presets.json', 'utf8'))
const manifest = readFileSync('public/imsmanifest.xml', 'utf8')
for (const p of presets) {
  writeFileSync('dist/imsmanifest.xml', manifest
    .replace('scormtype="sco" href="index.html"', `scormtype="sco" href="index.html?${p.query.replaceAll('&', '&amp;')}"`)
    .replaceAll('<title>PC Builder</title>', `<title>PC Builder (${p.title})</title>`))
  execFileSync('zip', ['-qr', `../pc-builder-scorm-${p.id}.zip`, '.'], { cwd: 'dist' })
}
writeFileSync('dist/imsmanifest.xml', manifest)
