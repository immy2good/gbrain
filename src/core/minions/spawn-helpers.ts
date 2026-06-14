/**
 * Pure helpers for spawning the gbrain worker, optionally wrapped in tini.
 *
 * Background: zombie children spawned by the worker (shell jobs, embed
 * batches, sub-agents) need a SIGCHLD handler to be reaped. The cli.ts
 * SIGCHLD handler covers JS-spawned children that exit while the parent is
 * alive; tini wraps the worker process tree to also reap native-addon
 * descendants and orphans. Together the two layers compose with AlphaClaw's
 * container-level tini-as-PID-1.
 *
 * `detectTini()` is called once at supervisor / autopilot startup. The
 * resolved path is reused on every respawn — we do NOT shell out per spawn.
 * `buildSpawnInvocation()` is a pure function describing the (cmd, args)
 * tuple to pass to `child_process.spawn`. Tests call it directly without
 * any module mocking.
 */

import { execFileSync, type SpawnOptions } from 'child_process';

/**
 * Resolve the tini binary path, or return an empty string when not on PATH.
 * Resolved once at startup so we don't shell out on every respawn.
 */
export function detectTini(): string {
  try {
    // Pass `env: process.env` explicitly: Bun's execFileSync does NOT
    // inherit the current process env by default (Bun snapshots env at
    // startup). Without this, runtime mutations to PATH (including in
    // tests) are invisible to `which`.
    return execFileSync('which', ['tini'], {
      encoding: 'utf8',
      timeout: 2000,
      env: process.env,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Build the (cmd, args) tuple for spawning the gbrain worker, optionally
 * wrapped in tini. When `tiniPath` is non-empty, returns
 *   { cmd: tiniPath, args: ['--', cliPath, ...args] }
 * which makes tini PID 1 of the spawned subtree. When empty, returns
 *   { cmd: cliPath, args }
 * for a direct spawn. Pure function, no side effects.
 */
export function buildSpawnInvocation(
  tiniPath: string,
  cliPath: string,
  args: string[],
): { cmd: string; args: string[] } {
  return tiniPath
    ? { cmd: tiniPath, args: ['--', cliPath, ...args] }
    : { cmd: cliPath, args };
}

/**
 * Spawn options for supervised worker children (ChildWorkerSupervisor).
 *
 * On Windows, `stdio: 'inherit'` without `windowsHide` allocates a fresh console
 * per spawn. That console closes immediately (nothing holds it open), the worker
 * gets a console-close event, exits code 0, and the supervisor respawns in a
 * ~1s loop — visible as CMD windows flashing every second (issue #1801 class).
 *
 * Non-Windows keeps inherited stdio so operators still see worker output in the
 * foreground supervisor path.
 */
export function buildSupervisedWorkerSpawnOptions(
  env: NodeJS.ProcessEnv,
): SpawnOptions {
  if (process.platform === 'win32' && process.env.NODE_ENV !== 'test') {
    return {
      stdio: 'ignore',
      env,
      windowsHide: true,
    };
  }
  return { stdio: 'inherit', env };
}

/**
 * Spawn options for a detached background gbrain CLI re-exec (supervisor
 * `--detach`, startup hooks, etc.). Hides the console on Windows.
 */
export function buildDetachedCliSpawnOptions(
  env: NodeJS.ProcessEnv = process.env,
): SpawnOptions {
  if (process.platform === 'win32' && process.env.NODE_ENV !== 'test') {
    return {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true,
    };
  }
  return {
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
    env,
  };
}
