/**
 * Firebase Analytics transport for track(). Only ever receives props that
 * scrubProps has already cleaned, and adds nothing that identifies a member:
 * no user id is set (AKIBA-MOB-002 §14), and advertising-ID collection is
 * off in firebase.json.
 *
 * Firebase's limits are enforced here rather than trusted to call sites:
 * names are letters, digits and underscores, at most 40 characters and
 * starting with a letter; string values at most 100 characters; at most 25
 * parameters. Booleans become "true"/"false", since Firebase has no boolean
 * type.
 */
import type { AnalyticsProps } from './events';

type FirebaseParams = Record<string, string | number>;

const MAX_NAME = 40;
const MAX_VALUE = 100;
const MAX_PARAMS = 25;
// Prefixes Firebase reserves for its own events and parameters.
const RESERVED_PREFIX = /^(firebase_|google_|ga_)/;

export function firebaseName(raw: string): string | null {
  const name = raw.replace(/[^A-Za-z0-9_]/g, '_').slice(0, MAX_NAME);
  if (!/^[A-Za-z]/.test(name) || RESERVED_PREFIX.test(name)) return null;
  return name;
}

export function toFirebaseParams(props: AnalyticsProps): FirebaseParams {
  const params: FirebaseParams = {};
  for (const [key, value] of Object.entries(props)) {
    if (Object.keys(params).length >= MAX_PARAMS) break;
    const name = firebaseName(key);
    if (!name || value === null || value === undefined) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) params[name] = value;
    } else if (typeof value === 'boolean') {
      params[name] = value ? 'true' : 'false';
    } else {
      params[name] = value.slice(0, MAX_VALUE);
    }
  }
  return params;
}

type AnalyticsModule = typeof import('@react-native-firebase/analytics');

// Loaded on first use, and given up on after one failure: a development
// build made before Firebase was added has no native module, and analytics
// must never be the reason a screen throws.
let module: AnalyticsModule | null | undefined;

function load(): AnalyticsModule | null {
  if (module !== undefined) return module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('@react-native-firebase/analytics') as AnalyticsModule;
  } catch {
    module = null;
  }
  return module;
}

function send(run: (firebase: AnalyticsModule) => unknown) {
  const firebase = load();
  if (!firebase) return;
  try {
    const result = run(firebase);
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    module = null;
  }
}

export function sendFirebaseEvent(event: string, props: AnalyticsProps) {
  const name = firebaseName(event);
  if (!name) return;
  send((firebase) => firebase.logEvent(firebase.getAnalytics(), name, toFirebaseParams(props)));
}

export function sendFirebaseScreenView(screen: string) {
  const name = screen.slice(0, MAX_VALUE);
  send((firebase) =>
    firebase.logScreenView(firebase.getAnalytics(), { screen_name: name, screen_class: name }),
  );
}
