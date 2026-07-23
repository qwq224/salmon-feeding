// ================================================================
// db.js — JSON 文件存储 (无需编译，即装即用)
// ================================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// 确保目录和文件存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(RECORDS_FILE)) fs.writeFileSync(RECORDS_FILE, '[]');
if (!fs.existsSync(PLANS_FILE)) fs.writeFileSync(PLANS_FILE, '[]');
if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, '[]');

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf-8')); }
  catch { return []; }
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// 预置示例数据
const records = readJSON(RECORDS_FILE);
if (records.length === 0) {
  const today = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    records.push({
      id: Date.now() + i,
      date: d.toISOString().split('T')[0],
      feed_kg: Math.round((40 + Math.random() * 20) * 10) / 10,
      feeding_rate: Math.round(80 + Math.random() * 20),
      fish_weight_g: Math.round(120 + i * 2.2 + Math.random() * 5),
      water_temp: Math.round((13 + Math.random() * 4) * 10) / 10,
      do_level: Math.round((7.5 + Math.random() * 3) * 10) / 10,
      note: i === 0 ? '今日记录' : '',
    });
  }
  writeJSON(RECORDS_FILE, records);
}

module.exports = {
  // Records
  getRecords: () => readJSON(RECORDS_FILE),
  addRecord: (r) => {
    const records = readJSON(RECORDS_FILE);
    const entry = { id: Date.now(), ...r };
    records.unshift(entry);
    writeJSON(RECORDS_FILE, records);
    return entry;
  },
  deleteRecord: (id) => {
    let records = readJSON(RECORDS_FILE);
    records = records.filter(r => r.id !== Number(id));
    writeJSON(RECORDS_FILE, records);
  },

  // Plans
  savePlan: (p) => {
    const plans = readJSON(PLANS_FILE);
    const entry = { id: Date.now(), ...p, created_at: new Date().toISOString() };
    plans.unshift(entry);
    writeJSON(PLANS_FILE, plans);
    return entry;
  },
  getPlans: () => readJSON(PLANS_FILE).slice(0, 20),

  // Logs
  logQuery: (q, r, s) => {
    const logs = readJSON(LOGS_FILE);
    logs.unshift({ id: Date.now(), query: q, response: r, sources: s, created_at: new Date().toISOString() });
    writeJSON(LOGS_FILE, logs.slice(0, 50));
  },
  getLogs: () => readJSON(LOGS_FILE),
};
