# [openmd] 项目 Memory

## 🤖 AI指令区（AI处理本项目时必读）

**当你读到这个文档时，请按以下顺序执行**：

1. **读取服务器信息**：
   - 路径：`/Users/xiaolin/Downloads/同步空间/Claude code/memory/key.md`
   - 查找 "OpenClaw 项目" 章节

2. **理解项目架构**：
   - GitHub: https://github.com/yuanxiaoze26/openmd
   - 账户：yuanxiaoze26（主）、xiaolin26（协作者）
   - 部署：Vercel Serverless

3. **阅读项目历史**（当前文档）

---

## 📅 2026-02-11 (v1.0.0)

### 🔐 安全修复：Session Secret 环境变量化

**核心变更**: 移除硬编码的 Session 密钥，改用环境变量

**原因**:
- 硬编码的 `openmd-secret-key-change-in-production` 存在安全风险
- 攻击者可以用已知密钥伪造用户 session
- 不同环境应使用不同的密钥

**实施方案**:
- ✅ 修改 `index.js` 使用 `process.env.SESSION_SECRET`
- ✅ 更新 `.env.example` 添加配置说明
- ✅ 移除硬编码密钥

**修改文件**:
- `index.js` - session 配置改为环境变量
- `.env.example` - 添加 SESSION_SECRET 说明

**测试结果**: 待测试

---

### 🐛 修复 Vercel 部署环境变量配置

**核心变更**: 移除 `vercel.json` 中的 Secret 引用

**原因**:
- `vercel.json` 中使用了 `@db-host` 等不存在的 Secret 引用
- 导致部署错误：`env_secret_missing`
- Vercel 项目中已配置加密的环境变量

**实施方案**:
- ✅ 删除 `vercel.json` 中的 `env` 配置块
- ✅ 让 Vercel 直接使用项目设置中的环境变量

**修改文件**:
- `vercel.json` - 移除 env 配置

**测试结果**: 待合并后测试

---

### ✨ 功能：添加 MySQL 支持和 Vercel Serverless 部署

**核心变更**: 支持生产环境 MySQL 数据库和 Vercel Serverless 部署

**原因**:
- 原 SQLite 无法在 Vercel Serverless 环境使用（文件系统只读）
- 需要支持生产级数据库
- 添加关键数据库函数

**实施方案**:
- ✅ 添加 MySQL 连接池支持（兼容原 SQLite）
- ✅ 新增 `executeQuery`/`executeUpdate`/`executeGet` 函数
- ✅ 支持 Vercel Serverless 环境（/tmp 目录）
- ✅ 添加 `vercel.json` 部署配置
- ✅ 添加 `.env.example` 环境变量模板

**修改文件**:
- `database.js` - 数据库层重构
- `index.js` - Vercel Serverless 兼容
- `vercel.json` - Vercel 部署配置
- `.env.example` - 环境变量模板

**测试结果**: 已合并 (PR #1)

---

## 🔧 技术栈总结

**后端**: Node.js + Express.js
**数据库**: MySQL (生产) / SQLite (开发)
**部署**: Vercel Serverless
**域名**: md.yuanze.com
**认证**: bcryptjs + express-session

---

## 🎯 核心设计原则

1. **Serverless 优先**: 支持 Vercel Serverless 部署
2. **数据库兼容**: 同时支持 MySQL 和 SQLite
3. **环境变量配置**: 所有敏感信息使用环境变量
4. **安全第一**: 密码加密、session 管理、环境变量隔离

---

## ⚠️ 重要技术决策

### 当前方案

| 模块 | 方案 | 说明 |
|-----|------|------|
| 部署平台 | Vercel Serverless | 自动扩缩容、按使用量付费 |
| 数据库 | MySQL + SQLite | 生产用 MySQL，开发用 SQLite |
| 认证 | Session + bcrypt | 传统 session 认证 |
| 域名 | md.yuanze.com | 已配置 SSL 证书 |

### 已废弃方案

| 方案 | 废弃原因 | 废弃时间 |
|-----|---------|---------|
| 纯 SQLite | Vercel Serverless 不支持 | 2026-02-11 |
| 硬编码密钥 | 安全风险 | 2026-02-11 |

---

## 📝 Vercel 配置

### 项目信息
- **项目名称**: openmd-na1x
- **项目 ID**: prj_gAxsU42g8ZqSpRhNfgNAw1Z0cd72
- **GitHub 仓库**: yuanxiaoze26/openmd
- **生产分支**: main

### 环境变量（已配置）

| 变量名 | 状态 | 说明 |
|--------|------|------|
| `DB_TYPE` | ✅ | mysql |
| `DB_HOST` | ✅ | 已加密配置 |
| `DB_PORT` | ✅ | 已加密配置 |
| `DB_NAME` | ✅ | 已加密配置 |
| `DB_USER` | ✅ | 已加密配置 |
| `DB_PASSWORD` | ✅ | 已加密配置 |
| `SESSION_SECRET` | ⚠️ | 待添加 |

### 访问地址
- **主域名**: https://md.yuanze.com
- **Vercel 域名**: https://openmd-na1x.vercel.app

### 自动部署
- ✅ GitHub 集成已启用
- ✅ 推送到 main 分支自动触发部署
- ✅ PR 合并后自动部署

---

## 🔐 安全配置

### 已实施的安全措施
1. ✅ 密码使用 bcrypt 加密
2. ✅ Session 密钥使用环境变量
3. ✅ 数据库密码使用环境变量
4. ✅ HTTPS 强制跳转
5. ✅ SQL 参数化查询（防止注入）

### 待实施的安全措施
1. ⚠️ 在 Vercel 添加 SESSION_SECRET 环境变量
2. ⚠️ 添加速率限制（防止暴力破解）
3. ⚠️ 添加 CSRF 保护
4. ⚠️ 添加 XSS 防护

---

## 🚀 部署流程

### 本地开发
```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 启动开发服务器
npm start
```

### Vercel 部署
```bash
# 推送到 main 分支
git push origin main

# Vercel 自动部署
# 访问 https://vercel.com/yuanxiaozes-projects/openmd-na1x 查看部署状态
```

---

## 📝 待解决问题

1. **SESSION_SECRET 配置**: 在 Vercel 添加环境变量（使用 openssl rand -hex 32 生成）
2. **PR #2 合并**: 修复 vercel.json 配置问题
3. **PR #3 创建**: Session Secret 安全修复
4. **测试**: 验证 MySQL 连接和用户注册/登录功能

---

## 🔗 相关链接

- **GitHub**: https://github.com/yuanxiaoze26/openmd
- **Vercel Dashboard**: https://vercel.com/yuanxiaozes-projects/openmd-na1x
- **生产环境**: https://md.yuanze.com
- **敏感信息**: `/Users/xiaolin/Downloads/同步空间/Claude code/memory/key.md`

---

**最后更新**: 2026-02-11
**更新人**: Claude Code + 晓力
**当前版本**: v1.0.0
