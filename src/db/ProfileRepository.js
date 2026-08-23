const { generateId, now, mapProfileRow, parseJson } = require('./helpers');

class ProfileRepository {
  constructor(db) {
    this._db = db;

    // Prepared statements
    this._stmts = {
      getAll: db.prepare('SELECT * FROM profiles'),
      getById: db.prepare('SELECT * FROM profiles WHERE id = ?'),
      insert: db.prepare(
        'INSERT INTO profiles (id, name, cookie_string, pages, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      delete: db.prepare('DELETE FROM profiles WHERE id = ?'),
      updatePages: db.prepare('UPDATE profiles SET pages = ? WHERE id = ?'),
      updateCookieString: db.prepare('UPDATE profiles SET cookie_string = ? WHERE id = ?'),
      updateCookieAndMetadata: db.prepare('UPDATE profiles SET cookie_string = ?, metadata = ? WHERE id = ?'),
      updateName: db.prepare('UPDATE profiles SET name = ? WHERE id = ?'),
    };
  }

  async getProfiles() {
    return this._stmts.getAll.all().map(mapProfileRow);
  }

  async getProfileById(id) {
    return mapProfileRow(this._stmts.getById.get(id));
  }

  async addProfile(profile) {
    const id = generateId();
    const createdAt = now();

    this._stmts.insert.run(
      id,
      profile.name || '',
      profile.cookieString || '',
      JSON.stringify(profile.pages || []),
      JSON.stringify(profile.metadata || {}),
      createdAt,
    );

    return {
      id,
      name: profile.name || '',
      cookieString: profile.cookieString || '',
      pages: profile.pages || [],
      metadata: profile.metadata || {},
      createdAt,
    };
  }

  async deleteProfile(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }

  async getProfilePages(profileId) {
    const row = this._stmts.getById.get(profileId);
    if (!row) return [];

    return parseJson(row.pages, []);
  }

  async updateProfilePages(profileId, pages) {
    const row = this._stmts.getById.get(profileId);
    if (!row) return null;

    const mappedPages = pages.map((pg, idx) => ({
      id: pg.id || `${profileId}_page_${idx}_${Date.now()}`,
      pageName: pg.pageName,
      pageUrl: pg.pageUrl,
    }));

    this._stmts.updatePages.run(JSON.stringify(mappedPages), profileId);
    return mappedPages;
  }

  async updatePageName(profileId, pageId, newName) {
    const row = this._stmts.getById.get(profileId);
    if (!row) return null;

    const pages = parseJson(row.pages, []);
    const page = pages.find((pg) => pg.id === pageId);
    if (!page) return false;

    page.pageName = newName;
    this._stmts.updatePages.run(JSON.stringify(pages), profileId);
    return true;
  }

  async updateCookieString(profileId, cookieString, metadata = null) {
    const row = this._stmts.getById.get(profileId);
    if (!row) return false;

    if (metadata) {
      const merged = { ...parseJson(row.metadata, {}), ...metadata };
      this._stmts.updateCookieAndMetadata.run(cookieString, JSON.stringify(merged), profileId);
    } else {
      this._stmts.updateCookieString.run(cookieString, profileId);
    }
    return true;
  }

  async updateProfileName(profileId, name) {
    const row = this._stmts.getById.get(profileId);
    if (!row) return false;

    this._stmts.updateName.run(name, profileId);
    return true;
  }
}

module.exports = ProfileRepository;
