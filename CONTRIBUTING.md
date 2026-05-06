# Contributing to cf-analytics

This Worker is the consumer half of a privacy contract spanning two repos.
The rules below are doing real work — they exist so that

1. Self-hosted SourceBans++ panels that haven't been touched in years keep
   submitting telemetry to a Worker that hasn't been touched in months.
2. Old AE rows stay queryable when new fields land.
3. The "no IP data path" guarantee in [`README.md`](./README.md) doesn't
   quietly degrade.

If a change cuts against any of the rules below, **stop and open an issue**
before touching the code.

## 1. `schema/1.lock.json` is append-only

The lock file is the positional source of truth for the AE blob/double/bit
layout. Position is the contract. AE columns are positional (`blob5`,
`double3`); rows already in storage use the layout that was current when
they were written.

**You may:**

- **Append** a new entry to `lock.blobs`, `lock.doubles`, or `lock.bits` at
  the next free position.
- Add a new typed Zod field in [`src/schema.ts`](./src/schema.ts) for a
  field you've appended to the lock.
- Update [`src/ae.ts`](./src/ae.ts) if mapping a new typed field needs
  custom handling beyond `readPath`.

**You may NOT:**

- **Rename** an entry in the lock file. A rename breaks AE queries that
  filter or extract by the old name (downstream may have ad-hoc SQL we don't
  control).
- **Remove** an entry. Old rows have data in that position; removing the
  name in the lock orphans them.
- **Reorder** entries. AE columns are positional; reordering relabels every
  historical row.
- **Reposition** an entry (move it from `blobs` to `doubles`, etc.). Same
  reasoning as reordering.

A removal or rename requires bumping the schema number — see rule 3 below.

After any append:

```bash
# Regenerate the snapshot to include the new position.
npm test -- -u
# Update the AE-layout block in README.md so the parity test stays green.
```

## 2. Cross-repo coupling

`schema/1.lock.json` is vendored downstream by
[sbpp/sourcebans-pp](https://github.com/sbpp/sourcebans-pp) at
`web/includes/telemetry/schema-1.lock.json`. The panel uses it to drive its
payload extraction set, and a parity test on the panel side asserts the
panel's extractor names deep-equal the lock file's payload field set.

This means:

- **Append edits to `schema/1.lock.json` are safe to land here without a
  paired panel PR**, because the panel will pick up the new position the
  next time it re-vendors the file. Until then, panels send the field as an
  unknown top-level key and the Worker captures it into `extras` — no data
  loss.
- **Non-append edits (rename, reorder, schema bump) require a paired
  panel-side PR before merge here.** The two PRs land in lockstep.
- The cross-repo coupling is one-way (panel vendors from us). Do not import
  panel-side code into this repo, and do not add panel-aware behaviour
  beyond the schema validator.

## 3. Bumping the schema

A subtractive or repurposing change requires a new schema version:

1. Add a new lock file `schema/2.lock.json` (do not edit `1.lock.json`).
2. Add a new validator `schema2` in [`src/schema.ts`](./src/schema.ts).
3. Register `2: schema2` in the `validators` dispatch table.
4. Add a new mapper alongside `mapDataPoint` in [`src/ae.ts`](./src/ae.ts)
   that reads positions from the new lock file.
5. **Keep schema-1 validators in place indefinitely.** Old panels keep
   sending old payloads forever; ageing out a validator means dropping
   data, not cleaning it up.
6. Update [`README.md`](./README.md) with a new AE-layout block for the
   new schema, and document the row-level distinction (`schema` double).
7. Pair with a panel-side PR that bumps the panel's emitted schema number
   in lockstep.

## 4. Adding a typed field within schema 1 (append walk-through)

Concrete steps for "panel started sending `panel.foo`, promote it from
`extras` to a typed slot":

1. Append `"panel.foo"` to `lock.blobs` (or `lock.doubles` if numeric, or
   `lock.bits` if boolean).
2. Add the field to the appropriate Zod sub-schema in `src/schema.ts`,
   marked `.optional()` (the optionality rule never relaxes).
3. If the field needs special mapping (e.g. coercion), update `mapDataPoint`
   in `src/ae.ts`. Otherwise the lock-driven path handles it for free.
4. Update the AE-layout block in `README.md` to match the new lock file
   contents — the parity test will fail otherwise.
5. Regenerate the snapshot: `npm test -- -u`.
6. Add or extend a test asserting the new field's typed path (and, for bit
   fields, the round-trip through `pack/unpackPanelFeatures`).
7. Commit. CI re-runs the layout / IP-leak / forward-compat suites.

## 5. Privacy / anonymity contract

The list of banned headers and `request.cf` fields in
[`README.md`](./README.md#privacy--anonymity-contract) and
[`src/strip-ip.ts`](./src/strip-ip.ts) is load-bearing. Adding any of those
fields to the data point or to log output is a release blocker, not a nit.

If you want to add ops logging to the Worker, scope it as its own PR and
re-derive the IP-stripping middleware against the new sink. Don't pile
logging on top of an existing route handler.

## 6. Tooling baseline

```bash
npm install
npm run typecheck         # tsc --noEmit
npm run lint              # eslint .
npm test                  # vitest run (workers pool)
npm run deploy:dry-run    # wrangler deploy --dry-run
```

All four must pass locally before pushing. CI re-runs them on every PR.
Don't disable lint rules or `// @ts-ignore` your way around a type error
without explaining why in the diff.
