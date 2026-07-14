const { generateId, now, mapQueueRow, parseJson } = require('./helpers');

class QueueRepository {
  constructor(db) {
    this._db = db;

    this._stmts = {
      getAll: db.prepare('SELECT * FROM queues'),
      getById: db.prepare('SELECT * FROM queues WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO queues (
          id, name, profile_id, page_identity, group_ids,
          posts, delay_minutes, approval_mode, enable_timer, state, logs,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      update: db.prepare(`
        UPDATE queues SET
          name = ?, profile_id = ?, page_identity = ?, group_ids = ?,
          posts = ?, delay_minutes = ?, approval_mode = ?, enable_timer = ?, state = ?, logs = ?,
          updated_at = ?
        WHERE id = ?
      `),
      delete: db.prepare('DELETE FROM queues WHERE id = ?'),
      updateState: db.prepare(
        'UPDATE queues SET state = ?, updated_at = ? WHERE id = ?',
      ),
      updateLogs: db.prepare(
        'UPDATE queues SET logs = ?, updated_at = ? WHERE id = ?',
      ),
    };
  }

  async getQueues() {
    return this._stmts.getAll.all().map(mapQueueRow);
  }

  async getQueueById(id) {
    return mapQueueRow(this._stmts.getById.get(id));
  }

  async addQueue(queue) {
    const id = generateId();
    const timestamp = now();
    const state = JSON.stringify(
      queue.state || { currentGroupIndex: 0, currentPostIndex: 0, status: 'idle' },
    );

    this._stmts.insert.run(
      id,
      queue.name || '',
      queue.profileId || '',
      queue.pageIdentity || 'personal',
      JSON.stringify(queue.groupIds || []),
      JSON.stringify(queue.posts || []),
      queue.delayMinutes || 5,
      queue.approvalMode ? 1 : 0,
      queue.enableTimer !== undefined ? (queue.enableTimer ? 1 : 0) : 1,
      state,
      JSON.stringify(queue.logs || []),
      timestamp,
      timestamp,
    );

    return mapQueueRow(this._stmts.getById.get(id));
  }

  async updateQueue(id, queueData) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return null;

    const updatedAt = now();

    this._stmts.update.run(
      queueData.name ?? existing.name,
      queueData.profileId ?? existing.profile_id,
      queueData.pageIdentity ?? existing.page_identity,
      queueData.groupIds ? JSON.stringify(queueData.groupIds) : existing.group_ids,
      queueData.posts ? JSON.stringify(queueData.posts) : existing.posts,
      queueData.delayMinutes ?? existing.delay_minutes,
      queueData.approvalMode !== undefined
        ? (queueData.approvalMode ? 1 : 0)
        : existing.approval_mode,
      queueData.enableTimer !== undefined
        ? (queueData.enableTimer ? 1 : 0)
        : existing.enable_timer,
      queueData.state ? JSON.stringify(queueData.state) : existing.state,
      queueData.logs ? JSON.stringify(queueData.logs) : existing.logs,
      updatedAt,
      id,
    );

    return mapQueueRow(this._stmts.getById.get(id));
  }

  async deleteQueue(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }

  async updateQueueState(id, state) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return false;

    const currentState = parseJson(existing.state, {});
    const merged = { ...currentState, ...state };

    this._stmts.updateState.run(JSON.stringify(merged), now(), id);
    return true;
  }

  async addQueueLog(id, log) {
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

module.exports = QueueRepository;
