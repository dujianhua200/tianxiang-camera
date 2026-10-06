const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 920, minWidth: 1024, minHeight: 680,
    backgroundColor: '#0b0e12',
    title: '天象七星 · 批量水印台账工具',
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile('天象七星批量水印.html');
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
