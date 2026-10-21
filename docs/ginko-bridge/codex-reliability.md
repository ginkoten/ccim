# Opt-in Codex receiver reliability

The existing CLI supports a narrowly enabled runtime for a Codex receiver:
`CCIM_RELIABLE_CODEX=1`. The default listener and Claude path are unchanged.
Deploy the CLI together with `plugin/lib/codex-reliability.cjs` and
`plugin/lib/codex-queue.cjs` into a versioned private runtime directory. Do not
replace a shared plugin cache to activate this for one member.

The runtime uses the existing session binding and relay. It never joins,
provisions, changes trust, or starts a second service. Set `CCIM_CODEX` to the
existing official Codex binary. It uses the public app-server protocol for
queue/list, thread/read and queue/add; message text travels through stdin rather
than command arguments. It does not inspect internal session databases.

## Delivery and process boundaries

- An atomic exclusive lock is keyed by the canonical session file, so default
  home symlinks and project home paths share a lock. A competing start exits.
  Never automatically steal a stale lock or kill a PID just because a file names
  it. Recovery after a crash requires verifying the owner is gone before removing
  the stale lock. Normal SIGTERM/SIGINT and terminal relay events release it.
- A write-ahead delivery journal stores channel/message IDs, deterministic queue
  IDs, state and UTC timestamps, never message text or tokens. Confirmed queue
  acceptance is persisted before ACK. An ACK failure cannot cause a second queue
  submission.
- Failure before queue/add is issued can retry. Once issuance may have happened,
  the runtime only checks the official queue and thread for its delivery marker.
  Positive evidence permits ACK; absence or an unavailable inspection does not
  permit resending. Unresolved entries stay pending for operator review.
- Socket failures, connection timeout and heartbeat loss reconnect within the
  same process. Queuing failures leave the socket alive and retry/reconcile on a
  later message or periodic in-process check. No daemon is added.
- 401 and close codes 4001/4002/4003 terminate; SIGTERM/SIGINT terminate without
  starting a replacement. Existing SessionEnd semantics remain in force. An
  inactive application, SIGKILL, machine sleep or reboot is not promised permanent
  availability. Old hooks may still start the old runtime after a later exit;
  permanent routing requires separately reviewing the actual trusted hook path.

## Diagnostics and rollout

The canonical session directory contains
`.receiver-runtime/<session-id>/events.jsonl`, `delivery.json` and `owner.lock`.
Directories use 0700 and files 0600. Events contain only fixed reason codes,
session/run identifiers, PID and selected numeric metadata. The event log rotates
at 1 MiB and retains one previous file. Raw stderr, URLs, environment, message
text and credentials are not logged. SIGKILL cannot produce a terminal event;
do not invent its cause from a missing terminal record.

Before switching: confirm the actual session, valid authentication, thread
availability and unique old listener; capture code hashes and non-secret status.
Keep an immutable old-runtime copy. Stop only the verified original listener,
then start the isolated version with its original identity and existing proxy.
Verify one PID, who, a single non-business self-test and official queue/thread
evidence. Mark the idle observation start and recheck at least 15 minutes later.

Rollback stops only the verified isolated listener, preserves delivery journal
and audit logs, and starts the original runtime with the same binding. Uncertain
delivery entries require reconciliation before reverting to a legacy consumer
which does not understand the journal. Do not blindly rollback into duplicate
delivery; never rejoin as a rollback step.

Workstation adoption is a separate decision. Its fixed Node/proxy wrapper and
thread-routing shim must be retained. This opt-in code has not itself changed
that deployment or any Claude hook.
