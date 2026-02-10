const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件路径（Vercel Serverless 使用 /tmp）
const dbPath = path.join('/tmp', 'openmd.db');
let db = null;
let isInitialized = false;

// 初始化数据库
function initDatabase() {
  return new Promise((resolve, reject) => {
    if (isInitialized && db) {
      console.log('✅ Database already initialized, reusing connection');
      resolve(db);
      return;
    }

    console.log('🗄️  Initializing SQLite database...');
    console.log(`📁 Database path: ${dbPath}`);
    console.log(`🌐 Environment: ${process.env.VERCEL ? 'Vercel Serverless' : 'Local'}`);

    // 简化的数据库连接
    const newDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database connection error:', err.message);
        console.error('Error code:', err.code);
        reject(err);
        return;
      }

      console.log('✅ SQLite database connected');

      // 简化的表创建（同步，更可靠）
      newDb.serialize(() => {
        // 用户表
        newDb.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
          )
        `, (err) => {
          if (err) {
            console.error('❌ Error creating users table:', err.message);
          }
        });

        // 笔记表
        newDb.run(`
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
          if (err) {
            console.error('❌ Error creating notes table:', err.message);
          }
        });

        // 分享链接表
        newDb.run(`
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
          if (err) {
            console.error('❌ Error creating shares table:', err.message);
          }
        });

        console.log('✅ All tables created successfully');
        isInitialized = true;
        db = newDb;

        // 关闭当前连接，释放内存
        newDb.close((err) => {
          if (err) {
            console.error('⚠️  Warning closing database:', err.message);
          }
          console.log('🔄 Database closed for cleanup');
        });
      });

      // 优化（只在本地环境）
      if (!process.env.VERCEL) {
        newDb.run('PRAGMA journal_mode = WAL');
        newDb.run('PRAGMA synchronous = NORMAL');
      }
    });
  });
}

// 获取数据库实例
function getDb() {
  if (!db) {
    console.error('❌ Database not initialized');
    throw new Error('Database not initialized. Please call initDatabase() first.');
  }
  
  // 每次返回新的连接（更安全）
  return new sqlite3.Database(dbPath);
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

    const testDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        resolve({
          status: 'unhealthy',
          error: err.message,
          database: 'sqlite',
          path: dbPath
        });
        return;
      }

      testDb.get('SELECT 1 as status', [], (err) => {
        testDb.close();
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
  });
}

module.exports = {
  initDatabase,
  getDb,
  healthCheck
};
