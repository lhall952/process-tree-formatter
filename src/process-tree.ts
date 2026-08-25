import type {
  FormatOptions,
  ProcessRecord,
  ProcessTreeNode,
  RawProcessRecord,
} from './types.js'

// Different sources spell the same field differently (ps, /proc, docker
// inspect, hand-rolled JSON). We take the first candidate key that's present
// rather than guessing a single "correct" schema.
const PID_KEYS = ['pid', 'PID', 'processId', 'process_id']
const PPID_KEYS = ['ppid', 'PPID', 'parentPid', 'parent_pid']
const COMMAND_KEYS = ['command', 'cmd', 'comm', 'name']
const ARGS_KEYS = ['args', 'arguments', 'cmdline']
const USER_KEYS = ['user', 'USER', 'owner']

function pickFirst(raw: RawProcessRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) {
      return raw[key]
    }
  }
  return undefined
}

function coerceInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '' || !/^-?\d+$/.test(trimmed)) return null
    return Number.parseInt(trimmed, 10)
  }
  return null
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const collapsed = value.trim().replace(/\s+/g, ' ')
  return collapsed === '' ? null : collapsed
}

function coerceArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }
  if (typeof value === 'string') {
    return value.trim().split(/\s+/).filter((item) => item.length > 0)
  }
  return []
}

// Returns null for records that can't be trusted at all: no usable pid, or
// no usable command. Everything else is recoverable and gets a default.
export function normalizeProcessRecord(raw: RawProcessRecord): ProcessRecord | null {
  const pid = coerceInteger(pickFirst(raw, PID_KEYS))
  if (pid === null || pid < 0) return null

  const command = coerceString(pickFirst(raw, COMMAND_KEYS))
  if (command === null) return null

  const rawPpid = coerceInteger(pickFirst(raw, PPID_KEYS))
  const ppid = rawPpid === null || rawPpid < 0 || rawPpid === pid ? null : rawPpid

  return {
    pid,
    ppid,
    command,
    args: coerceArgs(pickFirst(raw, ARGS_KEYS)),
    user: coerceString(pickFirst(raw, USER_KEYS)),
  }
}

function compareByPid(a: ProcessRecord, b: ProcessRecord): number {
  return a.pid - b.pid
}

// Invalid records are dropped. Duplicate pids keep the first occurrence, so
// the result depends only on the input array, not on Map iteration order.
export function normalizeProcessRecords(raws: readonly RawProcessRecord[]): ProcessRecord[] {
  const byPid = new Map<number, ProcessRecord>()

  for (const raw of raws) {
    const record = normalizeProcessRecord(raw)
    if (record !== null && !byPid.has(record.pid)) {
      byPid.set(record.pid, record)
    }
  }

  return Array.from(byPid.values()).sort(compareByPid)
}

// A ppid only counts as a real parent link if it points at a pid that's
// actually in the record set and doesn't close a cycle back to itself.
// Dangling and cyclic links are both treated as "this process is a root".
function resolveEffectiveParents(records: readonly ProcessRecord[]): Map<number, number | null> {
  const pidSet = new Set(records.map((r) => r.pid))
  const declaredParent = new Map(records.map((r) => [r.pid, r.ppid]))
  const effective = new Map<number, number | null>()

  for (const record of records) {
    const ppid = declaredParent.get(record.pid) ?? null
    if (ppid === null || !pidSet.has(ppid)) {
      effective.set(record.pid, null)
      continue
    }

    const ancestors = new Set<number>([record.pid])
    let cycleDetected = false
    let cursor: number | null = ppid
    while (cursor !== null) {
      if (ancestors.has(cursor)) {
        cycleDetected = true
        break
      }
      ancestors.add(cursor)
      const next = declaredParent.get(cursor) ?? null
      cursor = next !== null && pidSet.has(next) ? next : null
    }

    effective.set(record.pid, cycleDetected ? null : ppid)
  }

  return effective
}

export function buildProcessTree(records: readonly ProcessRecord[]): ProcessTreeNode[] {
  const parentOf = resolveEffectiveParents(records)
  const childrenOf = new Map<number, ProcessRecord[]>()
  const roots: ProcessRecord[] = []

  for (const record of records) {
    const parent = parentOf.get(record.pid) ?? null
    if (parent === null) {
      roots.push(record)
      continue
    }
    const siblings = childrenOf.get(parent) ?? []
    siblings.push(record)
    childrenOf.set(parent, siblings)
  }

  const toNode = (record: ProcessRecord): ProcessTreeNode => ({
    ...record,
    children: (childrenOf.get(record.pid) ?? [])
      .slice()
      .sort(compareByPid)
      .map(toNode),
  })

  return roots.slice().sort(compareByPid).map(toNode)
}

function formatLine(
  node: ProcessTreeNode,
  depth: number,
  indent: string,
  showPid: boolean,
  showArgs: boolean,
): string {
  const prefix = indent.repeat(depth)
  const pidPart = showPid ? ` (${node.pid})` : ''
  const argsPart = showArgs && node.args.length > 0 ? ` ${node.args.join(' ')}` : ''
  return `${prefix}${node.command}${pidPart}${argsPart}`
}

export function formatProcessTree(
  nodes: readonly ProcessTreeNode[],
  options: FormatOptions = {},
): string {
  const indent = options.indent ?? '  '
  const showPid = options.showPid ?? true
  const showArgs = options.showArgs ?? false
  const lines: string[] = []

  const visit = (node: ProcessTreeNode, depth: number): void => {
    lines.push(formatLine(node, depth, indent, showPid, showArgs))
    for (const child of node.children) visit(child, depth + 1)
  }

  for (const node of nodes) visit(node, 0)

  return lines.join('\n')
}
