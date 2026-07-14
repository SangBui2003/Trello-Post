const { ipcMain } = require('electron');

/**
 * @param {{ db: Object }} ctx
 */
function register(ctx) {
  const { db } = ctx;

  ipcMain.handle('group:list', async () => {
    return await db.getGroups();
  });

  ipcMain.handle('group:add', async (_, payload) => {
    return await db.addGroup(payload);
  });

  ipcMain.handle('group:update', async (_, { id, data }) => {
    return await db.updateGroup(id, data);
  });

  ipcMain.handle('group:delete', async (_, id) => {
    return await db.deleteGroup(id);
  });

  ipcMain.handle('group:delete_multiple', async (_, ids) => {
    return await db.deleteGroups(ids);
  });

  ipcMain.handle('group:import', async (_, groups) => {
    return await db.importGroups(groups);
  });
}

module.exports = { register };
