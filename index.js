require('dotenv').config();

const express = require('express');
const marked = require('marked');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { initDatabase, getDb, executeQuery, executeUpdate, healthCheck } = require('./database');
const { registerUser, loginUser, getUserById } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据库初始化中间件（每个请求前确保数据库已初始化）
let dbInitialized = false;
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
      console.log('✅ Database initialized for request');
    } catch (err) {
      console.error('❌ Database initialization failed:', err);
      return res.status(500).json({ error: 'Database initialization failed' });
    }
  }
  next();
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' }
}));

// 检查登录状态
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// 生成唯一分享码
function generateShareCode() {
  return Math.random().toString(36).substr(2, 8);
}

// ============ 用户相关 API ============

// 注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少3位' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }

    const user = await registerUser(username, email || null, password);
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || '注册失败' });
  }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await loginUser(username, password);
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || '登录失败' });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 获取当前用户
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// ============ 笔记相关 API ============

// 创建笔记
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, metadata = {} } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const userId = req.session.userId || null;
    const metadataStr = JSON.stringify(metadata);

    const result = await executeUpdate(
      'INSERT INTO notes (user_id, title, content, metadata) VALUES (?, ?, ?, ?)',
      [userId, title || 'Untitled', content, metadataStr]
    );

    res.json({
      id: result.insertId,
      title: title || 'Untitled',
      content,
      metadata,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 获取笔记
app.get('/api/notes/:id', async (req, res) => {
  try {
    const rows = await executeQuery(
      'SELECT * FROM notes WHERE id = ?',
      [req.params.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = rows[0];
    note.metadata = note.metadata ? JSON.parse(note.metadata) : {};

    res.json(note);
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新笔记
app.put('/api/notes/:id', async (req, res) => {
  try {
    const { title, content, metadata } = req.body;

    // 先查询笔记
    const rows = await executeQuery(
      'SELECT * FROM notes WHERE id = ?',
      [req.params.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = rows[0];

    // 检查权限
    if (note.user_id && req.session.userId && req.session.userId !== note.user_id) {
      return res.status(403).json({ error: '无权修改此笔记' });
    }

    // 构建更新
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      values.push(content);
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return res.json({ success: true });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);

    await executeUpdate(
      `UPDATE notes SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 删除笔记
app.delete('/api/notes/:id', async (req, res) => {
  try {
    // 先检查权限
    const rows = await executeQuery(
      'SELECT user_id FROM notes WHERE id = ?',
      [req.params.id]
    );

    if (rows && rows.length > 0 && rows[0].user_id) {
      if (req.session.userId && req.session.userId !== rows[0].user_id) {
        return res.status(403).json({ error: '无权删除此笔记' });
      }
    }

    await executeUpdate(
      'DELETE FROM notes WHERE id = ?',
      [req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 列出所有笔记
app.get('/api/notes', async (req, res) => {
  try {
    const rows = await executeQuery(
      'SELECT * FROM notes ORDER BY updated_at DESC LIMIT 100'
    );

    // 解析 metadata
    const notes = rows.map(note => ({
      ...note,
      metadata: note.metadata ? JSON.parse(note.metadata) : {}
    }));

    res.json(notes);
  } catch (error) {
    console.error('Error listing notes:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 列出所有用户
app.get('/api/users', async (req, res) => {
  try {
    const rows = await executeQuery(
      'SELECT id, username, email, created_at, last_login FROM users ORDER BY created_at DESC'
    );

    res.json(rows);
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============ 分享功能 API ============

// 创建分享链接
app.post('/api/shares', async (req, res) => {
  try {
    const { noteId, password, expiresIn } = req.body;

    if (!noteId) {
      return res.status(400).json({ error: '笔记ID不能为空' });
    }

    // 检查笔记是否存在
    const noteRows = await executeQuery(
      'SELECT id FROM notes WHERE id = ?',
      [noteId]
    );

    if (!noteRows || noteRows.length === 0) {
      return res.status(404).json({ error: '笔记不存在' });
    }

    // 生成分享码
    const shareCode = generateShareCode();

    // 计算过期时间
    let expiresAt = null;
    if (expiresIn) {
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + parseInt(expiresIn));
      expiresAt = expiryDate.toISOString();
    }

    // 哈希密码
    const bcrypt = require('bcryptjs');
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    await executeUpdate(
      'INSERT INTO shares (note_id, share_code, password, expires_at) VALUES (?, ?, ?, ?)',
      [noteId, shareCode, passwordHash, expiresAt]
    );

    const protocol = req.protocol || 'http';
    const host = req.get('host');

    res.json({
      success: true,
      shareCode,
      shareUrl: `${protocol}://${host}/share/${shareCode}`,
      id: noteRows[0].insertId
    });
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 获取分享链接信息
app.get('/api/shares/:code', async (req, res) => {
  try {
    const rows = await executeQuery(
      'SELECT * FROM shares WHERE share_code = ?',
      [req.params.code]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '分享链接不存在' });
    }

    const share = rows[0];

    // 检查是否过期
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: '分享链接已过期' });
    }

    res.json({
      id: share.id,
      shareCode: share.share_code,
      hasPassword: !!share.password,
      expiresAt: share.expires_at,
      views: share.views,
      createdAt: share.created_at
    });
  } catch (error) {
    console.error('Error fetching share:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 解锁分享链接（验证密码）
app.post('/api/shares/:code/unlock', async (req, res) => {
  try {
    const { password } = req.body;
    const bcrypt = require('bcryptjs');

    const rows = await executeQuery(
      'SELECT * FROM shares WHERE share_code = ?',
      [req.params.code]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '分享链接不存在' });
    }

    const share = rows[0];

    // 验证密码
    if (share.password) {
      const isMatch = await bcrypt.compare(password, share.password);
      if (!isMatch) {
        return res.status(401).json({ error: '密码错误' });
      }
    }

    // 标记为已解锁
    if (!req.session.unlockedShares) {
      req.session.unlockedShares = [];
    }
    req.session.unlockedShares.push(share.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error unlocking share:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============ 页面路由 ============

// 后台管理
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 注册页面
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 查看笔记
app.get('/note/:id', async (req, res) => {
  try {
    const rows = await executeQuery(
      'SELECT * FROM notes WHERE id = ?',
      [req.params.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).send('Note not found');
    }

    const note = rows[0];
    const metadata = note.metadata ? JSON.parse(note.metadata) : {};
    const htmlContent = marked.parse(note.content);

    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title} - OpenMD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      margin-bottom: 20px;
      color: #2c3e50;
    }
    .metadata {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 20px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
    }
    .markdown {
      line-height: 1.8;
    }
    .markdown h2 {
      margin-top: 30px;
      margin-bottom: 15px;
      color: #2c3e50;
    }
    .markdown p {
      margin-bottom: 15px;
    }
    .markdown code {
      background: #f0f4f8 !important;
      color: #2c3e50 !important;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    .markdown pre {
      background: #f0f4f8;
      color: #2c3e50;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      margin-bottom: 20px;
      border: 1px solid #e0e6ed;
    }
    .markdown pre code {
      background: transparent !important;
      color: #2c3e50 !important;
      padding: 0;
    }
    .markdown blockquote {
      border-left: 4px solid #3498db;
      padding-left: 15px;
      margin: 20px 0;
      color: #555;
      font-style: italic;
    }
    .markdown ul, .markdown ol {
      margin-bottom: 15px;
      padding-left: 30px;
    }
    .markdown li {
      margin-bottom: 8px;
    }
    .markdown a {
      color: #3498db;
      text-decoration: none;
    }
    .markdown a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #888;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${note.title}</h1>
    <div class="metadata">
      <p>Created: ${new Date(note.created_at).toLocaleString('zh-CN')}</p>
      <p>Last Updated: ${new Date(note.updated_at).toLocaleString('zh-CN')}</p>
      ${Object.entries(metadata || {}).map(([k, v]) => `<p>${k}: ${v}</p>`).join('')}
    </div>
    <div class="markdown">
      ${htmlContent}
    </div>
    <div class="footer">
      <p>🤖 Generated by OpenMD - AI-native note tool</p>
    </div>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error rendering note:', error);
    res.status(500).send('Error rendering note');
  }
});

// 查看分享的笔记
app.get('/share/:code', async (req, res) => {
  try {
    const shareRows = await executeQuery(
      'SELECT * FROM shares WHERE share_code = ?',
      [req.params.code]
    );

    if (!shareRows || shareRows.length === 0) {
      return res.status(404).send('Share not found');
    }

    const share = shareRows[0];

    // 检查是否过期
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).send('Share expired');
    }

    // 如果需要密码，返回密码输入页面
    const bcrypt = require('bcryptjs');
    if (share.password) {
      if (!req.session.unlockedShares || !req.session.unlockedShares.includes(share.id)) {
        return res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>密码保护 - OpenMD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      margin: 0;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 400px;
      width: 100%;
    }
    h1 {
      text-align: center;
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 1.8rem;
    }
    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 0.95rem;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #2c3e50;
      font-size: 0.95rem;
    }
    input {
      width: 100%;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.3s;
      box-sizing: border-box;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      margin-top: 10px;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
    }
    .error {
      background: #fee;
      border: 1px solid #fcc;
      color: #c33;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      text-align: center;
    }
    .success {
      background: #efe;
      border: 1px solid #cfc;
      color: #3c3;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      text-align: center;
    }
    .login-link {
      text-align: center;
      margin-top: 20px;
      color: #666;
      font-size: 0.9rem;
    }
    .login-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }
    .login-link a:hover {
      text-decoration: underline;
    }
    .requirements {
      font-size: 0.85rem;
      color: #999;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📝 密码保护</h1>
    <p class="subtitle">请输入密码查看笔记</p>

    <div id="message"></div>

    <div class="form-group">
      <label>密码</label>
      <input type="password" id="password" placeholder="请输入密码">
    </div>

    <button onclick="unlock()">解锁</button>

    <div class="login-link">
      返回 <a href="/admin">后台</a>
    </div>
  </div>

  <script>
    async function unlock() {
      const password = document.getElementById('password').value;

      if (!password) {
        showMessage('请输入密码', 'error');
        return;
      }

      try {
        const response = await fetch('/api/shares/${location.pathname.split('/').pop()}/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.success) {
          showMessage('解锁成功，正在跳转...', 'success');
          setTimeout(() => {
            location.reload();
          }, 1000);
        } else {
          showMessage(data.error || '解锁失败', 'error');
        }
      } catch (error) {
        console.error('Unlock error:', error);
        showMessage('网络错误，请稍后重试', 'error');
      }
    }

    function showMessage(text, type) {
      const messageDiv = document.getElementById('message');
      const typeAttr = 'type';
      messageDiv.innerHTML = '<div class="' + typeAttr + '">' + text + '</div>';
    }
  </script>
</body>
</html>
        `);
      }
    }

    // 获取笔记内容
    const noteRows = await executeQuery(
      'SELECT * FROM notes WHERE id = ?',
      [share.note_id]
    );

    if (!noteRows || noteRows.length === 0) {
      return res.status(404).send('Note not found');
    }

    const note = noteRows[0];
    const metadata = note.metadata ? JSON.parse(note.metadata) : {};
    const htmlContent = marked.parse(note.content);

    // 增加浏览次数
    await executeUpdate(
      'UPDATE shares SET views = views + 1 WHERE id = ?',
      [share.id]
    );

    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title} - OpenMD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      margin-bottom: 20px;
      color: #2c3e50;
    }
    .share-info {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .share-info p {
      margin: 0;
      font-size: 0.95em;
    }
    .share-info strong {
      font-size: 1.1em;
    }
    .metadata {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 20px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
    }
    .markdown {
      line-height: 1.8;
    }
    .markdown h2 {
      margin-top: 30px;
      margin-bottom: 15px;
      color: #2c3e50;
    }
    .markdown p {
      margin-bottom: 15px;
    }
    .markdown code {
      background: #f0f4f8 !important;
      color: #2c3e50 !important;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    .markdown pre {
      background: #f0f4f8;
      color: #2c3e50;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      margin-bottom: 20px;
      border: 1px solid #e0e6ed;
    }
    .markdown pre code {
      background: transparent !important;
      color: #2c3e50 !important;
      padding: 0;
    }
    .markdown blockquote {
      border-left: 4px solid #3498db;
      padding-left: 15px;
      margin: 20px 0;
      color: #555;
      font-style: italic;
    }
    .markdown ul, .markdown ol {
      margin-bottom: 15px;
      padding-left: 30px;
    }
    .markdown li {
      margin-bottom: 8px;
    }
    .markdown a {
      color: #3498db;
      text-decoration: none;
    }
    .markdown a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #888;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="share-info">
      <p>🔗 通过 OpenMD 分享</p>
      <p><strong>浏览次数：</strong>${share.views}</p>
    </div>

    <h1>${note.title}</h1>
    <div class="metadata">
      <p>Created: ${new Date(note.created_at).toLocaleString('zh-CN')}</p>
      <p>Last Updated: ${new Date(note.updated_at).toLocaleString('zh-CN')}</p>
      ${Object.entries(metadata || {}).map(([k, v]) => `<p>${k}: ${v}</p>`).join('')}
    </div>
    <div class="markdown">
      ${htmlContent}
    </div>
    <div class="footer">
      <p>🤖 Generated by OpenMD - AI-native note tool</p>
    </div>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error rendering share:', error);
    res.status(500).send('Error rendering share');
  }
});

// 首页
app.get('/', (req, res) => {
  executeQuery(
    'SELECT * FROM notes ORDER BY updated_at DESC LIMIT 10',
    []
  ).then(allNotes => {
    const notes = allNotes.map(note => ({
      ...note,
      metadata: note.metadata ? JSON.parse(note.metadata) : {}
    }));

    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenMD - AI-native Note Tool</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f8f9fa;
      min-height: 100vh;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 60px;
      padding: 60px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      color: white;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
    }
    .header h1 {
      font-size: 3rem;
      margin-bottom: 16px;
      font-weight: 700;
    }
    .header .tagline {
      font-size: 1.25rem;
      opacity: 0.95;
      margin-bottom: 20px;
    }
    .header .stats {
      display: inline-flex;
      gap: 30px;
      background: rgba(255,255,255,0.1);
      padding: 12px 24px;
      border-radius: 30px;
      backdrop-filter: blur(10px);
    }
    .stat {
      text-align: center;
    }
    .stat-number {
      font-size: 2rem;
      font-weight: 700;
      display: block;
    }
    .stat-label {
      font-size: 0.875rem;
      opacity: 0.9;
    }
    .section {
      background: white;
      border-radius: 12px;
      padding: 40px;
      margin-bottom: 30px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .section-title {
      font-size: 1.75rem;
      color: #2c3e50;
      margin-bottom: 30px;
      padding-bottom: 15px;
      border-bottom: 3px solid #667eea;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 25px;
      margin-bottom: 40px;
    }
    .feature-card {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 10px;
      border-left: 4px solid #667eea;
    }
    .feature-icon {
      font-size: 2rem;
      margin-bottom: 12px;
    }
    .feature-title {
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 8px;
      font-size: 1.1rem;
    }
    .feature-desc {
      color: #666;
      font-size: 0.95rem;
    }
    .api-section {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .api-method {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.85rem;
      margin-right: 10px;
    }
    .method-post { background: #22c55e; color: white; }
    .method-get { background: #3b82f6; color: white; }
    .method-put { background: #f59e0b; color: white; }
    code {
      background: #e9ecef;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #f0f4f8;
      color: #2c3e50;
      padding: 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 15px 0;
      font-size: 0.9em;
      line-height: 1.5;
      border: 1px solid #e0e6ed;
    }
    .notes-list {
      display: grid;
      gap: 20px;
    }
    .note-card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 25px;
      transition: all 0.3s ease;
      cursor: pointer;
    }
    .note-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }
    .note-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    .note-meta {
      color: #666;
      font-size: 0.875rem;
      display: flex;
      gap: 20px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #888;
    }
    .empty-icon {
      font-size: 4rem;
      margin-bottom: 20px;
      opacity: 0.5;
    }
    .footer {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 0.9em;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 OpenMD</h1>
      <p class="tagline">AI-native note tool - Designed for Agents, read by humans</p>
      <div class="stats">
        <div class="stat">
          <span class="stat-number">${notes.length}</span>
          <span class="stat-label">笔记总数</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">✨ 核心特性</h2>
      <div class="features">
        <div class="feature-card">
          <div class="feature-icon">🤖</div>
          <div class="feature-title">Agent 优先</div>
          <div class="feature-desc">专为 AI Agent 设计的 API，支持自动化内容创建和管理</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">📝</div>
          <div class="feature-title">Markdown 原生</div>
          <div class="feature-desc">完全支持 Markdown 格式，保留格式和结构</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔗</div>
          <div class="feature-title">一键分享</div>
          <div class="feature-desc">通过简单的 URL 分享笔记，支持密码保护和过期设置</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎨</div>
          <div class="feature-title">精美渲染</div>
          <div class="feature-desc">自动渲染为美观的 HTML，提供优秀的阅读体验</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">📋 最近的笔记</h2>
      ${notes.length > 0 ? `
        <div class="notes-list">
          ${notes.map(note => `
            <a href="/note/${note.id}" class="note-card">
              <div class="note-title">${note.title}</div>
              <div class="note-meta">
                <span>📅 ${new Date(note.created_at).toLocaleDateString('zh-CN')}</span>
                <span>✏️ ${note.metadata.author || 'Anonymous'}</span>
              </div>
            </a>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>暂无笔记，开始创建你的第一条笔记吧！</p>
        </div>
      `}
    </div>

    <div class="footer">
      <p>🚀 Powered by <strong>OpenMD</strong> - Open source on <a href="https://github.com/yuanxiaoze26/openmd" target="_blank">GitHub</a></p>
    </div>
  </div>
</body>
</html>
    `);
  }).catch(err => {
    console.error('Error listing notes:', err);
    res.send('Error loading notes');
  });
});

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    const health = await healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// 启动服务器（仅在非 Vercel 环境）
if (!process.env.VERCEL) {
  initDatabase().then(() => {
    console.log('✅ Database initialized');
    return healthCheck();
  }).then(health => {
    console.log('🏥 Database health:', health.status);
    if (health.status === 'healthy') {
      console.log(`📡 Host: ${health.host}, Database: ${health.database}`);
    }
    app.listen(PORT, () => {
      console.log(`🚀 OpenMD server running on port ${PORT}`);
      console.log(`📝 API: http://localhost:${PORT}/api/notes`);
      console.log(`🌐 Web: http://localhost:${PORT}`);
      console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }).catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}

// 导出供 Vercel Serverless 使用
module.exports = app;
