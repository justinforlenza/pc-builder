import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createScene } from './scene.ts'
import { grade, PARTS, SLOTS, type GradeResult, type PlaceEvent } from './grade.ts'
import { reportScore } from './scorm.ts'
import './style.css'

const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const start = useRef(performance.now())
  const [log, setLog] = useState<PlaceEvent[]>([])
  const [now, setNow] = useState(start.current)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const s = createScene(canvas.current!, {
      onChange(part, slot) {
        setLog(l => [...l, { part, slot, t: Math.round(performance.now() - start.current) }])
        setNote(slot ? `Installed ${PARTS[part].name} → ${SLOTS[slot].name}` : `Removed ${PARTS[part].name}`)
      },
      onBlocked(part, blockers) {
        const names = [...new Set(blockers.map(b => PARTS[b].name))].join(', ')
        setNote(`Can't remove the ${PARTS[part].name} yet: take off the ${names} first.`)
      },
    })
    return s.dispose
  }, [])

  useEffect(() => {
    if (result) return
    const id = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(id)
  }, [result])

  const finish = () => {
    if (!confirm('Finish and grade your build? You cannot change it afterwards.')) return
    const r = grade(log, performance.now() - start.current)
    setResult(r)
    reportScore(r.score)
    dialog.current!.showModal()
  }

  return (
    <>
      <canvas ref={canvas} />
      <header>
        <h1>PC Builder</h1>
        <span class="timer" aria-label="Elapsed time">{fmt(now - start.current)}</span>
        {import.meta.env.VITE_SCORM_URL && <a class="button" href={import.meta.env.VITE_SCORM_URL} download>SCORM package</a>}
        <button onClick={finish} disabled={!!result}>Finish build</button>
      </header>
      <p class="hint">
        {note ?? 'Drag parts from the anti-static mat into the case; drag an installed part out to remove it. Click the installed PSU or SSD to get its cables. Drag empty space to rotate, right-drag to pan, scroll to zoom.'}
      </p>
      <dialog ref={dialog} onCancel={e => e.preventDefault()}>
        {result && (
          <>
            <h2>Your score: {result.score} / 100</h2>
            {result.deductions.length === 0
              ? <p>Perfect build, nice work!</p>
              : <ul>{result.deductions.map(d => (
                  <li><strong>−{d.points} {d.category}:</strong> {d.message}</li>
                ))}</ul>}
            <button onClick={() => location.reload()}>Try again</button>
          </>
        )}
      </dialog>
    </>
  )
}

render(<App />, document.getElementById('app')!)
