'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useHelm } from '../helm-context'
import { useSourceEvidence, type SourceEvidence } from '../use-source-evidence'

interface SourceScope {
  sourceId: string
  evidence: SourceEvidence
}

const SourceEvidenceContext = createContext<SourceScope | null>(null)

function Scope({ sourceId, children }: { sourceId: string; children: ReactNode }) {
  const { apiBaseUrl } = useHelm()
  const evidence = useSourceEvidence(apiBaseUrl, sourceId)
  return <SourceEvidenceContext.Provider value={{ sourceId, evidence }}>{children}</SourceEvidenceContext.Provider>
}

/**
 * Loads the same-workspace evidence for the selected source (pipeline, run
 * tree, logs) once for whichever view is showing. Remounted per source so a
 * different source never briefly shows the previous source's data.
 */
export function SourceEvidenceScope({ sourceId, children }: { sourceId: string | null; children: ReactNode }) {
  if (sourceId === null) {
    return <SourceEvidenceContext.Provider value={null}>{children}</SourceEvidenceContext.Provider>
  }
  return <Scope key={sourceId} sourceId={sourceId}>{children}</Scope>
}

export function useSourceScope(): SourceScope | null {
  return useContext(SourceEvidenceContext)
}
