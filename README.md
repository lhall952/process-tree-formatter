# process-tree-formatter

Process listings never look the same twice. `ps -ef` piped through a
JSON-ifying script gives you `PID`/`PPID`. The Docker Engine API gives you
`Pid`/`ParentPid` nested a few levels deep. A `/proc` scrape gives you
strings where you wanted numbers, and stray whitespace everywhere. Parent
links dangle (the ppid was reaped before you read it) or, less often, cycle
back on themselves in adversarial or corrupted input.

This library takes that mess and turns it into one canonical process tree:
integers where integers belong, trimmed strings, a fixed field name for
each concept, and children sorted by pid so the same input always produces
the same output.

## Usage

```typescript
import { normalizeProcessRecords, buildProcessTree, formatProcessTree } from 'process-tree-formatter'

const raw = [
  { PID: '1', command: '  init  ', PPID: '0' },
  { pid: 42, cmd: 'nginx: master process', ppid: 1, args: ['nginx', '-g', 'daemon off;'] },
  { pid: '43', comm: 'nginx: worker process', parentPid: '42' },
  { pid: 42, cmd: 'duplicate, ignored', ppid: 1 },
  { pid: 7, name: 'orphan', ppid: 999 },
]

const records = normalizeProcessRecords(raw)
const tree = buildProcessTree(records)

console.log(formatProcessTree(tree))
```

```
init (1)
  nginx: master process (42)
    nginx: worker process (43)
orphan (7)
```

Notes on what happened to the messy input above:

- `PID: '1'` and `PPID: '0'` were parsed from strings to integers.
- `'  init  '` had its surrounding whitespace trimmed.
- `ppid: 0` doesn't match any known pid, so process 1 became a root instead
  of erroring.
- the second record for pid `42` was dropped; first occurrence wins.
- pid `7`'s ppid (`999`) points at nothing in the input, so it surfaces as
  its own root rather than being silently discarded.

## CLI

```
node dist/cli.js [file] [options]
```

Reads a process listing from `file`, or from stdin if no file is given, and
prints the tree. The input can be a table in the shape `ps -ef` or `ps aux`
print, or a JSON array of raw process records.

```
ps -ef | node dist/cli.js
```

```
Options:
  --file <path>     read from this file instead of stdin
  --format <fmt>    "text" (default), "json", or "dot"
  --args            include command arguments in the output
  --no-pid          omit pids from the output
  --indent <str>    string used per indent level, text format only (default: two spaces)
  -h, --help        show this message
```

The table parser reads the header line to find the PID, PPID, command, and
user columns (however the source names them - `CMD` or `COMMAND`, `UID` or
`USER`) and treats the last column as the command, spaces and all, since
that's always where `ps` puts it.

`--format json` prints the full normalized tree (pid, ppid, command, args,
user, and nested children) as JSON; `--indent` doesn't apply there.

`--format dot` prints a Graphviz `digraph`, one node per pid with an edge to
each child, ready to pipe into `dot`:

```
ps -ef | node dist/cli.js --format dot | dot -Tpng -o tree.png
```

```
digraph processes {
  1 [label="init (1)"];
  1 -> 42;
  42 [label="nginx: master process (42)"];
}
```

`--args` and `--no-pid` shape the node labels the same way they shape text
output; `--indent` doesn't apply to dot either.

## Design

Every exported function is pure: given the same arguments it returns the
same result, with no reads from the filesystem, the clock, or process
state, and no mutation of its inputs. That's what makes the normalization
rules testable with plain object literals instead of a real `ps` process or
mocked OS calls.

- `normalizeProcessRecord` / `normalizeProcessRecords` clean up raw,
  loosely-typed input into `ProcessRecord`s.
- `buildProcessTree` turns a flat list of records into a forest, resolving
  dangling parent links and breaking cycles deterministically.
- `formatProcessTree` renders a forest as indented text.
- `formatProcessTreeAsDot` renders a forest as a Graphviz `digraph`.

## Status

Early skeleton. Normalization, tree construction, both renderers, and the
CLI's input parsing all have unit test coverage (`npm test`), including
dangling parents, cyclic ppid chains, and a fuzz test that feeds hundreds
of rounds of randomly malformed raw records through the whole pipeline.
Tree construction and both renderers walk iteratively, not recursively, so
a pathologically deep chain doesn't blow the call stack. The CLI supports
text, JSON, and dot output.
