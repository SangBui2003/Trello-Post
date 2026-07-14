const crypto = require('crypto');

/**
 * Generate unique ID using UUID v4.
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Get ISO timestamp string.
 */
function now() {
  return new Date().toISOString();
}

/**
 * Safely parse JSON string, return fallback on failure.
 */
function parseJson(str, fallback = []) {
  if (!str) return fallback;

  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Map SQLite row (snake_case) → camelCase object for Profile.
 */
function mapProfileRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    cookieString: row.cookie_string,
    pages: parseJson(row.pages, []),
    createdAt: row.created_at,
  };
}

/**
 * Map SQLite row → camelCase object for Group.
 */
function mapGroupRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
  };
}

/**
 * Map SQLite row → camelCase object for Pack.
 */
function mapPackRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    posts: parseJson(row.posts, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map SQLite row → camelCase object for Queue.
 */
function mapQueueRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    profileId: row.profile_id,
    pageIdentity: row.page_identity,
    groupIds: parseJson(row.group_ids, []),
    posts: parseJson(row.posts, []),
    delayMinutes: row.delay_minutes,
    approvalMode: Boolean(row.approval_mode),
    enableTimer: row.enable_timer !== undefined ? Boolean(row.enable_timer) : true,
    state: parseJson(row.state, { currentGroupIndex: 0, currentPostIndex: 0, status: 'idle' }),
    logs: parseJson(row.logs, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map SQLite row → camelCase object for SyncQueue.
 */
function mapSyncQueueRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    profileId: row.profile_id,
    pageIdentity: row.page_identity,
    groupIds: parseJson(row.group_ids, []),
    delayMinutes: row.delay_minutes,
    state: parseJson(row.state, { currentGroupIndex: 0, status: 'idle' }),
    logs: parseJson(row.logs, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  generateId,
  now,
  parseJson,
  mapProfileRow,
  mapGroupRow,
  mapPackRow,
  mapQueueRow,
  mapSyncQueueRow,
};
