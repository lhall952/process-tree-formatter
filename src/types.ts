// Input is deliberately loose: it might come from `ps -ef` piped through a
// JSON-ifying script, a Docker Engine API response, a /proc scrape, or a
// hand-written fixture. Field names, casing, and value types are all fair game.
export interface RawProcessRecord {
  readonly [key: string]: unknown
}

// Canonical shape every raw record is normalized into. Immutable and total:
// every field is always present, even when the source data left it out.
export interface ProcessRecord {
  readonly pid: number
  readonly ppid: number | null
  readonly command: string
  readonly args: readonly string[]
  readonly user: string | null
}

export interface ProcessTreeNode extends ProcessRecord {
  readonly children: readonly ProcessTreeNode[]
}

export interface FormatOptions {
  readonly indent?: string
  readonly showPid?: boolean
  readonly showArgs?: boolean
}
