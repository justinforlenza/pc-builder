// SCORM 1.2 runtime hook. The LMS puts `API` on a parent frame (or the opener popup);
// with no LMS (GitHub Pages) every call is a no-op.
type Api = Record<'LMSInitialize' | 'LMSCommit' | 'LMSFinish', (s: '') => string> & {
  LMSSetValue(key: string, value: string): string
}

function findAPI(): Api | null {
  for (let w: Window | null = window, i = 0; w && i < 10; w = w.parent === w ? null : w.parent, i++) {
    try { if ((w as any).API) return (w as any).API } catch { return null } // cross-origin frame
  }
  try { return (window.opener as any)?.API ?? null } catch { return null }
}

const api = findAPI()
const live = api?.LMSInitialize('') === 'true'
if (live) addEventListener('pagehide', () => api!.LMSFinish(''), { once: true })

export function reportScore(score: number) {
  if (!live) return
  api!.LMSSetValue('cmi.core.score.min', '0')
  api!.LMSSetValue('cmi.core.score.max', '100')
  api!.LMSSetValue('cmi.core.score.raw', String(score))
  api!.LMSSetValue('cmi.core.lesson_status', 'completed')
  api!.LMSCommit('')
}
