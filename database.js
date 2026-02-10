require('dotenv').config();

const mysql = require('mysql2/promise');
const path = require('path');

// 数据库配置
const DB_TYPE = process.env.DB_TYPE || 'mysql';
const DB_HOST = process.env.DB_HOST;
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;

// 连接池（Vercel Serverless 优化）
let cachedPool = null;

// 创建连接池
function createPool() {
  return mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    
    // Vercel Serverless 优化配置
    connectionLimit: 2,           // Serverless 环境限制连接数
    queueLimit: 0,                  // 不排队，快速失败
    enableKeepAlive: true,         // 保持连接
    keepAliveInitialDelay: 0,      // 立即发送 keepalive
    maxIdle: 2,                    // 最多保持 2 个空闲连接
    idleTimeout: 60000,             // 60 秒空闲超时
    acquireTimeout: 10000,           // 10 秒获取连接超时
    multipleStatements: false,       // 禁用多语句（更安全）
    ssl: false,                      // 阿里云内网可能不需要 SSL
    
    // 连接超时配置
    connectTimeout: 10000,
    timeout: 60000
  });
}

// 获取连接池（带缓存）
function getPool() {
  if (!cachedPool) {
    console.log('🔧 Creating MySQL connection pool...');
    cachedPool = createPool();
    
    // 监听连接错误
    cachedPool.on('error', (err) => {
      console.error('❌ MySQL pool error:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('🔄 Pool destroyed, will recreate on next request');
        cachedPool = null;
      }
    });
    
    console.log('✅ MySQL connection pool created');
  }
  
  return cachedPool;
}

// 带超时的连接获取
async function getConnectionWithTimeout(pool, timeout = 5000) {
  return Promise.race([
    pool.getConnection(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    )
  ]);
}

// 执行查询（带重试）
async function executeQuery(query, params = []) {
  const pool = getPool();
  let connection;
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    try {
      connection = await getConnectionWithTimeout(pool, 5000);
      const [rows] = await connection.query(query, params);
      connection.release();
      return rows;
    } catch (error) {
      if (connection) {
        try {
          connection.release();
        } catch (e) {
          // 忽略释放错误
        }
      }
      
      // 如果是连接错误，重试
      if (
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.message.includes('Connection timeout') ||
        error.message.includes('connect ETIMEDOUT')
      ) {
        retries++;
        if (retries < maxRetries) {
          console.log(`⚠️  Query failed, retrying... (${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          continue;
        }
      }
      
      throw error;
    }
  }
}

// 执行插入/更新操作（带重试）
async function executeUpdate(query, params = []) {
  const pool = getPool();
  let connection;
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    try {
      connection = await getConnectionWithTimeout(pool, 5000);
      const result = await connection.query(query, params);
      connection.release();
      return result;
    } catch (error) {
      if (connection) {
        try {
          connection.release();
        } catch (e) {
          // 忽略释放错误
        }
      }
      
      // 如果是连接错误，重试
      if (
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.message.includes('Connection timeout') ||
        error.message.includes('connect ETIMEDOUT')
      ) {
        retries++;
        if (retries < maxRetries) {
          console.log(`⚠️  Update failed, retrying... (${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          continue;
        }
      }
      
      throw error;
    }
  }
}

// 健康检查
async function healthCheck() {
  const pool = getPool();
  
  try {
    const connection = await getConnectionWithTimeout(pool, 3000);
    await connection.ping();
    connection.release();
    
    const stats = await pool.promisePool.pool._allConnections;
    
    return {
      status: 'healthy',
      host: DB_HOST,
      database: DB_NAME,
      connections: {
        total: stats.total,
        active: stats.active,
        idle: stats.idle
      },
      cached: !!cachedPool
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      host: DB_HOST,
      database: DB_NAME
    };
  }
}

// 初始化数据库
function initDatabase() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Initializing MySQL database...');
    console.log(`📡 Host: ${DB_HOST}`);
    console.log(`🗄️  Database: ${DB_NAME}`);
    console.log(`👤 User: ${DB_USER}`);
    console.log(`🔌 Port: ${DB_PORT}`);
    
    // 预热连接池
    getPool();
    
    // 创建表
    createTables()
      .then(() => {
        console.log('✅ Database initialized successfully');
        resolve(getPool());
      })
      .catch(reject);
  });
}

// 创建表
async function createTables() {
  try {
    console.log('📋 Creating tables...');
    
    // 用户表
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    // 笔记表
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at),
        INDEX idx_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    // 分享链接表
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS shares (
        id INT AUTO_INCREMENT PRIMARY KEY,
        note_id INT NOT NULL,
        share_code VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        expires_at TIMESTAMP NULL,
        views INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        INDEX idx_share_code (share_code),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    console.log('✅ Tables created successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
}

// 关闭连接池（优雅关闭）
async function closePool() {
  if (cachedPool) {
    console.log('🔄 Closing connection pool...');
    try {
      await cachedPool.end();
      cachedPool = null;
      console.log('✅ Connection pool closed');
    } catch (error) {
      console.error('❌ Error closing pool:', error);
    }
  }
}

// 获取数据库连接（用于直接操作）
function getDb() {
  return getPool();
}

module.exports = {
  initDatabase,
  getDb,
  executeQuery,
  executeUpdate,
  healthCheck,
  closePool
};
