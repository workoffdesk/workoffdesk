// The runtime an over-the-air update must match. Version and build numbers do not change the native code,
// and package.json scripts do not reach the binary.
/** @type {import('expo/fingerprint').Config} */
module.exports = { sourceSkips: ['ExpoConfigVersions', 'PackageJsonScriptsAll'] };
