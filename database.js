const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库配置
// 修复环境变量中的换行符问题
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').trim();
const dbPath = path.join(process.env.VERCEL ? '/tmp' : '.', 'openmd.db');

// MySQL 连接池
let mysqlPool = null;
let sqliteDb = null;
let isInitialized = false;

// MySQL 配置
const mysqlConfig = {
  host: (process.env.DB_HOST || 'localhost').trim(),
  port: parseInt((process.env.DB_PORT || '3306').trim()),
  user: (process.env.DB_USER || 'root').trim(),
  password: (process.env.DB_PASSWORD || '').trim(),
  database: (process.env.DB_NAME || 'openmd').trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// 初始化数据库
async function initDatabase() {
  if (isInitialized) {
    console.log('✅ Database already initialized');
    return;
  }

  console.log(`🗄️  Initializing ${DB_TYPE.toUpperCase()} database...`);
  console.log(`🌐 Environment: ${process.env.VERCEL ? 'Vercel Serverless' : 'Local'}`);

  if (DB_TYPE === 'mysql') {
    try {
      mysqlPool = mysql.createPool(mysqlConfig);
      console.log(`✅ MySQL pool created: ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

      // 创建表
      await createMySqlTables();
      isInitialized = true;
      console.log('✅ Database initialized successfully');
    } catch (err) {
      console.error('❌ MySQL initialization error:', err.message);
      throw err;
    }
  } else {
    // SQLite
    return new Promise((resolve, reject) => {
      const newDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('❌ SQLite connection error:', err.message);
          reject(err);
          return;
        }

        console.log('✅ SQLite database connected');

        newDb.serialize(() => {
          createSqliteTables(newDb);
          isInitialized = true;
          sqliteDb = newDb;
          console.log('✅ Database initialized successfully');
          resolve();
        });
      });
    });
  }
}

// 创建 MySQL 表
async function createMySqlTables() {
  const connection = await mysqlPool.getConnection();

  try {
    // 用户表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 笔记表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        metadata JSON,
        visibility ENUM('public', 'private', 'password') DEFAULT 'public',
        password VARCHAR(255) NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_updated_at (updated_at),
        INDEX idx_visibility (visibility),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 分享链接表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS shares (
        id INT AUTO_INCREMENT PRIMARY KEY,
        note_id INT NOT NULL,
        share_code VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255),
        expires_at TIMESTAMP NULL,
        views INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        INDEX idx_share_code (share_code),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ All MySQL tables created successfully');
  } finally {
    connection.release();
  }
}

// 创建 SQLite 表
function createSqliteTables(db) {
  // 用户表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `);

  // 笔记表
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      visibility TEXT DEFAULT 'public',
      password TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

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
  `);

  console.log('✅ All SQLite tables created successfully');
}

// 执行查询
async function executeQuery(sql, params = []) {
  if (DB_TYPE === 'mysql') {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
}

// 执行更新/插入/删除
async function executeUpdate(sql, params = []) {
  if (DB_TYPE === 'mysql') {
    const [result] = await mysqlPool.execute(sql, params);
    return {
      insertId: result.insertId,
      affectedRows: result.affectedRows,
      changedRows: result.changedRows
    };
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            insertId: this.lastID,
            affectedRows: this.changes
          });
        }
      });
    });
  }
}

// 获取单条记录
async function executeGet(sql, params = []) {
  if (DB_TYPE === 'mysql') {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
}

// 健康检查
async function healthCheck() {
  if (DB_TYPE === 'mysql') {
    try {
      const [rows] = await mysqlPool.execute('SELECT 1 as status');
      return {
        status: 'healthy',
        database: 'mysql',
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        database: mysqlConfig.database
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        error: err.message,
        database: 'mysql'
      };
    }
  } else {
    return new Promise((resolve) => {
      if (!sqliteDb) {
        resolve({
          status: 'unhealthy',
          error: 'Database not initialized',
          database: 'sqlite',
          path: dbPath
        });
        return;
      }

      sqliteDb.get('SELECT 1 as status', [], (err) => {
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
}

// 关闭数据库连接
async function closeDatabase() {
  if (DB_TYPE === 'mysql' && mysqlPool) {
    await mysqlPool.end();
    console.log('✅ MySQL pool closed');
  } else if (sqliteDb) {
    return new Promise((resolve) => {
      sqliteDb.close((err) => {
        if (err) {
          console.error('⚠️  Warning closing SQLite:', err.message);
        } else {
          console.log('✅ SQLite database closed');
        }
        resolve();
      });
    });
  }
}

module.exports = {
  initDatabase,
  executeQuery,
  executeUpdate,
  executeGet,
  healthCheck,
  closeDatabase,
  getDb: () => DB_TYPE === 'mysql' ? mysqlPool : sqliteDb
};
