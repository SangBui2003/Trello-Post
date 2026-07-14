const { generateId, now, mapSyncQueueRow, parseJson } = require('./helpers');

class SyncQueueRepository {
  constructor(db) {
    this._db = db;

    this._stmts = {
      getAll: db.prepare('SELECT * FROM sync_queues'),
      getById: db.prepare('SELECT * FROM sync_queues WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO sync_queues (
          id, name, profile_id, page_identity, group_ids,
          delay_minutes, state, logs, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      update: db.prepare(`
        UPDATE sync_queues SET
          name = ?, profile_id = ?, page_identity = ?, group_ids = ?,
          delay_minutes = ?, state = ?, logs = ?, updated_at = ?
        WHERE id = ?
      `),
      delete: db.prepare('DELETE FROM sync_queues WHERE id = ?'),
      updateState: db.prepare(
        'UPDATE sync_queues SET state = ?, updated_at = ? WHERE id = ?',
      ),
      updateLogs: db.prepare(
        'UPDATE sync_queues SET logs = ?, updated_at = ? WHERE id = ?',
      ),
    };
  }

  async getSyncQueues() {
    return this._stmts.getAll.all().map(mapSyncQueueRow);
  }

  async getSyncQueueById(id) {
    return mapSyncQueueRow(this._stmts.getById.get(id));
  }

  async addSyncQueue(queue) {
    const id = generateId();
    const timestamp = now();
    const state = JSON.stringify(
      queue.state || { currentGroupIndex: 0, status: 'idle' },
    );

    this._stmts.insert.run(
      id,
      queue.name || '',
      queue.profileId || '',
      queue.pageIdentity || 'personal',
      JSON.stringify(queue.groupIds || []),
      queue.delayMinutes || 1,
      state,
      JSON.stringify(queue.logs || []),
      timestamp,
      timestamp,
    );

    return mapSyncQueueRow(this._stmts.getById.get(id));
  }

  async updateSyncQueue(id, queueData) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return null;

    const updatedAt = now();

    this._stmts.update.run(
      queueData.name ?? existing.name,
      queueData.profileId ?? existing.profile_id,
      queueData.pageIdentity ?? existing.page_identity,
      queueData.groupIds ? JSON.stringify(queueData.groupIds) : existing.group_ids,
      queueData.delayMinutes ?? existing.delay_minutes,
      queueData.state ? JSON.stringify(queueData.state) : existing.state,
      queueData.logs ? JSON.stringify(queueData.logs) : existing.logs,
      updatedAt,
      id,
    );

    return mapSyncQueueRow(this._stmts.getById.get(id));
  }

  async deleteSyncQueue(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }

  async updateSyncQueueState(id, state) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return false;

    const currentState = parseJson(existing.state, {});
    const merged = { ...currentState, ...state };

    this._stmts.updateState.run(JSON.stringify(merged), now(), id);
    return true;
  }

  async addSyncQueueLog(id, log) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return false;

    const logs = parseJson(existing.logs, []);
    logs.push({ timestamp: now(), ...log });

    // Keep only last 100 logs
    const trimmedLogs = logs.length > 100 ? logs.slice(-100) : logs;

    this._stmts.updateLogs.run(JSON.stringify(trimmedLogs), now(), id);
    return true;
  }
}

module.exports = SyncQueueRepository;
