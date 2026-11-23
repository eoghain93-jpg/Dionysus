/* global __APP_BUILD__ */
// Which build of the till is running. Sent with every database request
// (x-app-build) so the audit log shows which bundle made each change — and
// when each till actually picked up a new release.
//
// __APP_BUILD__ is injected by vite.config.js from the deploy's git commit.
export const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' && __APP_BUILD__ ? __APP_BUILD__ : 'dev'
