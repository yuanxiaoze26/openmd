const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件路径
const dbPath = path.join(process.cwd(), 'openmd.db');
let db;

// 初始化数据库
function initDatabase() {
  return new Promise((resolve, reject) => {
    console.log('🗄️  Initializing SQLite database...');
    console.log(`📁 Database path: ${dbPath}`);
    
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        reject(err);
      } else {
        console.log('✅ SQLite database connected');
        createTables()
          .then(() => {
            console.log('✅ Database initialized successfully');
            resolve(db);
          })
          .catch(reject);
      }
    });

    // 优化数据库性能
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
    db.run('PRAGMA cache_size = -2000');
    db.run('PRAGMA temp_store = MEMORY');
  });
}

// 创建表
function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 用户表
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 笔记表
      db.run(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 分享链接表
      db.run(`
        CREATE TABLE IF NOT EXISTS shares (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id INTEGER NOT NULL,
          share_code TEXT UNIQUE NOT NULL,
          password TEXT,
          expires_at DATETIME,
          views INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// 获取数据库实例
function getDb() {
  return db;
}

// 健康检查
async function healthCheck() {
  return new Promise((resolve) => {
    db.get('SELECT 1 as status', [], (err) => {
      if (err) {
        resolve({
          status: 'unhealthy',
          error: err.message,
          database: 'sqlite',
          path: dbPath
        });
      } else {
        resolve({
          status: 'healthy',
          database: 'sqlite',
          path: dbPath
        });
      }
    });
  });
}

module.exports = {
  initDatabase,
  getDb,
  healthCheck
};
