// Log shipper: tail LOG_FILE, potong jadi file BATCH tetap di BATCH_DIR.
// Tiap batch = 1 file yang tidak diubah lagi, dengan logId sendiri.
// Backend (merkleCollector.js) lalu `record` file itu ke blockchain dan
// `watch` untuk mendeteksi perubahan.
const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || '/var/log/auth.log';
const BATCH_DIR = process.env.BATCH_DIR || '/siem-batches';
const BATCH_SIZE = +process.env.BATCH_SIZE || 20;
const FLUSH_MS = +process.env.FLUSH_INTERVAL_MS || 30000;
const HOST = process.env.HOSTNAME || 'victim-server';
const INDEX = path.join(BATCH_DIR, 'index.ndjson');

let offset = 0, buffer = [], partial = '', seq = 0;

function flush() {
  if (!buffer.length) return;
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, ''); // 20261107T120247
  // Batch lama tidak boleh tertimpa: `seq` reset ke 0 setiap container restart,
  // dan timestamp hanya sampai detik. Kalau nama sudah dipakai, naikkan seq.
  let name = `auth-${ts}-${String(seq++).padStart(3, '0')}`;
  let guard = 0;
  while (fs.existsSync(path.join(BATCH_DIR, name + '.log')) && guard++ < 10000) {
    name = `auth-${ts}-${String(seq++).padStart(3, '0')}`;
  }
  const file = path.join(BATCH_DIR, name + '.log');
  const tmp = file + '.tmp';
  // tulis ke .tmp lalu rename: backend tidak pernah melihat file setengah jadi
  fs.writeFileSync(tmp, buffer.join('\n') + '\n');
  fs.renameSync(tmp, file);
  const logId = `${HOST}/${name}`;
  fs.appendFileSync(INDEX, JSON.stringify({ logId, file: name + '.log', lines: buffer.length, createdAt: new Date().toISOString() }) + '\n');
  console.log(`[shipper] batch ${name}.log (${buffer.length} baris) logId="${logId}"`);
  buffer = [];
}

function poll() {
  if (!fs.existsSync(LOG_FILE)) return;
  const size = fs.statSync(LOG_FILE).size;
  if (size < offset) {   // file mengecil = indikasi log wiping / truncate
    console.warn('[shipper] ALERT: log file mengecil, kemungkinan tampering');
    buffer.push(`[SHIPPER-ALERT] ${LOG_FILE} truncated (${offset} -> ${size})`);
    offset = 0; partial = '';
    flush();
  }
  if (size === offset) return;
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd);
  offset = size;
  const parts = (partial + buf.toString('utf8')).split('\n');
  partial = parts.pop();
  buffer.push(...parts.filter(Boolean));
  if (buffer.length >= BATCH_SIZE) flush();
}

fs.mkdirSync(BATCH_DIR, { recursive: true });
// Mulai dari akhir file agar tidak membuat batch ulang dari log lama saat restart.
// Konsekuensi: baris yang ditulis SEBELUM shipper sempat jalan (beberapa ratus ms
// saat boot) tidak akan pernah dikirim — dicetak ke log supaya transparan.
if (fs.existsSync(LOG_FILE)) {
  offset = fs.statSync(LOG_FILE).size;
  if (offset > 0) console.log(`[shipper] lewati ${offset} byte log lama, mulai dari offset akhir`);
}
console.log(`[shipper] start: ${LOG_FILE} -> ${BATCH_DIR} (batch=${BATCH_SIZE} baris atau ${FLUSH_MS}ms)`);
setInterval(poll, 1000);
setInterval(flush, FLUSH_MS);
