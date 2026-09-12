#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import process from 'node:process'
import {
  buildProcessTree,
  formatProcessTree,
  formatProcessTreeAsDot,
  normalizeProcessRecords,
} from './process-tree.js'
import type { RawProcessRecord } from './types.js'

const USAGE = `usage: process-tree [file] [options]

Reads a process listing from a file (or stdin, if no file is given) and
prints it as an indented tree. The input can be a table like "ps -ef" or
"ps aux" prints, or a JSON array of raw process records (the same shape
docker inspect or a /proc scrape would produce).

Options:
  --file <path>     read from this file instead of stdin
  --format <fmt>    "text" (default), "json", or "dot"
  --args            include command arguments in the output
  --no-pid          omit pids from the output
  --indent <str>    string used per indent level, text format only (default: two spaces)
  -h, --help        show this message

In json format the full normalized tree is printed (pid, ppid, command,
args, user, children); --indent doesn't apply there. In dot format, each
process becomes a node (keyed by pid) with an edge to each child, suitable
for piping into "dot -Tpng"; --args and --no-pid shape the node labels,
but --indent doesn't apply there either.
`

// Column names vary across ps variants ("PID" vs "pid", "CMD" vs "COMMAND",
// "UID" vs "USER"), so the table parser maps whatever header it finds onto
// the field names normalizeProcessRecord already knows how to read.
const PID_HEADERS = new Set(['pid'])
const PPID_HEADERS = new Set(['ppid'])
const COMMAND_HEADERS = new Set(['cmd', 'command'])
const USER_HEADERS = new Set(['uid', 'user'])

// Splits a line into `columnCount` fields, whitespace-delimited except for
// the last field, which keeps everything remaining (ps command lines routinely
// contain spaces, and are always the last column in both -ef and aux output).
function splitColumns(line: string, columnCount: number): string[] {
  let rest = line.trim()
  const parts: string[] = []
  for (let i = 0; i < columnCount - 1; i++) {
    const match = rest.match(/^(\S+)\s+(\S.*)$/)
    if (match === null) break
    parts.push(match[1]!)
    rest = match[2]!
  }
  parts.push(rest)
  return parts
}

function parsePsTable(text: string): RawProcessRecord[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return []

  const headers = lines[0]!.trim().split(/\s+/)
  const keys = headers.map((header) => {
    const lower = header.toLowerCase()
    if (PID_HEADERS.has(lower)) return 'pid'
    if (PPID_HEADERS.has(lower)) return 'ppid'
    if (COMMAND_HEADERS.has(lower)) return 'command'
    if (USER_HEADERS.has(lower)) return 'user'
    return lower
  })

  return lines.slice(1).map((line) => {
    const values = splitColumns(line, headers.length)
    const record: { [key: string]: string } = {}
    keys.forEach((key, i) => {
      const value = values[i]
      if (value !== undefined) record[key] = value
    })
    return record
  })
}

// A JSON array (or single object) of raw records is passed straight through
// to normalizeProcessRecords; anything else is treated as a ps-style table.
export function parseInput(text: string): RawProcessRecord[] {
  const trimmed = text.trim()
  if (trimmed === '') return []

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed)
    const records = Array.isArray(parsed) ? parsed : [parsed]
    return records.filter((r): r is RawProcessRecord => typeof r === 'object' && r !== null)
  }

  return parsePsTable(trimmed)
}

export type OutputFormat = 'text' | 'json' | 'dot'

interface CliOptions {
  readonly file: string | undefined
  readonly format: OutputFormat
  readonly showArgs: boolean
  readonly showPid: boolean
  readonly indent: string
}

function parseFormat(value: string | undefined): OutputFormat {
  if (value === 'text' || value === 'json' || value === 'dot') return value
  throw new Error(
    `--format must be "text", "json", or "dot", got ${value === undefined ? 'nothing' : JSON.stringify(value)}`,
  )
}

export function parseArgs(argv: readonly string[]): CliOptions | 'help' {
  let file: string | undefined
  let format: OutputFormat = 'text'
  let showArgs = false
  let showPid = true
  let indent = '  '

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '-h':
      case '--help':
        return 'help'
      case '--file':
        file = argv[++i]
        break
      case '--format':
        format = parseFormat(argv[++i])
        break
      case '--args':
        showArgs = true
        break
      case '--no-pid':
        showPid = false
        break
      case '--indent':
        indent = argv[++i] ?? indent
        break
      default:
        if (file === undefined && !arg.startsWith('-')) file = arg
    }
  }

  return { file, format, showArgs, showPid, indent }
}

function readInput(path: string | undefined): string {
  // fd 0 is stdin; readFileSync accepts a descriptor as well as a path.
  return readFileSync(path ?? 0, 'utf8')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options === 'help') {
    process.stdout.write(USAGE)
    return
  }

  const text = readInput(options.file)
  const records = normalizeProcessRecords(parseInput(text))
  const tree = buildProcessTree(records)

  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(tree, null, 2)}\n`)
    return
  }

  if (options.format === 'dot') {
    const dotOutput = formatProcessTreeAsDot(tree, {
      showArgs: options.showArgs,
      showPid: options.showPid,
    })
    process.stdout.write(`${dotOutput}\n`)
    return
  }

  const output = formatProcessTree(tree, {
    showArgs: options.showArgs,
    showPid: options.showPid,
    indent: options.indent,
  })

  process.stdout.write(output.length > 0 ? `${output}\n` : '')
}

// Guarded so importing this module (as the tests do, to exercise parseInput
// and parseArgs) never triggers a stdin read or process.exit as a side effect.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`process-tree: ${message}\n`)
    process.exitCode = 1
  }
}
