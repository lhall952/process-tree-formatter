import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, parseInput } from '../src/cli.js'
import {
  buildProcessTree,
  formatProcessTree,
  formatProcessTreeAsDot,
  normalizeProcessRecords,
} from '../src/process-tree.js'

test('parseInput reads a JSON array of raw records as-is', () => {
  const records = parseInput('[{"pid": 1, "command": "init"}, {"pid": 2, "ppid": 1, "command": "sshd"}]')
  assert.deepEqual(records, [
    { pid: 1, command: 'init' },
    { pid: 2, ppid: 1, command: 'sshd' },
  ])
})

test('parseInput wraps a single JSON object in an array', () => {
  const records = parseInput('{"pid": 1, "command": "init"}')
  assert.deepEqual(records, [{ pid: 1, command: 'init' }])
})

test('parseInput drops non-object entries from a JSON array', () => {
  const records = parseInput('[{"pid": 1, "command": "init"}, "garbage", 5, null]')
  assert.deepEqual(records, [{ pid: 1, command: 'init' }])
})

test('parseInput returns an empty array for blank input', () => {
  assert.deepEqual(parseInput('   \n  '), [])
})

test('parseInput parses a ps -ef style table, keeping CMD as one field with spaces', () => {
  const text = [
    'UID          PID    PPID  C STIME TTY          TIME CMD',
    'root           1       0  0 Sep06 ?        00:00:03 /sbin/init splash',
    'root          42       1  0 Sep06 ?        00:00:01 nginx: master process',
  ].join('\n')

  const records = parseInput(text)
  assert.deepEqual(records, [
    { uid: 'root', pid: '1', ppid: '0', c: '0', stime: 'Sep06', tty: '?', time: '00:00:03', command: '/sbin/init splash' },
    { uid: 'root', pid: '42', ppid: '1', c: '0', stime: 'Sep06', tty: '?', time: '00:00:01', command: 'nginx: master process' },
  ])
})

test('parseInput parses a ps aux style table and maps USER to user', () => {
  const text = [
    'USER   PID  %CPU %MEM COMMAND',
    'root     1   0.0  0.1 init',
  ].join('\n')

  const records = parseInput(text)
  assert.deepEqual(records, [{ user: 'root', pid: '1', '%cpu': '0.0', '%mem': '0.1', command: 'init' }])
})

test('a parsed ps table feeds normalizeProcessRecords and buildProcessTree end to end', () => {
  const text = [
    'UID   PID  PPID CMD',
    'root    1     0 init',
    'root   42     1 nginx: master process',
  ].join('\n')

  const tree = buildProcessTree(normalizeProcessRecords(parseInput(text)))
  assert.equal(formatProcessTree(tree), 'init (1)\n  nginx: master process (42)')
})

test('parseArgs recognizes -h/--help', () => {
  assert.equal(parseArgs(['-h']), 'help')
  assert.equal(parseArgs(['--help']), 'help')
})

test('parseArgs treats a bare positional argument as the file path', () => {
  const options = parseArgs(['processes.json'])
  assert.equal(options === 'help' ? undefined : options.file, 'processes.json')
})

test('parseArgs reads --file, --args, --no-pid, and --indent', () => {
  const options = parseArgs(['--file', 'a.txt', '--args', '--no-pid', '--indent', '> '])
  assert.deepEqual(options, { file: 'a.txt', format: 'text', showArgs: true, showPid: false, indent: '> ' })
})

test('parseArgs defaults to stdin, text format, no args, pids shown, two-space indent', () => {
  const options = parseArgs([])
  assert.deepEqual(options, { file: undefined, format: 'text', showArgs: false, showPid: true, indent: '  ' })
})

test('parseArgs reads --format json', () => {
  const options = parseArgs(['--format', 'json'])
  assert.equal(options === 'help' ? undefined : options.format, 'json')
})

test('parseArgs rejects an unrecognized --format value', () => {
  assert.throws(() => parseArgs(['--format', 'xml']), /--format must be "text", "json", or "dot"/)
})

test('parseArgs reads --format dot', () => {
  const options = parseArgs(['--format', 'dot'])
  assert.equal(options === 'help' ? undefined : options.format, 'dot')
})

test('a parsed ps table feeds through to dot output with one node and edge per link', () => {
  const text = [
    'UID   PID  PPID CMD',
    'root    1     0 init',
    'root   42     1 nginx: master process',
  ].join('\n')

  const tree = buildProcessTree(normalizeProcessRecords(parseInput(text)))
  assert.equal(
    formatProcessTreeAsDot(tree),
    [
      'digraph processes {',
      '  1 [label="init (1)"];',
      '  1 -> 42;',
      '  42 [label="nginx: master process (42)"];',
      '}',
    ].join('\n'),
  )
})

test('a parsed ps table feeds through to json output with the full canonical tree', () => {
  const text = [
    'UID   PID  PPID CMD',
    'root    1     0 init',
    'root   42     1 nginx: master process',
  ].join('\n')

  const tree = buildProcessTree(normalizeProcessRecords(parseInput(text)))
  assert.deepEqual(JSON.parse(JSON.stringify(tree)), [
    {
      pid: 1,
      ppid: null,
      command: 'init',
      args: [],
      user: 'root',
      children: [
        {
          pid: 42,
          ppid: 1,
          command: 'nginx: master process',
          args: [],
          user: 'root',
          children: [],
        },
      ],
    },
  ])
})
