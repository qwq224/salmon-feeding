// ================================================================
// db.js v2 — SQLite 持久化 (Node 24 内置 node:sqlite)
// ================================================================
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'salmon.db');
const db = new DatabaseSync(DB_PATH);

// ---- 建表 ----
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    feed_kg REAL NOT NULL DEFAULT 0,
    feeding_rate REAL NOT NULL DEFAULT 0,
    fish_weight_g REAL NOT NULL DEFAULT 0,
    water_temp REAL NOT NULL DEFAULT 0,
    do_level REAL NOT NULL DEFAULT 0,
    note TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT '',
    params TEXT DEFAULT '{}',
    result TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    query TEXT NOT NULL DEFAULT '',
    response TEXT NOT NULL DEFAULT '',
    sources TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  );
`);

// ---- 数据迁移: JSON → SQLite (首次运行) ----
function _migrateJSON(file, table, columns) {
  const jsonPath = path.join(DATA_DIR, file);
  if (!fs.existsSync(jsonPath)) return 0;

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  if (!Array.isArray(data) || data.length === 0) return 0;

  // 已迁移过则跳过
  if (data.length > 0) {
    const placeholders = columns.map(() => '?').join(',');
    const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`);
    for (const r of data) {
      const vals = columns.map(c => {
        const v = r[c];
        if (typeof v === 'object') return JSON.stringify(v);
        return v ?? '';
      });
      insert.run(...vals);
    }
  }

  // 迁移后重命名原文件
  fs.renameSync(jsonPath, jsonPath.replace('.json', '.json.bak'));
  return data.length;
}

const migratedRecords = _migrateJSON('records.json', 'records',
  ['id','date','feed_kg','feeding_rate','fish_weight_g','water_temp','do_level','note']);
const migratedPlans = _migrateJSON('plans.json', 'plans',
  ['id','created_at','params','result']);
const migratedLogs = _migrateJSON('logs.json', 'logs',
  ['id','query','response','sources','created_at']);
if (migratedRecords || migratedPlans || migratedLogs) {
  console.log(`📦 JSON → SQLite 迁移: records ${migratedRecords}, plans ${migratedPlans}, logs ${migratedLogs}`);
}

// ---- 预置示例数据 ----
const count = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
if (count === 0) {
  const today = new Date();
  const insert = db.prepare(
    'INSERT INTO records (id, date, feed_kg, feeding_rate, fish_weight_g, water_temp, do_level, note) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    insert.run(
      Date.now() + i,
      d.toISOString().split('T')[0],
      Math.round((40 + Math.random() * 20) * 10) / 10,
      Math.round(80 + Math.random() * 20),
      Math.round(120 + i * 2.2 + Math.random() * 5),
      Math.round((13 + Math.random() * 4) * 10) / 10,
      Math.round((7.5 + Math.random() * 3) * 10) / 10,
      i === 0 ? '今日记录' : ''
    );
  }
  console.log('📊 已生成示例投喂记录 (15条)');
}

// ---- Records CRUD ----
const stmt = {
  getRecords: db.prepare('SELECT * FROM records ORDER BY date DESC, id DESC'),
  getRecordById: db.prepare('SELECT * FROM records WHERE id = ?'),
  insertRecord: db.prepare(
    'INSERT INTO records (id, date, feed_kg, feeding_rate, fish_weight_g, water_temp, do_level, note) VALUES (?,?,?,?,?,?,?,?)'
  ),
  deleteRecord: db.prepare('DELETE FROM records WHERE id = ?'),
  getPlans: db.prepare('SELECT * FROM plans ORDER BY id DESC LIMIT 20'),
  insertPlan: db.prepare(
    'INSERT INTO plans (id, created_at, params, result) VALUES (?,?,?,?)'
  ),
  insertLog: db.prepare(
    'INSERT INTO logs (id, query, response, sources, created_at) VALUES (?,?,?,?,?)'
  ),
  getLogs: db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 50'),
};

module.exports = {
  getRecords: () => stmt.getRecords.all(),
  addRecord: (r) => {
    const id = r.id || Date.now();
    stmt.insertRecord.run(
      id,
      r.date || new Date().toISOString().split('T')[0],
      r.feed_kg ?? r.feed ?? 0,
      r.feeding_rate ?? r.rate ?? 0,
      r.fish_weight_g ?? r.weight ?? 0,
      r.water_temp ?? r.temp ?? 0,
      r.do_level ?? r.doLevel ?? 0,
      r.note || ''
    );
    return { id, ...r };
  },
  deleteRecord: (id) => {
    stmt.deleteRecord.run(Number(id));
  },

  savePlan: (p) => {
    const id = Date.now();
    stmt.insertPlan.run(
      id,
      new Date().toISOString(),
      JSON.stringify(p.params || {}),
      JSON.stringify(p.result || p)
    );
    return { id, ...p };
  },
  getPlans: () => stmt.getPlans.all().map(p => ({
    ...p,
    params: JSON.parse(p.params || '{}'),
    result: JSON.parse(p.result || '{}'),
  })),

  logQuery: (q, r, s) => {
    stmt.insertLog.run(Date.now(), q, r, s, new Date().toISOString());
  },
  getLogs: () => stmt.getLogs.all(),
};
