const { generateId, now, mapPackRow } = require('./helpers');

class PackRepository {
  constructor(db) {
    this._db = db;

    this._stmts = {
      getAll: db.prepare('SELECT * FROM packs'),
      getById: db.prepare('SELECT * FROM packs WHERE id = ?'),
      insert: db.prepare(
        'INSERT INTO packs (id, name, posts, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ),
      update: db.prepare(
        'UPDATE packs SET name = ?, posts = ?, updated_at = ? WHERE id = ?',
      ),
      delete: db.prepare('DELETE FROM packs WHERE id = ?'),
    };
  }

  async getPacks() {
    return this._stmts.getAll.all().map(mapPackRow);
  }

  async getPackById(id) {
    return mapPackRow(this._stmts.getById.get(id));
  }

  async addPack(pack) {
    const id = generateId();
    const timestamp = now();

    this._stmts.insert.run(
      id,
      pack.name || '',
      JSON.stringify(pack.posts || []),
      timestamp,
      timestamp,
    );

    return {
      id,
      name: pack.name || '',
      posts: pack.posts || [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async updatePack(id, packData) {
    const existing = this._stmts.getById.get(id);
    if (!existing) return null;

    const name = packData.name ?? existing.name;
    const posts = packData.posts
      ? JSON.stringify(packData.posts)
      : existing.posts;
    const updatedAt = now();

    this._stmts.update.run(name, posts, updatedAt, id);

    return mapPackRow({
      ...existing,
      name,
      posts,
      updated_at: updatedAt,
    });
  }

  async deletePack(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }
}

module.exports = PackRepository;
