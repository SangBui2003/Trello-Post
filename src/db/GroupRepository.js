const { generateId, now, mapGroupRow } = require('./helpers');

class GroupRepository {
  constructor(db) {
    this._db = db;

    this._stmts = {
      getAll: db.prepare('SELECT * FROM groups'),
      getById: db.prepare('SELECT * FROM groups WHERE id = ?'),
      insert: db.prepare(
        'INSERT INTO groups (id, name, url, created_at) VALUES (?, ?, ?, ?)',
      ),
      update: db.prepare(
        'UPDATE groups SET name = ?, url = ? WHERE id = ?',
      ),
      delete: db.prepare('DELETE FROM groups WHERE id = ?'),
      getByUrl: db.prepare(
        'SELECT id FROM groups WHERE LOWER(TRIM(url)) = ?',
      ),
    };
  }

  async getGroups() {
    return this._stmts.getAll.all().map(mapGroupRow);
  }

  async addGroup(group) {
    const id = generateId();
    const createdAt = now();

    this._stmts.insert.run(id, group.name || '', group.url || '', createdAt);

    return { id, name: group.name || '', url: group.url || '', createdAt };
  }

  async updateGroup(id, groupData) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return null;

    const name = groupData.name ?? existing.name;
    const url = groupData.url ?? existing.url;

    this._stmts.update.run(name, url, id);

    return mapGroupRow({ ...existing, name, url });
  }

  async deleteGroup(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }

  async deleteGroups(ids) {
    if (!ids || ids.length === 0) return 0;

    // Use transaction for bulk delete
    const deleteMany = this._db.transaction((idList) => {
      let count = 0;
      for (const id of idList) {
        const result = this._stmts.delete.run(id);
        count += result.changes;
      }
      return count;
    });

    return deleteMany(ids);
  }

  async importGroups(groups) {
    const existingUrls = new Set(
      this._stmts.getAll.all()
        .map((g) => g.url?.toLowerCase().trim())
        .filter(Boolean),
    );

    const importMany = this._db.transaction((groupList) => {
      let addedCount = 0;

      for (const group of groupList) {
        const urlToMatch = group.url?.toLowerCase().trim();
        if (!urlToMatch || existingUrls.has(urlToMatch)) continue;

        const id = generateId();
        const createdAt = now();
        this._stmts.insert.run(id, group.name || '', group.url || '', createdAt);
        existingUrls.add(urlToMatch);
        addedCount++;
      }

      return addedCount;
    });

    const addedCount = importMany(groups);
    return { addedCount, total: groups.length };
  }
}

module.exports = GroupRepository;
