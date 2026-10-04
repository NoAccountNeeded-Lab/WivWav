/**
 * Shareable /helm location state (issue #1071): the visible section plus a
 * chain of related selections — problem → source → run → log. Each deeper
 * level keeps its parents so a shared URL reopens the same investigation
 * context, and `focus` says which level the inspector is showing.
 */

export const HELM_SECTIONS = ['overview', 'inventory', 'flow', 'problems', 'activity'] as const
export type HelmSection = (typeof HELM_SECTIONS)[number]

export const HELM_FOCUS_KINDS = ['problem', 'source', 'run', 'log'] as const
export type HelmFocusKind = (typeof HELM_FOCUS_KINDS)[number]

export interface HelmSelection {
  problem: string | null
  source: string | null
  /** Namespaced `scrape:<id>` (scraper run) or `job:<id>` (lineage run-tree node) so one id can't read two ways. */
  run: string | null
  /** Composite key from `logKey`: log lines have no id of their own. */
  log: string | null
  focus: HelmFocusKind | null
}

export interface HelmLocation {
  section: HelmSection
  selection: HelmSelection
}

export const EMPTY_SELECTION: HelmSelection = { problem: null, source: null, run: null, log: null, focus: null }

export type RunRef = { kind: 'scrape' | 'job'; id: string }

interface ParamReader {
  get(name: string): string | null
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Deepest level actually present in the chain; the default focus. */
function deepest(selection: Omit<HelmSelection, 'focus'>): HelmFocusKind | null {
  if (selection.log) return 'log'
  if (selection.run) return 'run'
  if (selection.source) return 'source'
  if (selection.problem) return 'problem'
  return null
}

export function normalizeSelection(selection: HelmSelection): HelmSelection {
  const focus = selection.focus && selection[selection.focus] ? selection.focus : deepest(selection)
  return { ...selection, focus }
}

export function parseHelmLocation(params: ParamReader): HelmLocation {
  const rawSection = params.get('section')
  const section = HELM_SECTIONS.find(candidate => candidate === rawSection) ?? 'overview'
  const rawFocus = params.get('focus')
  const focus = HELM_FOCUS_KINDS.find(candidate => candidate === rawFocus) ?? null
  const selection = normalizeSelection({
    problem: clean(params.get('problem')),
    source: clean(params.get('source')),
    run: parseRunRef(clean(params.get('run'))) ? clean(params.get('run')) : null,
    log: clean(params.get('log')),
    focus,
  })
  return { section, selection }
}

export function buildHelmQuery(location: HelmLocation): string {
  const params = new URLSearchParams()
  if (location.section !== 'overview') params.set('section', location.section)
  const selection = normalizeSelection(location.selection)
  for (const kind of HELM_FOCUS_KINDS) {
    const value = selection[kind]
    if (value) params.set(kind, value)
  }
  if (selection.focus && selection.focus !== deepest(selection)) params.set('focus', selection.focus)
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

export function runRef(ref: RunRef): string {
  return `${ref.kind}:${ref.id}`
}

export function parseRunRef(value: string | null): RunRef | null {
  if (!value) return null
  const match = /^(scrape|job):(.+)$/.exec(value)
  if (!match) return null
  const [, kind, id] = match
  return kind && id ? { kind: kind as RunRef['kind'], id } : null
}

export function logKey(entry: { ts: string; jobId: string | null; requestId: string | null }): string {
  return [entry.ts, entry.jobId ?? '', entry.requestId ?? ''].join('|')
}

/** Selecting a problem starts a fresh chain; the source is its derived source, if any. */
export function selectProblem(fingerprint: string, sourceId: string | null): HelmSelection {
  return normalizeSelection({ problem: fingerprint, source: sourceId, run: null, log: null, focus: 'problem' })
}

/** Selecting a source keeps the problem context only when switching within the same source. */
export function selectSource(current: HelmSelection, sourceId: string): HelmSelection {
  const sameSource = current.source === sourceId
  return normalizeSelection({
    problem: sameSource ? current.problem : null,
    source: sourceId,
    run: sameSource ? current.run : null,
    log: sameSource ? current.log : null,
    focus: 'source',
  })
}

export function selectRun(current: HelmSelection, ref: string): HelmSelection {
  return normalizeSelection({ ...current, run: ref, log: null, focus: 'run' })
}

export function selectLog(current: HelmSelection, key: string): HelmSelection {
  return normalizeSelection({ ...current, log: key, focus: 'log' })
}

/** Breadcrumb navigation: focus an ancestor and drop everything deeper than it. */
export function focusAncestor(current: HelmSelection, kind: HelmFocusKind): HelmSelection {
  const order = HELM_FOCUS_KINDS
  const keep = order.indexOf(kind)
  const next: HelmSelection = { ...current, focus: kind }
  order.forEach((level, index) => {
    if (index > keep) next[level] = null
  })
  return normalizeSelection(next)
}

export function clearSelection(): HelmSelection {
  return EMPTY_SELECTION
}

export function hasSelection(selection: HelmSelection): boolean {
  return selection.focus !== null
}
