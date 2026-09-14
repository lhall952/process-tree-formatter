import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProcessTree,
  formatProcessTree,
  formatProcessTreeAsDot,
  normalizeProcessRecords,
} from '../src/process-tree.js'
import type { ProcessRecord } from '../src/types.js'

function record(pid: number, ppid: number | null, command: string): ProcessRecord {
  return { pid, ppid, command, args: [], user: null }
}

function pids(nodes: ReturnType<typeof buildProcessTree>): number[] {
  return nodes.map((n) => n.pid)
}

test('builds a simple parent/child forest', () => {
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 1, 'agetty'),
    record(3, 1, 'sshd'),
    record(4, 3, 'bash'),
  ])

  assert.deepEqual(pids(tree), [1])
  const init = tree[0]!
  assert.deepEqual(pids(init.children), [2, 3])
  const sshd = init.children[1]!
  assert.deepEqual(pids(sshd.children), [4])
})

test('a dangling ppid that points at nothing in the record set becomes a root', () => {
  const tree = buildProcessTree([record(7, 999, 'orphan')])
  assert.deepEqual(pids(tree), [7])
  assert.deepEqual(tree[0]!.children, [])
})

test('a process that claims itself as parent becomes a root, not a self-loop', () => {
  // normalizeProcessRecord already blocks this, but buildProcessTree takes
  // ProcessRecord directly and must not assume its input went through that.
  const tree = buildProcessTree([record(5, 5, 'self-parented')])
  assert.deepEqual(pids(tree), [5])
})

test('a two-node cycle with no real root surfaces both nodes as roots', () => {
  const tree = buildProcessTree([record(1, 2, 'a'), record(2, 1, 'b')])
  assert.deepEqual(pids(tree), [1, 2])
  assert.deepEqual(tree[0]!.children, [])
  assert.deepEqual(tree[1]!.children, [])
})

test('a cycle hanging off a legitimate root is cut at the cycle, not above it', () => {
  // 1 is a real root. 2 and 3 point at each other, forming a cycle that
  // never reaches 1, even though 2 also happens to be a child of 1.
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 3, 'a'),
    record(3, 2, 'b'),
  ])
  assert.deepEqual(pids(tree), [1, 2, 3])
})

test('a cycle elsewhere in the input does not disturb an unrelated root and its children', () => {
  // 1 -> 2 is a normal chain. 3 and 4 cycle back on each other and share
  // no records with 1's chain at all.
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 1, 'a'),
    record(3, 4, 'b'),
    record(4, 3, 'c'),
  ])

  assert.deepEqual(pids(tree), [1, 3, 4])
  assert.deepEqual(pids(tree[0]!.children), [2])
  assert.deepEqual(tree[1]!.children, [])
  assert.deepEqual(tree[2]!.children, [])
})

test('roots and siblings are always sorted by pid regardless of input order', () => {
  const tree = buildProcessTree([
    record(30, null, 'c'),
    record(10, null, 'a'),
    record(20, null, 'b'),
  ])
  assert.deepEqual(pids(tree), [10, 20, 30])
})

test('an empty record list produces an empty forest', () => {
  assert.deepEqual(buildProcessTree([]), [])
})

test('buildProcessTree composes with normalizeProcessRecords end to end', () => {
  const tree = buildProcessTree(
    normalizeProcessRecords([
      { PID: '1', PPID: '0', command: 'init' },
      { pid: 42, cmd: 'nginx: master', ppid: 1 },
      { pid: '43', comm: 'nginx: worker', parentPid: '42' },
      { pid: 7, name: 'orphan', ppid: 999 },
    ]),
  )

  assert.deepEqual(pids(tree), [1, 7])
  assert.deepEqual(pids(tree[0]!.children), [42])
  assert.deepEqual(pids(tree[0]!.children[0]!.children), [43])
})

test('formatProcessTree renders nested indentation with pids by default', () => {
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 1, 'sshd'),
    record(3, 2, 'bash'),
  ])

  assert.equal(
    formatProcessTree(tree),
    ['init (1)', '  sshd (2)', '    bash (3)'].join('\n'),
  )
})

test('formatProcessTree can hide pids and show args', () => {
  const tree = buildProcessTree([
    { pid: 1, ppid: null, command: 'nginx', args: ['-g', 'daemon off;'], user: null },
  ])

  assert.equal(
    formatProcessTree(tree, { showPid: false, showArgs: true }),
    'nginx -g daemon off;',
  )
})

test('formatProcessTree honors a custom indent string', () => {
  const tree = buildProcessTree([record(1, null, 'a'), record(2, 1, 'b')])
  assert.equal(formatProcessTree(tree, { indent: '> ' }), 'a (1)\n> b (2)')
})

test('formatProcessTree of an empty forest is an empty string', () => {
  assert.equal(formatProcessTree([]), '')
})

test('formatProcessTreeAsDot renders one node per pid and one edge per parent/child link', () => {
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 1, 'sshd'),
    record(3, 2, 'bash'),
  ])

  assert.equal(
    formatProcessTreeAsDot(tree),
    [
      'digraph processes {',
      '  1 [label="init (1)"];',
      '  1 -> 2;',
      '  2 [label="sshd (2)"];',
      '  2 -> 3;',
      '  3 [label="bash (3)"];',
      '}',
    ].join('\n'),
  )
})

test('formatProcessTreeAsDot can hide pids and show args, like the text renderer', () => {
  const tree = buildProcessTree([
    { pid: 1, ppid: null, command: 'nginx', args: ['-g', 'daemon off;'], user: null },
  ])

  assert.equal(
    formatProcessTreeAsDot(tree, { showPid: false, showArgs: true }),
    ['digraph processes {', '  1 [label="nginx -g daemon off;"];', '}'].join('\n'),
  )
})

test('formatProcessTreeAsDot escapes double quotes in a label', () => {
  const tree = buildProcessTree([record(1, null, 'echo "hi"')])
  assert.equal(
    formatProcessTreeAsDot(tree),
    ['digraph processes {', '  1 [label="echo \\"hi\\" (1)"];', '}'].join('\n'),
  )
})

test('formatProcessTreeAsDot escapes backslashes in a label', () => {
  const tree = buildProcessTree([record(1, null, 'C:\\app.exe')])
  assert.equal(
    formatProcessTreeAsDot(tree),
    ['digraph processes {', '  1 [label="C:\\\\app.exe (1)"];', '}'].join('\n'),
  )
})

test('formatProcessTreeAsDot of an empty forest is a valid, empty digraph', () => {
  assert.equal(formatProcessTreeAsDot([]), 'digraph processes {\n}')
})

test('a chain deep enough to blow a naive recursive call stack still builds and renders', () => {
  const depth = 200_000
  const records: ProcessRecord[] = [record(0, null, 'init')]
  for (let pid = 1; pid < depth; pid++) {
    records.push(record(pid, pid - 1, `p${pid}`))
  }

  const tree = buildProcessTree(records)
  assert.equal(pids(tree)[0], 0)

  let deepest = tree[0]!
  let count = 1
  while (deepest.children.length > 0) {
    deepest = deepest.children[0]!
    count++
  }
  assert.equal(count, depth)
  assert.equal(deepest.pid, depth - 1)

  const text = formatProcessTree(tree)
  assert.equal(text.split('\n').length, depth)

  const dot = formatProcessTreeAsDot(tree)
  assert.equal(dot.split('\n').length, depth + 2)
})

test('formatProcessTreeAsDot handles multiple roots and disconnected trees', () => {
  const tree = buildProcessTree([
    record(1, null, 'init'),
    record(2, 1, 'a'),
    record(9, null, 'other-root'),
  ])

  assert.equal(
    formatProcessTreeAsDot(tree),
    [
      'digraph processes {',
      '  1 [label="init (1)"];',
      '  1 -> 2;',
      '  2 [label="a (2)"];',
      '  9 [label="other-root (9)"];',
      '}',
    ].join('\n'),
  )
})
