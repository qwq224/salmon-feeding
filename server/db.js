// ================================================================
// db.js — SQLite 数据库模块
// ================================================================
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'feeding.db');
const db = new Database(dbPath);

// 初始化表
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    feed_kg REAL NOT NULL,
    feeding_rate REAL,
    fish_weight_g REAL,
    water_temp REAL,
    do_level REAL,
    ph REAL,
    ammonia REAL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feeding_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    avg_weight_g REAL NOT NULL,
    fish_count INTEGER NOT NULL,
    water_temp REAL NOT NULL,
    do_level REAL NOT NULL,
    calculated_rate REAL NOT NULL,
    daily_feed_kg REAL NOT NULL,
    meals_per_day INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knowledge_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    sources TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 预置示例数据
const count = db.prepare('SELECT COUNT(*) as cnt FROM records').get();
if (count.cnt === 0) {
  const insert = db.prepare('INSERT INTO records (date, feed_kg, feeding_rate, fish_weight_g, water_temp, do_level, note) VALUES (?,?,?,?,?,?,?)');
  const today = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    insert.run(
      d.toISOString().split('T')[0],
      Math.round((40 + Math.random() * 20) * 10) / 10,
      Math.round(80 + Math.random() * 20),
      Math.round(120 + i * 2.2 + Math.random() * 5),
      Math.round((13 + Math.random() * 4) * 10) / 10,
      Math.round((7.5 + Math.random() * 3) * 10) / 10,
      i === 0 ? '今日记录' : ''
    );
  }
}

module.exports = {
  db,

  // Records CRUD
  getRecords: () => db.prepare('SELECT * FROM records ORDER BY date DESC').all(),
  addRecord: (r) => db.prepare('INSERT INTO records (date,feed_kg,feeding_rate,fish_weight_g,water_temp,do_level,note) VALUES (?,?,?,?,?,?,?)').run(r.date, r.feed_kg, r.feeding_rate, r.fish_weight_g, r.water_temp, r.do_level, r.note || ''),
  deleteRecord: (id) => db.prepare('DELETE FROM records WHERE id=?').run(id),

  // Plans
  savePlan: (p) => db.prepare('INSERT INTO feeding_plans (avg_weight_g,fish_count,water_temp,do_level,calculated_rate,daily_feed_kg,meals_per_day) VALUES (?,?,?,?,?,?,?)').run(p.avg_weight_g, p.fish_count, p.water_temp, p.do_level, p.calculated_rate, p.daily_feed_kg, p.meals_per_day),
  getPlans: () => db.prepare('SELECT * FROM feeding_plans ORDER BY created_at DESC LIMIT 20').all(),

  // Knowledge logs
  logQuery: (q, r, s) => db.prepare('INSERT INTO knowledge_logs (query,response,sources) VALUES (?,?,?)').run(q, r, s),
  getLogs: () => db.prepare('SELECT * FROM knowledge_logs ORDER BY created_at DESC LIMIT 50').all(),
};
