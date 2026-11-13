/* Pakai:  node tools/make-release.js https://raw.githubusercontent.com/USER/REPO/main
   Membuat version.json (versi + SHA-256 + alamat index.html) dari index.html di folder proyek. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('Beri alamat dasar tempat index.html di-upload, mis: node tools/make-release.js https://raw.githubusercontent.com/USER/REPO/main'); process.exit(1) }
const file = path.join(__dirname, '..', 'index.html'), buf = fs.readFileSync(file);
const m = buf.toString('utf8').match(/const APP_VERSION='([\d.]+)'/);
if (!m) { console.error('APP_VERSION tidak ditemukan di index.html'); process.exit(1) }
const out = { version: m[1], htmlUrl: base + '/index.html', sha256: crypto.createHash('sha256').update(buf).digest('hex'), notes: ['Tulis catatan perubahan di sini'] };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const spHtml = path.join(__dirname, '..', 'splash.html'), spImg = path.join(__dirname, '..', 'assets', 'splash.jpg');
if (fs.existsSync(spHtml)) {
  const sv = fs.readFileSync(spHtml, 'utf8').match(/SPLASH_VERSION[=:]\s*([\d.]+)/);
  if (sv) { out.splash = { version: sv[1], htmlUrl: base + '/splash.html', htmlSha256: sha(spHtml) };
    if (fs.existsSync(spImg)) { out.splash.imgUrl = base + '/assets/splash.jpg'; out.splash.imgSha256 = sha(spImg) } }
}
fs.writeFileSync(path.join(__dirname, '..', 'version.json'), JSON.stringify(out, null, 2));
console.log('version.json dibuat:', out);
