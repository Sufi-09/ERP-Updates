# Recovery & rollback flow

> [!WARNING]
> **STATUS: INCOMPLETE — DO NOT RELY ON THIS DOCUMENT.**
> The ERP updater and its recovery flow are still under construction.
> This file records the *intended* design and the work that remains.
> Per [UPDATE-DELIVERY.md](UPDATE-DELIVERY.md), **no production release
> may be published until the exit criteria below are met and tested.**

## Goals

1. Every update applied by the updater can be rolled back to the exact
   previous version, including data/schema migrations.
2. A failed or interrupted update leaves the installation in a recoverable
   state (the updater must be crash-safe: apply-to-stage, then swap).
3. Recovery works even when the updater itself is the broken component
   (out-of-band path).

## Intended design (draft)

### Rollback via N-1 release

- The updater keeps the previous version's package (or a snapshot of the
  replaced files) locally as a **restore point** before applying an update.
- `rollback` re-installs the restore point using the same verification
  pipeline (signature + checksums) as a normal update.
- Database migrations must ship with inverse/`ROLLBACK` scripts in the
  payload, executed in reverse order.

### Out-of-band recovery

- If the updater cannot run, an operator can download any previous
  verified release from this repository and run its `ROLLBACK` entry point
  manually (see `payload/README.md` for the intended payload contract).
- Recovery media/bootstrap: *(design TBD — updater team)*.

### Failure handling

- Update application must be transactional: stage → verify → swap →
  health-check; on health-check failure, auto-revert to the restore point.
- All updater actions (apply, fail, revert) must be logged with version,
  channel, and signature fingerprint for audit.

## TODO / exit criteria (blocking production releases)

- [ ] Updater implements stage/verify/swap with health checks.
- [ ] Restore points created before every apply, with retention policy.
- [ ] `rollback` command tested from version N to N-1, including
      data migrations.
- [ ] Payload contract (`APPLY`/`ROLLBACK` entry points) finalized and
      documented in `payload/README.md`.
- [ ] Out-of-band recovery procedure written and rehearsed on a clean VM.
- [ ] Crash-mid-update test: kill the updater at each phase, confirm the
      system recovers automatically or via documented manual steps.
- [ ] Client-facing recovery guide written (`CLIENT-SETUP.md` addendum).

## Related

- [UPDATE-DELIVERY.md](UPDATE-DELIVERY.md) — release process & publish checklist
- [../SECURITY.md](../SECURITY.md) — signing key compromise response
