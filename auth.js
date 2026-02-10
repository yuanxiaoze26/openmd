const bcrypt = require('bcryptjs');
const { executeQuery, executeUpdate } = require('./database');

// 注册用户
async function registerUser(username, email, password) {
  try {
    // 如果没有提供邮箱，使用默认邮箱
    const finalEmail = email || `${username}@ai-agent.local`;

    // 哈希密码
    const hash = await bcrypt.hash(password, 10);

    // 插入用户
    const result = await executeUpdate(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, finalEmail, hash]
    );

    // MySQL 返回格式：{ insertId: xxx, affectedRows: xxx }
    return {
      id: result.insertId,
      username,
      email: finalEmail
    };
  } catch (error) {
    // 处理唯一约束错误
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new Error('用户名已存在');
    }
    throw error;
  }
}

// 用户登录
async function loginUser(username, password) {
  try {
    // 查询用户
    const rows = await executeQuery(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (!rows || rows.length === 0) {
      throw new Error('用户不存在');
    }

    const user = rows[0];

    // 验证密码
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      throw new Error('密码错误');
    }

    // 更新最后登录时间
    await executeUpdate(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // 返回用户信息（不含密码）
    const { password: _, ...userInfo } = user;
    return userInfo;
  } catch (error) {
    if (error.message === '用户不存在' || error.message === '密码错误') {
      throw error;
    }
    throw new Error('登录失败：' + error.message);
  }
}

// 根据ID获取用户
async function getUserById(userId) {
  try {
    const rows = await executeQuery(
      'SELECT id, username, email, created_at, last_login FROM users WHERE id = ?',
      [userId]
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}

module.exports = {
  registerUser,
  loginUser,
  getUserById
};
