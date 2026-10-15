import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const isProduction =
  process.argv.includes('--production') ||
  process.env.AKIBA_BUILD_VARIANT === 'production' ||
  process.env.EAS_BUILD_PROFILE === 'production';

if (!isProduction) {
  console.log('Akiba production preflight skipped for a non-production build.');
  process.exit(0);
}

const appConfig = readJson('app.json');
const easConfig = readJson('eas.json');
const errors = [];

const apiUrl = requiredEnvironmentUrl('EXPO_PUBLIC_API_BASE_URL');
const supabaseUrl = requiredEnvironmentUrl('EXPO_PUBLIC_SUPABASE_URL');
requireEnvironmentValue('EXPO_PUBLIC_SUPABASE_ANON_KEY');

if (apiUrl && !isAkibaProductionHost(apiUrl.hostname)) {
  errors.push(
    `EXPO_PUBLIC_API_BASE_URL must use akibamiles.com in production; received ${apiUrl.hostname}.`,
  );
}

if (supabaseUrl && isLocalHost(supabaseUrl.hostname)) {
  errors.push('EXPO_PUBLIC_SUPABASE_URL cannot point at a local host in production.');
}

const expo = appConfig.expo ?? {};
const expectedApplicationId = 'com.akibamiles.akiba';
if (expo.name !== 'Akiba') {
  errors.push('The production app display name must be Akiba.');
}
if (expo.slug !== 'akiba') {
  errors.push('The Expo project slug must be akiba.');
}
if (expo.scheme !== 'akiba') {
  errors.push('The production deep-link scheme must be akiba.');
}
if (expo.extra?.configurationNotes?.androidPackageIsPlaceholder === true) {
  errors.push('The Android package name is still marked as a placeholder.');
}
if (expo.android?.package !== expectedApplicationId) {
  errors.push(`expo.android.package must remain ${expectedApplicationId}.`);
}
if (expo.ios?.bundleIdentifier !== expectedApplicationId) {
  errors.push(`expo.ios.bundleIdentifier must remain ${expectedApplicationId}.`);
}
if (!expo.owner) errors.push('expo.owner is required for a production EAS build.');
if (!expo.extra?.eas?.projectId) errors.push('expo.extra.eas.projectId is required for a production EAS build.');
if (!isAndroidPackage(expo.android?.package)) {
  errors.push('expo.android.package must be a valid, finalized reverse-domain package name.');
}
if (expo.updates?.enabled !== false) {
  errors.push('EAS Update must remain disabled until an update and rollback policy is approved.');
}
if (expo.android?.usesCleartextTraffic === true) {
  errors.push('Android cleartext traffic cannot be enabled in production.');
}

for (const permission of [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]) {
  if (!expo.android?.blockedPermissions?.includes(permission)) {
    errors.push(`${permission} must remain blocked from the production manifest.`);
  }
}

const packageManifest = readJson('package.json');
if (packageManifest.dependencies?.['expo-dev-client']) {
  errors.push('expo-dev-client cannot be a dependency of the store application.');
}

const productionProfile = easConfig.build?.production;
if (productionProfile?.developmentClient === true) {
  errors.push('The production EAS profile cannot be a development client.');
}
if (productionProfile?.android?.buildType !== 'app-bundle') {
  errors.push('The production Android build must produce an app-bundle.');
}
if (easConfig.submit?.production?.android?.track !== 'internal') {
  errors.push('The first Play submission must be constrained to the internal track.');
}

for (const asset of [
  'assets/images/icon.png',
  'assets/images/android-icon-foreground.png',
  'assets/images/android-icon-monochrome.png',
]) {
  const dimensions = readPngDimensions(asset);
  if (!dimensions || dimensions.width !== 1024 || dimensions.height !== 1024) {
    errors.push(`${asset} must be a 1024x1024 PNG.`);
  }
}

for (const sourceFile of ['src/app/_layout.tsx', 'src/design-system/tokens.ts']) {
  const source = readFileSync(resolve(projectRoot, sourceFile), 'utf8');
  if (/FTSterling|Trial-[A-Za-z-]+\.otf/.test(source)) {
    errors.push(`${sourceFile} still references the trial Sterling font files.`);
  }
}

if (errors.length > 0) {
  console.error('Akiba production preflight failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Akiba production preflight passed.');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8'));
}

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) errors.push(`${name} is required for a production build.`);
  return value;
}

function requiredEnvironmentUrl(name) {
  const value = requireEnvironmentValue(name);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') errors.push(`${name} must use HTTPS in production.`);
    if (url.username || url.password) errors.push(`${name} cannot contain credentials.`);
    return url;
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
    return null;
  }
}

function isAkibaProductionHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'akibamiles.com' || normalized.endsWith('.akibamiles.com');
}

function isLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '10.0.2.2' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.endsWith('.local')
  );
}

function isAndroidPackage(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(value);
}

function readPngDimensions(relativePath) {
  try {
    const buffer = readFileSync(resolve(projectRoot, relativePath));
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}
