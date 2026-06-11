import { describe, expect, test } from 'bun:test';
import { buildDetachedSupervisorSpawn, DETACHED_SUPERVISOR_STDIO } from '../src/commands/jobs.ts';

describe('buildDetachedSupervisorSpawn', () => {
  test('source execution re-runs bun with cli.ts as argv[1]', () => {
    const spawn = buildDetachedSupervisorSpawn(
      'C:/Users/example/.bun/bin/bun.exe',
      'D:/repo/gbrain/src/cli.ts',
      ['jobs', 'supervisor', 'start', '--json'],
    );

    expect(spawn.command).toBe('C:/Users/example/.bun/bin/bun.exe');
    expect(spawn.args).toEqual([
      'D:/repo/gbrain/src/cli.ts',
      'jobs',
      'supervisor',
      'start',
      '--json',
    ]);
  });

  test('compiled gbrain executable does not pass Bun virtual argv[1] as command', () => {
    const spawn = buildDetachedSupervisorSpawn(
      'C:/Users/example/.bun/bin/gbrain.exe',
      'B:/~BUN/root/gbrain',
      ['jobs', 'supervisor', 'start', '--json'],
    );

    expect(spawn.command).toBe('C:/Users/example/.bun/bin/gbrain.exe');
    expect(spawn.args).toEqual(['jobs', 'supervisor', 'start', '--json']);
  });

  test('detached supervisor does not inherit parent stdio handles', () => {
    expect(DETACHED_SUPERVISOR_STDIO).toEqual(['ignore', 'ignore', 'ignore']);
  });
});
