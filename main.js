/* main.js — Electron: muat index.html bawaan, atau index.html hasil pembaruan (hot-update) jika lebih baru */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path'), fs = require('fs'), https = require('https'), crypto = require('crypto');

const BUNDLED = path.join(__dirname, 'index.html');               // index.html yang ikut di dalam exe
const UPDATED = () => path.join(app.getPath('userData'), 'updates', 'index.html'); // hasil unduhan pembaruan
const MAX_BYTES = 40 * 1024 * 1024;
const SPLASH_FILE = path.join(__dirname, 'splash.html');   // file splash bawaan (jika tidak ada, splash dilewati)
const SPLASH_IMG = path.join(__dirname, 'assets', 'splash.jpg');
const UPD_DIR = () => path.join(app.getPath('userData'), 'updates');
const SPLASH_HOT = () => path.join(UPD_DIR(), 'splash.html'), SPLASH_IMG_HOT = () => path.join(UPD_DIR(), 'splash.jpg'), SPLASH_META = () => path.join(UPD_DIR(), 'splash.json');
const readSplashVer = f => { try { const m = fs.readFileSync(f, 'utf8').match(/SPLASH_VERSION[=:]\s*([\d.]+)/); return m ? m[1] : '0' } catch (e) { return '0' } };
const readMeta = () => { try { return JSON.parse(fs.readFileSync(SPLASH_META(), 'utf8')) } catch (e) { return {} } };
const SPLASH_MIN_MS = 1500;                                // lama minimal splash tampil

const cmp = (a, b) => { const x = String(a).split('.').map(n => parseInt(n) || 0), y = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1 } return 0 };
const readVer = f => { try { const m = fs.readFileSync(f, 'utf8').match(/const APP_VERSION='([\d.]+)'/); return m ? m[1] : '0' } catch (e) { return '0' } };

// pakai file hasil update hanya jika versinya lebih tinggi dari index bawaan (mis. setelah exe baru di-install, yang lama otomatis diabaikan)
function pickIndex() {
  const u = UPDATED();
  if (fs.existsSync(u) && cmp(readVer(u), readVer(BUNDLED)) > 0) return u;
  return BUNDLED;
}

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//i.test(url)) return reject(new Error('Alamat harus https'));
    https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, redirects - 1)) }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > MAX_BYTES) { res.destroy(); reject(new Error('File terlalu besar')) } else chunks.push(c) });
      res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject);
  });
}

let win, splash;
// pilih splash: hasil pembaruan (jika versinya lebih baru dari bawaan) atau bawaan
function splashSource() {
  const m = readMeta(), hot = m.version && cmp(m.version, readSplashVer(SPLASH_FILE)) > 0;
  const html = hot && m.html && fs.existsSync(SPLASH_HOT()) ? SPLASH_HOT() : SPLASH_FILE;
  const img = hot && m.img && fs.existsSync(SPLASH_IMG_HOT()) ? SPLASH_IMG_HOT() : null;
  return { html, img };
}
function createSplash() {
  const src = splashSource();
  if (!fs.existsSync(src.html)) return null;
  const sp = new BrowserWindow({ width: 520, height: 320, frame: false, transparent: true, resizable: false, alwaysOnTop: true, center: true, show: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  sp.once('ready-to-show', () => sp.show());
  // splash hasil unduhan ada di folder lain, jadi gambarnya dikirim lewat ?img=
  const imgPath = src.img || (src.html !== SPLASH_FILE ? SPLASH_IMG : null);
  if (imgPath) sp.loadFile(src.html, { query: { img: require('url').pathToFileURL(imgPath).href } });
  else sp.loadFile(src.html);
  return sp;
}
function createWindow() {
  const t0 = Date.now();
  splash = createSplash();
  win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#1e1e1e', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(pickIndex());
  // tampilkan jendela utama setelah siap, dan tutup splash setelah minimal SPLASH_MIN_MS
  win.once('ready-to-show', () => {
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - t0));
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {            // tampilkan status "siap" di splash dulu, baru tutup
        splash.webContents.executeJavaScript("window.setStatus&&window.setStatus('Siap digunakan','ok')").catch(() => {});
        win.show();
        setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); splash = null }, 700);
      } else win.show();
    }, wait);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' } });
}

// renderer meminta pembaruan: unduh index.html baru, cek SHA-256 + versi, simpan, lalu muat ulang
ipcMain.handle('apply-update', async (_e, info) => {
  try {
    if (!info || !info.htmlUrl || !info.sha256 || !info.version) throw new Error('Info pembaruan tidak lengkap (butuh htmlUrl, sha256, version)');
    const buf = await download(info.htmlUrl);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha.toLowerCase() !== String(info.sha256).toLowerCase()) throw new Error('Checksum tidak cocok – file dibatalkan');
    const m = buf.toString('utf8').match(/const APP_VERSION='([\d.]+)'/);
    if (!m || m[1] !== String(info.version)) throw new Error('Versi di dalam file tidak sama dengan version.json');
    const dir = path.dirname(UPDATED()); fs.mkdirSync(dir, { recursive: true });
    const tmp = UPDATED() + '.tmp'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, UPDATED());
    win.loadFile(UPDATED());
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) } }
});

// pembaruan tampilan splash (splash.html dan/atau gambar), aktif pada pembukaan aplikasi berikutnya
async function fetchVerified(url, sha) {
  if (!url || !sha) throw new Error('Info splash tidak lengkap (butuh url dan sha256)');
  const buf = await download(url);
  if (crypto.createHash('sha256').update(buf).digest('hex').toLowerCase() !== String(sha).toLowerCase()) throw new Error('Checksum splash tidak cocok');
  return buf;
}
const writeAtomic = (f, buf) => { const t = f + '.tmp'; fs.writeFileSync(t, buf); fs.renameSync(t, f) };
ipcMain.handle('update-splash', async (_e, sp) => {
  try {
    if (!sp || !sp.version) return { ok: true, updated: false };
    const prev = readMeta(), bundled = readSplashVer(SPLASH_FILE), have = prev.version && cmp(prev.version, bundled) > 0 ? prev.version : bundled;
    if (cmp(sp.version, have) <= 0) return { ok: true, updated: false };
    fs.mkdirSync(UPD_DIR(), { recursive: true });
    const meta = { version: String(sp.version), html: !!(prev.html && fs.existsSync(SPLASH_HOT())), img: !!(prev.img && fs.existsSync(SPLASH_IMG_HOT())) };
    if (sp.htmlUrl) { const b = await fetchVerified(sp.htmlUrl, sp.htmlSha256); if (!/SPLASH_VERSION/.test(b.toString('utf8'))) throw new Error('splash.html tidak punya penanda SPLASH_VERSION'); writeAtomic(SPLASH_HOT(), b); meta.html = true }
    if (sp.imgUrl) { writeAtomic(SPLASH_IMG_HOT(), await fetchVerified(sp.imgUrl, sp.imgSha256)); meta.img = true }
    fs.writeFileSync(SPLASH_META(), JSON.stringify(meta));   // ditulis terakhir: tanda pembaruan sudah lengkap
    return { ok: true, updated: true };
  } catch (err) { return { ok: false, error: String(err.message || err) } }
});

/* ===== Pembaruan exe otomatis (electron-updater + GitHub Releases) ===== */
function setupAutoUpdate() {
  if (!app.isPackaged) return;                       // hanya di aplikasi hasil build
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')) } catch (e) { return }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', info => {
    const r = dialog.showMessageBoxSync(win, { type: 'info', buttons: ['Restart & pasang', 'Nanti'], defaultId: 0, cancelId: 1,
      title: 'Pembaruan aplikasi', message: 'Versi ' + info.version + ' sudah diunduh.', detail: 'Restart sekarang untuk memasang? Simpan pekerjaan Anda dulu.' });
    if (r === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', () => {});                 // diam saja jika offline / gagal
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000); setInterval(check, 6 * 3600 * 1000);
}

app.whenReady().then(() => { createWindow(); setupAutoUpdate(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() }) });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() });
