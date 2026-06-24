/**
 * config.js — frozen configuration singleton parsed from the environment.
 *
 * Reads env once and exposes an immutable object consumed across the app.
 * env.assertEnv() must have run first (index.js calls it before requiring this
 * module) so DATABASE_URL and TRACKING_HASH_SALT are guaranteed non-empty here.
 *
 * Security: this object intentionally never carries the raw connection string
 * into logs — DATABASE_URL is only read by db.js. Still, we keep it on the
 * config object so it has one owner; callers must not log config.DATABASE_URL.
 */
'use strict';

const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const PORT = parseInt(process.env.PORT, 10) || 8080;

// BASE_PATH: path prefix the sub-app is mounted under. Defaults to '/tracking'
// (the VPS deployment). Set BASE_PATH='' (empty) for local dev at root.
// Normalize: ensure it starts with '/' when non-empty and has no trailing '/'.
function normalizeBasePath(raw) {
  if (raw == null) return '/tracking';
  let p = String(raw).trim();
  if (p === '') return ''; // root mount
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

const config = Object.freeze({
  NODE_ENV,
  PORT,
  BASE_PATH,
  DATABASE_URL: process.env.DATABASE_URL, // guaranteed non-empty by env.assertEnv()
  TRACKING_HASH_SALT: process.env.TRACKING_HASH_SALT, // guaranteed non-empty by env.assertEnv()
});

module.exports = config;
