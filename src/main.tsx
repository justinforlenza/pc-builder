import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createScene, type SceneOptions } from './scene.ts'
import { grade, PARTS, RULES, SLOTS, type GradeResult, type PlaceEvent } from './grade.ts'
import './style.css'

const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

function Options({ value, onChange }: { value: SceneOptions; onChange: (v: SceneOptions) => void }) {
  return (
    <span class="options">
      <label><input type="checkbox" checked={value.labels} onChange={e => onChange({ ...value, labels: e.currentTarget.checked })} /> Part names</label>
      <label><input type="checkbox" checked={value.guides} onChange={e => onChange({ ...value, guides: e.currentTarget.checked })} /> Placement guides</label>
    </span>
  )
}

function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const welcome = useRef<HTMLDialogElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const scene = useRef<ReturnType<typeof createScene>>(null)
  const start = useRef<number | null>(null) // set when the student presses Start
  const [log, setLog] = useState<PlaceEvent[]>([])
  const [now, setNow] = useState(0)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [options, setOptions] = useState<SceneOptions>({ labels: false, guides: false })
  const elapsed = () => (start.current === null ? 0 : performance.now() - start.current)

  useEffect(() => {
    const s = createScene(canvas.current!, {
      onChange(part, slot) {
        setLog(l => [...l, { part, slot, t: Math.round(elapsed()) }])
        setNote(slot ? `Installed ${PARTS[part].name} → ${SLOTS[slot].name}` : `Removed ${PARTS[part].name}`)
      },
      onBlocked(part, blockers) {
        const names = [...new Set(blockers.map(b => PARTS[b].name))].join(', ')
        setNote(`Can't remove the ${PARTS[part].name} yet: take off the ${names} first.`)
      },
    })
    scene.current = s
    welcome.current!.showModal()
    return s.dispose
  }, [])

  useEffect(() => scene.current?.setOptions(options), [options])

  useEffect(() => {
    if (result) return
    const id = setInterval(() => setNow(elapsed()), 1000)
    return () => clearInterval(id)
  }, [result])

  const begin = () => {
    if (start.current === null) start.current = performance.now() // reopening the help doesn't reset the clock
  }

  const finish = () => {
    if (!confirm('Finish and grade your build? You cannot change it afterwards.')) return
    setResult(grade(log, elapsed()))
    dialog.current!.showModal()
  }

  return (
    <>
      <canvas ref={canvas} />
      <header>
        <h1>PC Builder</h1>
        <Options value={options} onChange={setOptions} />
        <span class="timer" aria-label="Elapsed time">{fmt(now)}</span>
        <button class="secondary" onClick={() => welcome.current!.showModal()}>Help</button>
        <button onClick={finish} disabled={!!result}>Finish build</button>
      </header>
      <p class="hint">
        {note ?? 'Drag parts from the anti-static mat into the case. Press Help for instructions.'}
      </p>
      <dialog ref={welcome} class="welcome" onClose={begin}>
        <h2>Welcome to PC Builder</h2>
        <p>Assemble a working PC from the parts on the anti-static mat. When you think it's done, press <strong>Finish build</strong> to get your grade.</p>
        <h3>How to build</h3>
        <ul>
          <li><strong>Install:</strong> drag a part from the mat and drop it where it belongs in the case.</li>
          <li><strong>Remove or move:</strong> drag an installed part out of the case, or onto another slot. Anything attached to it has to come off first.</li>
          <li><strong>Power cables:</strong> click the installed power supply to bring out its cables, then drag each one to its connector.</li>
          <li><strong>SATA data cable:</strong> it's on the mat. Drag the cable to the SSD or the motherboard and plug it in, then plug the free end into the other.</li>
          <li><strong>Look around:</strong> drag empty space to rotate, right-drag to pan, scroll to zoom.</li>
        </ul>
        <h3>How you're graded</h3>
        <p>You start at 100. Points come off for:</p>
        <ul>
          <li>parts or cable connections you forget</li>
          <li>parts in the wrong slot</li>
          <li>parts installed in the wrong order</li>
          <li>going over {RULES.timeLimitMin} minutes</li>
        </ul>
        <p>Only the finished build counts, so you can fix mistakes as you go. The timer starts when you press Start.</p>
        <h3>Options</h3>
        <p>Turn on helpers here or in the top bar at any time:</p>
        <Options value={options} onChange={setOptions} />
        <form method="dialog"><button>{start.current === null ? 'Start building' : 'Back to building'}</button></form>
      </dialog>
      <dialog ref={dialog} onCancel={e => e.preventDefault()}>
        {result && (
          <>
            <h2>Your grade: {result.letter}</h2>
            <p class="score">{result.score} / 100</p>
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
