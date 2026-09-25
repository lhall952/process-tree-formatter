import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProcessTree,
  formatProcessTree,
  formatProcessTreeAsDot,
  normalizeProcessRecords,
} from '../src/process-tree.js'
import type { ProcessTreeNode, RawProcessRecord } from '../src/types.js'

// Deterministic PRNG so a failing trial is reproducible from the seed
// alone - no need to capture and paste whatever garbage it generated.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Values that a real ps/proc/docker scrape has no business producing but
// that a corrupted or adversarial one might: wrong types, out-of-range
// numbers, and structures normalizeProcessRecord's key-lookups have to
// shrug off rather than throw on.
const WILD_VALUES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '',
  '   ',
  '007',
  '-3',
  '3.5',
  'not a number',
  [],
  [1, 2, 3],
  ['a', 'b'],
  {},
  { nested: true },
  Symbol('x'),
  () => {},
  new Date(),
]

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!
}

const PID_KEYS = ['pid', 'PID', 'processId', 'process_id']
const PPID_KEYS = ['ppid', 'PPID', 'parentPid', 'parent_pid']
const COMMAND_KEYS = ['command', 'cmd', 'comm', 'name']
const ARGS_KEYS = ['args', 'arguments', 'cmdline']
const USER_KEYS = ['user', 'USER', 'owner']

// Most fields are drawn straight from WILD_VALUES, so most records are
// unusable. pid/ppid/command are nudged towards plausible-looking values
// often enough that a nontrivial tree, with real parent links, gets built
// alongside the garbage.
function randomRawRecord(rng: () => number, pidPool: number): RawProcessRecord {
  const record: { [key: string]: unknown } = {}

  const plausiblePid = () =>
    rng() < 0.5 ? Math.floor(rng() * pidPool) : String(Math.floor(rng() * pidPool))

  record[pick(rng, PID_KEYS)] = rng() < 0.7 ? plausiblePid() : pick(rng, WILD_VALUES)
  record[pick(rng, PPID_KEYS)] = rng() < 0.6 ? plausiblePid() : pick(rng, WILD_VALUES)
  record[pick(rng, COMMAND_KEYS)] =
    rng() < 0.7 ? `proc-${Math.floor(rng() * 1000)}` : pick(rng, WILD_VALUES)
  record[pick(rng, ARGS_KEYS)] = pick(rng, WILD_VALUES)
  record[pick(rng, USER_KEYS)] = pick(rng, WILD_VALUES)

  // A column none of the known keys map onto, the way a real scrape might
  // carry fields the normalizer was never meant to look at.
  if (rng() < 0.3) record[`extra${Math.floor(rng() * 5)}`] = pick(rng, WILD_VALUES)

  return record
}

function flatten(nodes: readonly ProcessTreeNode[]): ProcessTreeNode[] {
  const out: ProcessTreeNode[] = []
  const stack = nodes.slice()
  while (stack.length > 0) {
    const node = stack.pop()!
    out.push(node)
    stack.push(...node.children)
  }
  return out
}

test('the full pipeline survives many rounds of malformed raw records without throwing', () => {
  const rng = mulberry32(0xc0ffee)

  for (let trial = 0; trial < 200; trial++) {
    const recordCount = 1 + Math.floor(rng() * 30)
    const pidPool = 1 + Math.floor(rng() * 20)
    const raws: RawProcessRecord[] = []
    for (let i = 0; i < recordCount; i++) raws.push(randomRawRecord(rng, pidPool))

    const records = normalizeProcessRecords(raws)
    const tree = buildProcessTree(records)
    const flat = flatten(tree)

    assert.equal(
      flat.length,
      records.length,
      `trial ${trial}: tree should hold every normalized record exactly once`,
    )

    const treePids = flat.map((n) => n.pid).sort((a, b) => a - b)
    const recordPids = records.map((r) => r.pid).sort((a, b) => a - b)
    assert.deepEqual(
      treePids,
      recordPids,
      `trial ${trial}: tree pids should match normalized record pids exactly`,
    )

    const text = formatProcessTree(tree)
    assert.equal(
      text === '' ? 0 : text.split('\n').length,
      flat.length,
      `trial ${trial}: text renderer should emit exactly one line per node`,
    )

    const dot = formatProcessTreeAsDot(tree)
    assert.ok(dot.startsWith('digraph processes {\n'), `trial ${trial}: dot output should open a digraph`)
    assert.ok(dot.endsWith('}'), `trial ${trial}: dot output should close the digraph`)

    assert.doesNotThrow(
      () => JSON.stringify(tree),
      `trial ${trial}: the normalized tree should always be JSON-serializable`,
    )
  }
})
