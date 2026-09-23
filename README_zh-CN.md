# Agents 登录鉴权模板

> 基于 **OpenAI Agents SDK** 的流式聊天 Agent 模板，跑在 EdgeOne Makers 上 —— 内置端到端登录鉴权：**平台鉴权（`agents.auth`）在边缘中控验签并注入 `makers-user-id`**，Cloud Functions 负责登录注册与 RS256 签发，账号体系存在 Neon Postgres。

**框架：** OpenAI Agents SDK · **分类：** Quick Start · **语言：** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=makers-agents-auth&from=within&fromAgent=1&agentLang=typescript)

## 概述

Agent 应用通常会调用模型、工具，如果没有登录鉴权，任何人都可以直接访问 Agent 接口，可能带来以下问题：

- **资源被滥用**：未登录用户也能消耗 LLM 和工具调用额度；
- **接口容易被绕过调用**：攻击者可以跳过前端页面，直接请求 `/chat`、`/stop` 等接口。

本模板使用 **Makers 平台鉴权**：在 `edgeone.json` 里配置 `agents.auth`，平台边缘中控层完成 JWT 验签，把验证后的用户身份写入请求头 `makers-user-id` 透传给 Agent Runtime。业务代码**不需要**解析或校验 Token，直接读取该请求头即可获得已验证、不可伪造的用户身份。账号登录与 Token 签发仍由 Cloud Functions 完成。

### 与「边缘中间件方案」的区别

| 对比项 | 平台鉴权（当前方案） | 边缘中间件（旧方案） |
| --- | --- | --- |
| 验签位置 | 平台边缘中控层，项目零代码 | 自己写的 `middleware.js`（Edge V8 + Web Crypto） |
| 覆盖路由 | 项目下**所有** Agent 路由（含 `/mcp`） | `middleware.config.matcher` 里手写的路径 |
| 验签算法 | 仅非对称（`RS256` / `ES256`） | 对称 `HS256`（共享密钥） |
| Agent 侧 | 直接读 `makers-user-id`，**不验签** | 用共享密钥再验一次 JWT |
| 密钥分布 | 平台只持有公钥，私钥留在签发服务 | 中间件 / cf / Agent 三处共用同一把密钥 |
| 401 行为 | 中控直接返回 401，**不会进入** Agent Runtime | 中间件返回 401 |
| 身份防伪造 | 客户端自带的 `makers-user-id` 会被中控无条件清除 | 依赖各层自行校验 |

## 项目主要文件与职责

| 文件 / 模块                 | 主要职责                                                                     |
| --------------------------- | ---------------------------------------------------------------------------- |
| `edgeone.json`            | `agents.auth`：开启平台 JWT 鉴权，配置验签公钥                              |
| `cloud-functions/auth/*`  | 登录、注册、登出、查询当前用户，校验账号密码并用私钥签发 RS256 JWT          |
| `cloud-functions/history` | 对话历史（cf 不在平台鉴权范围内，自行验签）                                 |
| `agents/chat/index.ts`    | Agent 入口：读取 `makers-user-id` + LLM 流式返回                            |
| `agents/stop/index.ts`    | 中止当前 run，同样要求已验证身份                                            |
| `agents/_jwt.ts`          | 平台已验证身份的读取工具（`getVerifiedUserId` / `requireUserId`）            |
| `db/migrations/users.sql` | Neon 数据库表结构                                                            |

## 实现原理

### 核心模型

```text
用户浏览器
   │
   │  登录 / 注册
   ▼
cloud-functions/auth/*
   │  校验账号密码
   │  写入 / 查询 Neon
   │  用 JWT_PRIVATE_KEY 签发 RS256 JWT
   ▼
浏览器保存 token（供 JS 读取，用于拼 Authorization 头）
   │
   │  调用 Agent：Authorization: Bearer <jwt>
   ▼
平台边缘中控（安全边界，验签只发生在这一层）
   │  校验签名 + exp → 失败直接 401
   │  取 sub 写入请求头 makers-user-id（客户端同名头会被清除）
   ▼
Agent Runtime
   │  读 context.request.headers.get('makers-user-id')
   ▼
返回 SSE / Agent 响应
```

### JWT 内容约定

```ts
interface JwtPayload {
  sub: string;       // users.id，UUID v4 —— 平台取该字段写入 makers-user-id
  username: string;  // 用户名（业务自用，平台不解析）
  iat: number;       // 签发时间，秒级时间戳
  exp: number;       // 过期时间，秒级时间戳，平台会校验
}
```

`sub` 与 `exp` 是平台要求的必需 Claim；`username` 等业务字段可自由扩展，但只有 `sub` 会被透传。

## 实现流程

### 登录 / 注册流程

```text
浏览器
  │
  │ ① POST /auth/login 或 /auth/register
  ▼
cloud-functions/auth/*
  │
  │ ② 校验 username / password
  │ ③ 查询或写入 Neon users 表
  │ ④ bcrypt 校验或生成 password_hash
  │ ⑤ 使用 JWT_PRIVATE_KEY 签发 RS256 JWT
  ▼
浏览器
  │
  │ ⑥ 响应体返回 { token, user }，前端保存 token
  ▼
登录完成
```

关键点：

- `/auth/*` 是 Cloud Functions，**不在**平台鉴权范围内（平台只覆盖 Agent 路由），因此它们必须保持公开；
- Token 通过响应体的 `token` 字段返回，前端保存后自行拼 `Authorization` 头。

### Agent 调用流程

```text
浏览器
  │
  │ ⑦ POST /chat，带 Authorization: Bearer <jwt>
  ▼
平台边缘中控
  │
  │ ⑧ 用 edgeone.json 里的公钥验签（RS256）
  │    失败：401，请求不会进入 Agent Runtime
  │    成功：写入 makers-user-id 后透传
  ▼
Agent Runtime
  │
  │ ⑨ requireUserId(context) 读取请求头
  ▼
浏览器
  │
  │ ⑩ SSE 流式返回 Agent 响应
```

关键点：

- Agent 侧**不验签**、不持有任何密钥 —— 它只信任平台注入的请求头；
- 验签失败在边缘中控统一拦截，业务代码无需处理这类情况。

## 平台鉴权配置

文件：`edgeone.json`

```json
{
  "agents": {
    "auth": {
      "type": "jwt",
      "algorithm": "RS256",
      "verificationKeys": [
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...（公钥，\n 为转义换行）...\n-----END PUBLIC KEY-----"
      ]
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `type` | string | 是 | - | 固定为 `"jwt"`。不配置 `agents.auth` 时，Agent 视为公开，不做任何身份校验 |
| `algorithm` | string | 否 | `RS256` | 验签算法，**仅支持非对称算法**（`RS256` / `ES256`），配置 `HS256` 会导致部署校验失败 |
| `verificationKeys` | string[] | 是 | - | 公钥数组（PEM 格式），中控按数组顺序依次尝试，任意一把通过即放行 |

PEM 里的真实换行在 JSON 字符串中要写成 `\n`。手动替换容易出错，推荐用命令转换：

```bash
# 生成密钥对
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem

# 转成可直接粘贴进 JSON 的单行转义字符串
awk '{printf "%s\\n", $0}' public_key.pem
```

配置完成后需要**重新部署**项目才能生效。

> **注意：修改配置涉及项目正常访问，请谨慎操作。** 开启鉴权后，未携带合法 Token 的请求会被直接拒绝（401），请确保客户端已同步接入 Token 签发逻辑后再上线。

## Cloud Functions 关键实现

目录：`cloud-functions/`

职责：注册 / 登录 / 当前用户信息 / 登出 + 签发 RS256 Token。

### 文件结构

| 文件                       | 作用                                  |
| -------------------------- | ------------------------------------- |
| `auth/register/index.ts` | 注册用户，写入 Neon，返回 RS256 Token |
| `auth/login/index.ts`    | 校验密码，返回 RS256 Token            |
| `auth/user/index.ts`     | 从 Bearer Token 判断当前登录用户      |
| `auth/logout/index.ts`   | 无状态登出（Token 由前端丢弃）         |
| `history/index.ts`       | `POST /history` — 自行验签的对话历史  |
| `_jwt.ts`                | RS256 签发 / 验签 + Bearer 头读取     |
| `_db.ts`                 | Neon HTTPS 客户端                     |
| `_validate.ts`           | 用户名 / 密码格式校验                 |

### 签发要点

```ts
import { createSign } from 'node:crypto';

const signer = createSign('RSA-SHA256');
signer.update(`${headerB64}.${payloadB64}`);
signer.end();
const sig = signer.sign(privateKeyPem, 'base64url');
```

私钥来自环境变量 `JWT_PRIVATE_KEY`，公钥（`JWT_PUBLIC_KEY`）用于 cf 侧自验签，且与 `edgeone.json` 中配置的是同一把。

> Cloud Functions **不在** `agents.auth` 的保护范围内 —— 平台鉴权只覆盖 Agent 路由。因此 `/auth/user`、`/history` 这类 cf 仍需调用 `requireAuth(context)` 用公钥自行验签。

## Agent 侧关键实现

文件示例：`agents/chat/index.ts`

平台验签通过后，身份已经在请求头里，Agent 不需要任何密钥：

```ts
import { requireUserId, AuthError, unauthorizedResponse } from '../_jwt';

export async function onRequest(context: any) {
  let userId: string;
  try {
    userId = requireUserId(context); // 读 makers-user-id，已验证且不可伪造
  } catch (e) {
    if (e instanceof AuthError) {
      return unauthorizedResponse(e.reason);
    }
    throw e;
  }
  // 从这里开始，才能执行 Agent 业务逻辑
}
```

`userId` 只负责证明「你是谁」（由平台保证可信）；「你能做什么」属于业务自己的权限系统，平台不提供该能力，需要业务自行实现。

## 数据库配置与实现

Neon 是 Serverless Postgres，本方案用它保存用户表，并通过 `@neondatabase/serverless` 以 HTTPS 方式访问。您也可以选择其它第三方数据库。

### 配置步骤

1. 在 [Neon 控制台](https://console.neon.tech/)创建项目
2. 获取连接串，格式类似：

   ```text
   postgresql://<user>:<password>@<host>/<db>?sslmode=require
   ```
3. 在 EdgeOne Makers 项目环境变量中配置 `DATABASE_URL`、`JWT_PRIVATE_KEY`、`JWT_PUBLIC_KEY`，本地开发时在 `.env` 中配置同名变量。

### 数据库表结构

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq
  ON users (LOWER(username));
```

说明：

- `id` 由 Postgres `gen_random_uuid()` 自动生成，即 JWT 的 `sub`
- `password_hash` 只保存 bcrypt 哈希，不保存明文密码
- `LOWER(username)` 唯一索引用于避免 `Alice` 和 `alice` 同时注册

## 环境变量

| 变量                    | 必填 | 说明                                                                                |
| ----------------------- | ---- | ----------------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY`  | 是   | 模型网关 API key，可用**Makers Models API Key**，也可用任何 OpenAI 兼容厂商的 key |
| `AI_GATEWAY_BASE_URL` | 是   | 网关地址。Makers Models 用 `https://ai-gateway.edgeone.link/v1`                    |
| `JWT_PRIVATE_KEY`     | 是   | RS256 私钥（PEM），仅 Cloud Functions 签发 Token 时使用，切勿下发到客户端           |
| `JWT_PUBLIC_KEY`      | 是   | RS256 公钥（PEM），Cloud Functions 自验签使用；同一把公钥也配在 `edgeone.json`      |
| `DATABASE_URL`        | 是   | Neon Postgres HTTPS 连接串（`postgresql://...?sslmode=require`）                    |

### 如何获取 `AI_GATEWAY_API_KEY`

1. 打开 [Makers 控制台](https://console.cloud.tencent.com/edgeone/makers)
2. 登录并启用 Makers
3. 进入 **Makers → 模型 → API Key**，创建一个 key
4. 复制到 `AI_GATEWAY_API_KEY`（`AI_GATEWAY_BASE_URL` 设为 `https://ai-gateway.edgeone.link/v1`）

内置模型（`@makers/deepseek-v4-flash` / `@makers/hy3-preview` / `@makers/minimax-m2.7`）免费且有配额，适合验证。生产请在控制台绑定自费厂商（BYOK）。

### 如何生成密钥对

```bash
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
# 环境变量不能存真实换行，转成单行 \n 转义：
awk '{printf "%s\\n", $0}' private_key.pem
awk '{printf "%s\\n", $0}' public_key.pem
```

私钥只放在 Cloud Functions 的环境变量里；公钥同时配置到 `JWT_PUBLIC_KEY` 和 `edgeone.json` 的 `agents.auth.verificationKeys`。

## 本地开发

**前置依赖：** Node.js，npm

```bash
npm install
cp .env.example .env
# 填好 JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / DATABASE_URL / AI_GATEWAY_*
edgeone makers dev
```

打开 `http://localhost:8080/agent-metrics` 查看本地可观测面板。

> 一条命令起整套服务 —— `edgeone makers dev` 会派生 Vite dev server 子进程，cloud-functions / Agent 都挂在同一端口下。**不要**单独跑 `npm run dev`。

## 项目结构

```text
makers-agent-auth/
├── edgeone.json                     # agents.auth — 平台 JWT 鉴权 + 验签公钥
├── agents/
│   ├── chat/index.ts                # POST /chat — 读 makers-user-id + LLM 流式
│   ├── stop/index.ts                # POST /stop — 中止当前 run（需已验证身份）
│   ├── _jwt.ts                      # 平台已验证身份读取（不再自行验签）
│   ├── _logger.ts
│   ├── _sse.ts                      # SSE 响应辅助
│   └── _tools.ts                    # 自定义工具（天气 / 翻译 / 文本统计…）
├── cloud-functions/
│   ├── auth/
│   │   ├── login/index.ts           # POST /auth/login    — bcrypt 校验 + 签 RS256 JWT
│   │   ├── register/index.ts        # POST /auth/register — bcrypt 哈希 + 入库 + 签 JWT
│   │   ├── user/index.ts            # GET  /auth/user     — 当前用户 + exp
│   │   └── logout/index.ts          # POST /auth/logout   — 无状态登出
│   ├── history/index.ts             # POST /history       — cf 自验签的对话历史
│   ├── _jwt.ts                      # node:crypto RS256 签发 / 验签 + Bearer 读取
│   ├── _db.ts                       # Neon HTTPS 客户端
│   ├── _validate.ts                 # 用户名 / 密码格式校验
│   └── _logger.ts
├── db/migrations/
│   └── users.sql                    # users 表 schema
├── src/                             # Vite + React 前端
│   ├── auth/
│   │   ├── AuthGate.tsx             # 鉴权上下文 + 按需登录弹窗
│   │   ├── UserPill.tsx             # 头部用户徽章 + 登出菜单
│   │   └── SignInButton.tsx         # 访客头部 CTA — 唤起登录弹窗
│   ├── components/                  # 聊天 UI 组件
│   ├── i18n/                        # zh / en 文案
│   └── api.ts                       # 浏览器 → 后端封装 + Bearer 头 + 401 拦截
├── scripts/
│   └── db-check.mjs                 # Neon 连接探测
└── package.json
```

> 以 `_` 开头的文件是**私有模块**，EdgeOne 不会将它们映射为公开路由。

## 接入步骤

如果您要把这套方案接到自己的 Agent 项目，按这个顺序做：

1. 生成 RS256 密钥对，把公钥填进 `edgeone.json` 的 `agents.auth.verificationKeys`
2. 创建 Neon 数据库，执行 `db/migrations/users.sql`
3. 配置 `DATABASE_URL`、`JWT_PRIVATE_KEY`、`JWT_PUBLIC_KEY`
4. 复制 `cloud-functions/auth/*`、`cloud-functions/_jwt.ts`、`cloud-functions/_db.ts`、`cloud-functions/_validate.ts`
5. 在每个 Agent 入口用 `requireUserId(context)` 读取 `makers-user-id`
6. 客户端调用 Agent 时携带 `Authorization: Bearer <token>`
7. 重新部署项目使 `agents.auth` 生效

## 使用约束

1. 验签失败（签名不合法、Token 过期等）由**边缘中控**统一拦截返回 `401`，不会静默放行，也不会进入 Agent Runtime，业务代码无需处理。
2. `algorithm` 只能配置非对称算法，配置 `HS256` 等对称算法会导致部署校验失败。
3. 平台鉴权只覆盖 Agent 路由；Cloud Functions（如 `/history`、`/auth/user`）需自行验签。
4. 不配置 `agents.auth` 时 Agent 完全公开，`makers-user-id` 恒为空，会话隔离退化为随机 conversation-id。
5. 修改 `agents.auth` 后需要重新部署才会生效。
6. Token 通过 `Authorization` 头传递，因此前端必须能读取它（本模板存于 `localStorage`）。相比 HttpOnly Cookie，XSS 风险更高，请收紧依赖并避免渲染不可信 HTML。

## 资源

* [EdgeOne Makers Agents 文档](https://cloud.tencent.com/document/product/1552/132759)
* [EdgeOne Makers 快速开始](https://cloud.tencent.com/document/product/1552/132786)
* [Makers Models](https://cloud.tencent.com/document/product/1552/132748)

## License

MIT
