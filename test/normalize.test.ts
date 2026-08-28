import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProcessRecord, normalizeProcessRecords } from '../src/process-tree.js'

test('picks the first matching key among known aliases', () => {
  const record = normalizeProcessRecord({ PID: '7', PPID: '1', comm: 'sshd' })
  assert.deepEqual(record, { pid: 7, ppid: 1, command: 'sshd', args: [], user: null })
})

test('coerces numeric-looking strings to integers', () => {
  const record = normalizeProcessRecord({ pid: '007', command: 'init' })
  assert.equal(record?.pid, 7)
})

test('rejects a pid that is not an integer', () => {
  assert.equal(normalizeProcessRecord({ pid: 1.5, command: 'init' }), null)
  assert.equal(normalizeProcessRecord({ pid: 'abc', command: 'init' }), null)
  assert.equal(normalizeProcessRecord({ pid: '1.5', command: 'init' }), null)
})

test('rejects a negative pid', () => {
  assert.equal(normalizeProcessRecord({ pid: -1, command: 'init' }), null)
})

test('rejects a record with no usable command', () => {
  assert.equal(normalizeProcessRecord({ pid: 1 }), null)
  assert.equal(normalizeProcessRecord({ pid: 1, command: '   ' }), null)
  assert.equal(normalizeProcessRecord({ pid: 1, command: 42 }), null)
})

test('collapses internal whitespace and trims the command', () => {
  const record = normalizeProcessRecord({ pid: 1, command: '  nginx:   master  ' })
  assert.equal(record?.command, 'nginx: master')
})

test('treats a ppid equal to its own pid as a broken link, not a parent', () => {
  const record = normalizeProcessRecord({ pid: 5, ppid: 5, command: 'self-parented' })
  assert.equal(record?.ppid, null)
})

test('treats a negative ppid as no parent', () => {
  const record = normalizeProcessRecord({ pid: 5, ppid: -1, command: 'weird' })
  assert.equal(record?.ppid, null)
})

test('defaults ppid to null when absent', () => {
  const record = normalizeProcessRecord({ pid: 1, command: 'init' })
  assert.equal(record?.ppid, null)
})

test('reads args from an array, dropping non-strings and blanks', () => {
  const record = normalizeProcessRecord({
    pid: 1,
    command: 'nginx',
    args: ['nginx', 42, '  -g  ', '', 'daemon off;'],
  })
  assert.deepEqual(record?.args, ['nginx', '-g', 'daemon off;'])
})

test('splits a string cmdline into args on whitespace', () => {
  const record = normalizeProcessRecord({ pid: 1, command: 'nginx', cmdline: 'nginx  -g "daemon off;"' })
  assert.deepEqual(record?.args, ['nginx', '-g', '"daemon', 'off;"'])
})

test('defaults args to an empty array when absent or the wrong type', () => {
  assert.deepEqual(normalizeProcessRecord({ pid: 1, command: 'init' })?.args, [])
  assert.deepEqual(normalizeProcessRecord({ pid: 1, command: 'init', args: 5 })?.args, [])
})

test('treats a blank or missing user as null', () => {
  assert.equal(normalizeProcessRecord({ pid: 1, command: 'init' })?.user, null)
  assert.equal(normalizeProcessRecord({ pid: 1, command: 'init', user: '   ' })?.user, null)
  assert.equal(normalizeProcessRecord({ pid: 1, command: 'init', USER: 'root' })?.user, 'root')
})

test('normalizeProcessRecords drops invalid records and sorts survivors by pid', () => {
  const records = normalizeProcessRecords([
    { pid: 3, command: 'c' },
    { pid: 1, command: 'a' },
    { command: 'no pid' },
    { pid: 2, command: 'b' },
  ])
  assert.deepEqual(records.map((r) => r.pid), [1, 2, 3])
})

test('normalizeProcessRecords keeps the first occurrence of a duplicate pid', () => {
  const records = normalizeProcessRecords([
    { pid: 1, command: 'first' },
    { pid: 1, command: 'second' },
  ])
  assert.equal(records.length, 1)
  assert.equal(records[0]?.command, 'first')
})
