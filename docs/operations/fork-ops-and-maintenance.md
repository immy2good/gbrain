# gbrain Fork — Operations & Maintenance Guide

> **Audience:** agents and the owner maintaining the iTradeAIMS gbrain fork
> (`immy2good/gbrain`). This is the **maintained, connected fork** that serves
> the live AIMS Brain on Fly. Read this before deploying, re-indexing, or
> syncing with upstream. **Governance: control-plane ADR-0037** (gbrain is a
> maintained connected fork — reverses ADR-0030 "fork retired").
>
> **Why this guide exists:** the deploy/ops path is full of environment-specific
> traps (a WDAC policy that blocks `flyctl` locally, a Windows checkout that
> can't run `ci:local`, sync semantics that silently drop prose, tokens that
> mangle in PowerShell pipes). Every one of them cost real time to discover.
> This guide is so the next agent does NOT reinvent the wheel.

---

## TL;DR — the commands you actually need

```bash
# Deploy the current master to the live brain (runs on a GH Linux runner):
gh workflow run fly-deploy.yml -R immy2good/gbrain-immy-deploy -f confirm=deploy

# Re-index a source's code as code (lights up code_def / code_blast / code_callers):
gh workflow run reindex-source-as-code.yml -R immy2good/gbrain-immy-deploy \
  -f source=itradeaims-indicators -f confirm=reindex

# Persist a source's code strategy WITHOUT a full re-embed (durability only):
gh workflow run reindex-source-as-code.yml -R immy2good/gbrain-immy-deploy \
  -f source=itradeaims-indicators -f confirm=reindex -f full_resync=false

# CI gate (the Windows box CANNOT run ci:local / verify — see §6):
gh workflow run test.yml --repo immy2good/gbrain --ref <branch>
gh workflow run e2e.yml  --repo immy2good/gbrain --ref <branch>
```

`gh run watch <id> -R <repo>` (or `gh run view <id> --log`) to follow any of them.

---

## 1. What this fork is

- **Maintained, connected fork** `immy2good/gbrain`, branch `master`. It serves
  the live **AIMS Brain**: Fly app `gbrain-immy` (region `lhr`) backed by
  **Supabase** Postgres/pgvector + **ZeroEntropy** embeddings.
- `master` = upstream `garrytan/gbrain` **+ a maintained patch set**: MQL/C++
  code-intelligence (call-graph + `#include` graph), `propose_takes`→Haiku,
  UTF-16 ingestion, native-Windows supervisor/autopilot fixes, and
  `sources set-strategy`.
- **Governance:** control-plane **ADR-0037** (in `itradeaims-agent-workflows`)
  records that gbrain is a maintained connected fork, NOT stock upstream. gbrain
  owns **semantic memory only**; the control plane is the **AIMS MCP / governance
  + repo-identity** authority (ADR-0031/0034/0035).
- **Push to upstream (`garrytan`) is DISABLED.** Contribute via PRs only.

## 2. Deploying to the live brain

**The deploy runs on a GitHub Actions Linux runner, NOT locally.** The owner's
workstation blocks the `flyctl` CLI under a Windows **Application Control (WDAC)**
policy — every local `flyctl` invocation fails. The deploy workflow runs the real
`flyctl deploy` on a clean runner using a scoped `FLY_API_TOKEN` repo secret. **Do
not try to disable WDAC** — you don't need to.

**Steps:**
1. Bump the pin in `gbrain-immy-deploy` `Dockerfile` (the
   `RUN bun add -g "git+https://github.com/immy2good/gbrain.git#<sha>"` line) to
   the new `master` SHA. PR + merge to `main`.
2. **Schema-safety check BEFORE deploy** (migrations auto-run on first boot):
   ```bash
   # Confirm the new SHA adds no migrations vs the live pin:
   git show <live-pin-sha>:src/core/migrate.ts | grep -oE 'version: [0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
   git show <new-sha>:src/core/migrate.ts       | grep -oE 'version: [0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
   ```
   Equal max version (and an identical `migrate.ts`) ⇒ **zero migrations run** —
   the deploy is a pure code/binary swap. If they differ, review the new
   migrations for destructive DDL and snapshot Supabase first.
3. `gh workflow run fly-deploy.yml -R immy2good/gbrain-immy-deploy -f confirm=deploy`
   (the `confirm=deploy` input is a deliberate guard).
4. The workflow verifies on-machine: `gbrain --version` should print the new
   version; `gbrain doctor` runs.

**Rollback:** revert the Dockerfile pin to the prior SHA + re-run the workflow,
**or** (faster) `flyctl deploy --app gbrain-immy --image
registry.fly.io/gbrain-immy:deployment-<prior-ID>` (capture the current ID from
`flyctl releases --app gbrain-immy` before deploying).

**One-time token setup** (only if `FLY_API_TOKEN` is missing/rotated):
```bash
flyctl tokens create deploy -a gbrain-immy          # least-privilege, single app
gh secret set FLY_API_TOKEN -R immy2good/gbrain-immy-deploy --body "<token>"
```
**Do NOT pipe the token through a PowerShell native pipe** — PowerShell mangles
the encoding and Fly rejects it ("token validation error"). Use the `--body`
form (or capture into a variable first). A deploy token printed to a console /
chat is exposed — **revoke it** (`flyctl tokens list -a gbrain-immy` →
`flyctl tokens revoke <id>`) and mint a fresh one.

## 3. Re-indexing business code as code

The brain only answers `code_def` / `code_callers` / `code_blast` / `#include`
graph if the source's code files (`.mq4/.mq5/.mqh`, C/C++) are imported as
**code**, not prose.

- **Use `--strategy auto`, NOT `--strategy code`.** `auto` classifies
  per-extension: code→code, `.md`→prose (lossless for mixed repos). `code`
  collects ONLY code files, so a `--full` sync's reconciliation **deletes the
  source's `.md` prose pages**.
- **The sync JOB cannot do this.** The `sync` minion handler hardcodes its
  `performSync` call and ignores `strategy`/`full` (jobs.ts) — so `submit_job`
  won't work. You MUST run the CLI (`gbrain sync --strategy auto --full`).
- **Use the workflow** (runs the CLI on a runner, since local `flyctl` is
  WDAC-blocked):
  ```bash
  gh workflow run reindex-source-as-code.yml -R immy2good/gbrain-immy-deploy \
    -f source=<id> -f confirm=reindex
  ```
  It runs `sources set-strategy <id> auto` (durable — §4) then
  `sync --source <id> --strategy auto --full`. A >100-file `--full` sync
  auto-defers embedding to a background backfill, so the structural call-graph
  is ready fast.
- **Verify** via the gbrain MCP: `code_def PriceToPips` (indicators) /
  `code_def OnTick --lang mql` (EAs) should return real defs; `code_blast`
  returns the transitive call-graph.

## 4. Durability — keep code classified across syncs

`--strategy` on a sync is **per-run**. The auto-sync **cycle** reads
`source.config.strategy` (default `markdown`), so a CHANGED `.mqh` would get
re-imported as prose on the next incremental sync — gradual degrade.

**Persist it** (v0.42.53.2+):
```bash
gbrain sources set-strategy <id> auto      # writes sources.config.strategy
```
…or the reindex workflow with `-f full_resync=false` (set-strategy only, no
redundant re-embed). Do this for **every code source** (currently
`itradeaims-indicators`, `itradeaims-eas`). Both are set to `auto` as of
2026-06-25.

## 5. Keeping the fork fresh (maintenance model — Part E)

**Trigger-based, not calendar-based.** Merge `upstream/master` → `master` +
redeploy when ANY of:
- (a) you're deploying your own change anyway,
- (b) upstream ships a fix/feature you need, or
- (c) drift exceeds ~10 releases.

**Procedure:**
```bash
git fetch upstream
git checkout master && git merge upstream/master
# Resolve VERSION / package.json / CHANGELOG conflicts: keep the fork's higher
# version, strip conflict markers; then the 3-line trio audit MUST agree:
echo "VERSION: $(cat VERSION)"; node -p "require('./package.json').version"; grep -E '^## \[' CHANGELOG.md | head -1
bun install            # refresh bun.lock
bun run typecheck
# Bump the fork micro-version (0.42.53.X), add a CHANGELOG entry.
# Gate on GitHub Actions CI (§6), then deploy (§2).
```
**Drop a patch-set slice when its upstream PR merges** — it becomes redundant
(e.g. PR #2299 MQL code-intel, #2393 UTF-16). Verify with
`git cherry master <slice-branch>` (patch-id check) before dropping.

## 6. CI / testing — the Windows box CANNOT run `ci:local`

`bun run ci:local` and `bun run verify` do **not** run on the Windows
workstation. Four independent environmental walls (all confirmed, none are real
test failures):
1. **gitleaks** not installed (host-side gate). Install it or it hard-fails.
2. **`ci-local.sh` empty-array bug** — `"${EXTRA_MOUNTS[@]:-}"` passes an empty
   string as the docker service name (`no such service:`). Fixed form:
   `${EXTRA_MOUNTS[@]:+"${EXTRA_MOUNTS[@]}"}`.
3. **CRLF in mounted `.sh`** — `core.autocrlf=true` smudges the scripts to CRLF;
   the Linux runner container chokes (`$'\r': command not found`).
4. **`verify` runs `.sh` via `bun run`** which Windows can't exec, and
   `check-test-real-names` emits backslash paths that miss the forward-slash
   allowlist.

**The authoritative gate is GitHub Actions on the fork:**
```bash
gh workflow run test.yml --repo immy2good/gbrain --ref <branch>   # unit + verify
gh workflow run e2e.yml  --repo immy2good/gbrain --ref <branch>   # 36 E2E
```
Both must be green before merging to `master`. Locally, **`bun run typecheck`
and targeted `bun test <file>` work fine on Windows** — use them for fast
feedback, then dispatch GH Actions for the full gate.

> Note: `gh` defaults to the `upstream` remote (garrytan) for which you lack
> admin — **always pass `--repo immy2good/gbrain`** explicitly when dispatching.

## 7. Gotchas & workarounds (learned the hard way)

| Symptom | Cause | Fix |
|---|---|---|
| `flyctl: Application Control policy has blocked this file` | WDAC blocks the CLI for the agent | Use the CI workflows (§2); don't touch WDAC. |
| Fly API `UNAUTHORIZED` / `403` with the local token | `~/.fly/config.yml` token is restricted/org-scoped | Mint a deploy token (§2); don't scan credential files. |
| Deploy fails `token validation error` | PowerShell native pipe mangled the secret | Set the secret with `--body` (§2). |
| PR CI re-run still fails on the same PR-template error | `gh run rerun --failed` replays the FROZEN event payload (old PR body) | Push a new commit to fire a fresh `synchronize` event. |
| Control-plane PR fails "Missing required section" | Strict shared PR template | Fill EVERY section of `.github/PULL_REQUEST_TEMPLATE.md`; check exactly one Author-Type box. |
| ADR-integrity-lock: "accepted ADR body is immutable" | Edited an accepted ADR's body | Status line must START with `superseded`/`deprecated`, reference the new ADR, and EVERY other line stay byte-identical. |
| Engine-parity / symlink / supervisor tests fail on Windows | No `DATABASE_URL`, no symlink privilege, process-spawn model | Environmental — they pass on the Linux GH Actions gate. |
| A consolidation commit accidentally includes a reverted file | A diagnostic `git checkout <ref> -- <file>` staged it | Targeted `git add <file>` only; never `git add -A` during conflict work. |

## Pointers

- **Deploy repo:** `immy2good/gbrain-immy-deploy` — `Dockerfile` pin, `fly.toml`,
  `.github/workflows/{fly-deploy,reindex-source-as-code}.yml`, README.
- **Governance:** control-plane `itradeaims-agent-workflows` ADR-0037, ADR-0030
  (superseded-in-part), ADR-0029 (single-main GitHub Flow).
- **AIMS Brain:** query first — `decisions/gbrain-fork-adr-0037-merged-2026-06-25`,
  `findings/business-mql-now-code-indexed-on-prod-2026-06-25`,
  `project/gbrain-fork-part-a-consolidation`.
