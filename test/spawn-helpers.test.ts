/**
 * Tests for src/core/minions/spawn-helpers.ts — pure helpers that build the
 * (cmd, args) tuple for spawning the gbrain worker, optionally wrapped in
 * tini for zombie reaping.
 *
 * `buildSpawnInvocation` is a pure function — directly testable without any
 * mocking. `detectTini` shells out to `which tini`; the test asserts only
 * that it returns a string (presence depends on the test machine).
 */

import { describe, test, expect } from 'bun:test';
import {
  buildDetachedCliSpawnOptions,
  buildSpawnInvocation,
  buildSupervisedWorkerSpawnOptions,
  detectTini,
} from '../src/core/minions/spawn-helpers.ts';
import { withEnv } from './helpers/with-env.ts';

describe('buildSpawnInvocation', () => {
  test('without tini: returns cliPath + raw args', () => {
    const result = buildSpawnInvocation('', '/bin/gbrain', ['jobs', 'work']);
    expect(result).toEqual({ cmd: '/bin/gbrain', args: ['jobs', 'work'] });
  });

  test('with tini: wraps cliPath with tini and "--" separator', () => {
    const result = buildSpawnInvocation('/usr/bin/tini', '/bin/gbrain', ['jobs', 'work']);
    expect(result).toEqual({
      cmd: '/usr/bin/tini',
      args: ['--', '/bin/gbrain', 'jobs', 'work'],
    });
  });

  test('empty args list is preserved on both branches', () => {
    expect(buildSpawnInvocation('', '/bin/gbrain', [])).toEqual({
      cmd: '/bin/gbrain',
      args: [],
    });
    expect(buildSpawnInvocation('/usr/bin/tini', '/bin/gbrain', [])).toEqual({
      cmd: '/usr/bin/tini',
      args: ['--', '/bin/gbrain'],
    });
  });
});

describe('detectTini', () => {
  test('returns a string (smoke test only — actual presence depends on machine)', () => {
    const result = detectTini();
    expect(typeof result).toBe('string');
    // Do NOT assert truthiness: tini may or may not be installed on the
    // test host. We only verify the function doesn't throw and returns
    // a defined string ('' when absent, path when present).
  });
});

describe('buildSupervisedWorkerSpawnOptions', () => {
  test('Windows hides console and ignores stdio outside test runs', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      // NODE_ENV cleared via withEnv (isolation R1) to simulate a non-test run.
      await withEnv({ NODE_ENV: undefined }, () => {
        const opts = buildSupervisedWorkerSpawnOptions({ GBRAIN_SUPERVISED: '1' });
        expect(opts.windowsHide).toBe(true);
        expect(opts.stdio).toBe('ignore');
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('non-Windows inherits stdio', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const opts = buildSupervisedWorkerSpawnOptions({ GBRAIN_SUPERVISED: '1' });
      expect(opts.stdio).toBe('inherit');
      expect(opts.windowsHide).toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });
});

describe('buildDetachedCliSpawnOptions', () => {
  test('Windows detached spawn is hidden with ignored stdio outside test runs', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      // NODE_ENV cleared via withEnv (isolation R1) to simulate a non-test run.
      await withEnv({ NODE_ENV: undefined }, () => {
        const opts = buildDetachedCliSpawnOptions({ FOO: 'bar' });
        expect(opts.detached).toBe(true);
        expect(opts.windowsHide).toBe(true);
        expect(opts.stdio).toBe('ignore');
        expect(opts.env).toEqual({ FOO: 'bar' });
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
