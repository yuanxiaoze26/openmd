const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件路径（Vercel Serverless 使用 /tmp）
const dbPath = path.join('/tmp', 'openmd.db');
let db;

// 初始化数据库
function initDatabase() {
  return new Promise((resolve, reject) => {
    console.log('🗄️  Initializing SQLite database...');
    console.log(`📁 Database path: ${dbPath}`);
    console.log(`🌐 Environment: ${process.env.VERCEL ? 'Vercel Serverless' : 'Local'}`);
    
    // Vercel Serverless 的特殊处理
    if (process.env.VERCEL) {
      console.log('⚠️  Running in Vercel Serverless mode');
      console.log('⚠️  Database will be reset on each deployment');
    }
    
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        reject(err);
      } else {
        console.log('✅ SQLite database connected');
        
        // 异步创建表，避免阻塞
        createTablesAsync()
          .then(() => {
            console.log('✅ Database initialized successfully');
            resolve(db);
          })
          .catch(reject);
      }
    });

    // 优化数据库性能（只在本地环境）
    if (!process.env.VERCEL) {
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      db.run('PRAGMA cache_size = -2000');
      db.run('PRAGMA temp_store = MEMORY');
    }
  });
}

// 异步创建表
function createTablesAsync() {
  return new Promise((resolve, reject) => {
    const tables = [
      {
        name: 'users',
        sql: `
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
          )
        `
      },
      {
        name: 'notes',
        sql: `
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
        `
      },
      {
        name: 'shares',
        sql: `
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
        `
      }
    ];

    // 顺序创建表
    tables.reduce((promise, table) => {
      return promise.then(() => {
        return new Promise((resolve, reject) => {
          db.run(table.sql, (err) => {
            if (err) {
              console.error(`❌ Error creating ${table.name} table:`, err);
              reject(err);
            } else {
              console.log(`✅ Table ${table.name} created/exists`);
              resolve();
            }
          });
        });
      });
    }, Promise.resolve())
    .then(() => {
      console.log('✅ All tables created successfully');
      resolve();
    })
    .catch(reject);
  });
}

// 获取数据库实例
function getDb() {
  return db;
}

// 健康检查
async function healthCheck() {
  return new Promise((resolve) => {
    if (!db) {
      resolve({
        status: 'unhealthy',
        error: 'Database not initialized',
        database: 'sqlite',
        path: dbPath
      });
      return;
    }
    
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
