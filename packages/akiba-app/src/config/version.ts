import type { MobileConfig } from '@/contracts';

/**
 * Dotted-version comparison for the force-upgrade gate. Deliberately not a
 * full semver implementation: `/api/v1/config` publishes plain
 * `major.minor.patch` strings (hub-page's appConfig.server.ts), and a build
 * must never be blocked because a pre-release suffix confused the parser.
 * Non-numeric or missing segments count as 0.
 *
 * Returns a negative number when `a` is older than `b`, 0 when equal, a
 * positive number when newer.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function parseVersion(value: string): number[] {
  return value
    .trim()
    .split('.')
    .map((segment) => {
      const numeric = Number.parseInt(segment, 10);
      return Number.isNaN(numeric) ? 0 : numeric;
    });
}

export type LaunchGate = 'ok' | 'maintenance' | 'upgrade_required';

/**
 * Resolves what the launch sequence must show before any tab renders.
 * Maintenance outranks the version gate: when the backend is down for
 * maintenance, telling someone to go update their app would send them off
 * to fix the wrong problem.
 */
export function resolveLaunchGate(input: {
  config: MobileConfig;
  platform: 'ios' | 'android';
  installedVersion: string;
}): LaunchGate {
  if (input.config.maintenance) return 'maintenance';
  const minimum = input.config.minimumSupportedVersion[input.platform];
  if (compareVersions(input.installedVersion, minimum) < 0) return 'upgrade_required';
  return 'ok';
}
