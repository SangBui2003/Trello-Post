const path = require('path');
const fs = require('fs');
const BetterSqlite3 = require('better-sqlite3');
const { app } = require('electron');
const { SCHEMA_SQL } = require('./schema');
const { generateId, now } = require('./helpers');
const ProfileRepository = require('./ProfileRepository');
const GroupRepository = require('./GroupRepository');
const PackRepository = require('./PackRepository');
const QueueRepository = require('./QueueRepository');
const SyncQueueRepository = require('./SyncQueueRepository');

const DB_FILENAME = 'postpilot.db';
const LEGACY_JSON_FILENAME = 'fb-profiles.json';

class Database {
  constructor() {
    const dbPath = path.join(app.getPath('userData'), DB_FILENAME);
    this._sqlite = new BetterSqlite3(dbPath);

    // WAL mode for better concurrency
    this._sqlite.pragma('journal_mode = WAL');
    this._sqlite.pragma('foreign_keys = ON');

    this._initSchema();
    this._migrateFromJson();

    // Initialize repositories
    const profileRepo = new ProfileRepository(this._sqlite);
    const groupRepo = new GroupRepository(this._sqlite);
    const packRepo = new PackRepository(this._sqlite);
    const queueRepo = new QueueRepository(this._sqlite);
    const syncQueueRepo = new SyncQueueRepository(this._sqlite);

    // Expose repository methods directly on this instance
    this._bindMethods(profileRepo);
    this._bindMethods(groupRepo);
    this._bindMethods(packRepo);
    this._bindMethods(queueRepo);
    this._bindMethods(syncQueueRepo);
  }

  /**
   * Bind all public methods from a repository onto this Database instance.
   * Preserves `this` context of the repository.
   */
  _bindMethods(repo) {
    const proto = Object.getPrototypeOf(repo);
    const methodNames = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && !name.startsWith('_'));

    for (const name of methodNames) {
      this[name] = repo[name].bind(repo);
    }
  }

  _initSchema() {
    this._sqlite.exec(SCHEMA_SQL);
    try {
      this._sqlite.exec('ALTER TABLE queues ADD COLUMN enable_timer INTEGER DEFAULT 1');
    } catch (e) {}
    try {
      this._sqlite.exec('ALTER TABLE profiles ADD COLUMN metadata TEXT DEFAULT \'{}\'');
    } catch (e) {}
  }

  /**
   * Migrate data from legacy JSON file (fb-profiles.json) if it exists
   * and the SQLite DB is empty.
   */
  _migrateFromJson() {
    const jsonPath = path.join(app.getPath('userData'), LEGACY_JSON_FILENAME);
    if (!fs.existsSync(jsonPath)) return;

    // Only migrate if all tables are empty
    const profileCount = this._sqlite.prepare('SELECT COUNT(*) as count FROM profiles').get();
    const groupCount = this._sqlite.prepare('SELECT COUNT(*) as count FROM groups').get();
    if (profileCount.count > 0 || groupCount.count > 0) return;

    console.log('[Database] Migrating data from legacy JSON file...');

    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const data = JSON.parse(raw);

      this._sqlite.transaction(() => {
        this._migrateProfiles(data.profiles || []);
        this._migrateGroups(data.groups || []);
        this._migratePacks(data.packs || []);
        this._migrateQueues(data.queues || []);
        this._migrateSyncQueues(data.syncQueues || []);
      })();

      // Backup the old file
      const backupPath = jsonPath + '.bak';
      fs.renameSync(jsonPath, backupPath);
      console.log('[Database] Migration complete. Old file backed up to:', backupPath);
    } catch (error) {
      console.error('[Database] Migration failed:', error.message);
    }
  }

  _migrateProfiles(profiles) {
    const stmt = this._sqlite.prepare(
      'INSERT INTO profiles (id, name, cookie_string, pages, created_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const p of profiles) {
      stmt.run(
        p.id || generateId(),
        p.name || '',
        p.cookieString || '',
        JSON.stringify(p.pages || []),
        p.createdAt || now(),
      );
    }
  }

  _migrateGroups(groups) {
    const stmt = this._sqlite.prepare(
      'INSERT INTO groups (id, name, url, created_at) VALUES (?, ?, ?, ?)',
    );

    for (const g of groups) {
      stmt.run(
        g.id || generateId(),
        g.name || '',
        g.url || '',
        g.createdAt || now(),
      );
    }
  }

  _migratePacks(packs) {
    const stmt = this._sqlite.prepare(
      'INSERT INTO packs (id, name, posts, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const p of packs) {
      stmt.run(
        p.id || generateId(),
        p.name || '',
        JSON.stringify(p.posts || []),
        p.createdAt || now(),
        p.updatedAt || now(),
      );
    }
  }

  _migrateQueues(queues) {
    const stmt = this._sqlite.prepare(`
      INSERT INTO queues (
        id, name, profile_id, page_identity, group_ids,
        posts, delay_minutes, approval_mode, enable_timer, state, logs,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const q of queues) {
      stmt.run(
        q.id || generateId(),
        q.name || '',
        q.profileId || '',
        q.pageIdentity || 'personal',
        JSON.stringify(q.groupIds || []),
        JSON.stringify(q.posts || []),
        q.delayMinutes || 5,
        q.approvalMode ? 1 : 0,
        q.enableTimer !== undefined ? (q.enableTimer ? 1 : 0) : 1,
        JSON.stringify(q.state || {}),
        JSON.stringify(q.logs || []),
        q.createdAt || now(),
        q.updatedAt || now(),
      );
    }
  }

  _migrateSyncQueues(syncQueues) {
    const stmt = this._sqlite.prepare(`
      INSERT INTO sync_queues (
        id, name, profile_id, page_identity, group_ids,
        delay_minutes, state, logs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const q of syncQueues) {
      stmt.run(
        q.id || generateId(),
        q.name || '',
        q.profileId || '',
        q.pageIdentity || 'personal',
        JSON.stringify(q.groupIds || []),
        q.delayMinutes || 1,
        JSON.stringify(q.state || {}),
        JSON.stringify(q.logs || []),
        q.createdAt || now(),
        q.updatedAt || now(),
      );
    }
  }

  /**
   * No-op for backward compatibility with controllers that call db.flush().
   * better-sqlite3 writes are synchronous — no flush needed.
   */
  async flush() {
    // No-op
  }

  /**
   * Close the database connection. Call on app quit.
   */
  close() {
    if (this._sqlite && this._sqlite.open) {
      this._sqlite.close();
    }
  }
}

const db = new Database();
module.exports = db;
