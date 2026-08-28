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

## Status

Early skeleton. Normalization, tree construction, and text rendering work.
`normalizeProcessRecord`/`normalizeProcessRecords` have a unit test suite
(`npm test`); tree construction and the CLI still don't.
