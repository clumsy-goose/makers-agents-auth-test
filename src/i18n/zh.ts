const zh = {
  // Header
  "app.title": "Agents Login Auth Starter",
  "app.subtitle": "EdgeOne Makers · 平台 JWT 鉴权(边缘中控验签)+ Cloud Functions 签发",

  // Empty state
  "empty.title": "Agent 登录鉴权集成",
  "empty.hint": "本 Demo 演示如何使用 EdgeOne Makers 的平台鉴权能力，为 Agent 接口接入 JWT 鉴权。",
  "empty.features": "EdgeOne Store · 会话记忆 · Agent 工具",

  // Chat input
  "chat.placeholder": "输入消息...  ⏎ 发送 · Shift+⏎ 换行",
  "chat.hint": "由 OpenAI Agents SDK 驱动 · 仅供演示",

  // Preset questions
  "preset.1": "北京现在天气怎么样？有什么穿衣建议？",
  "preset.2": "将「你好，欢迎来到北京！」翻译成英文并统计字符数。",

  // Tool indicators
  "tool.weather": "天气",
  "tool.clothing": "穿搭",
  "tool.translate": "翻译",
  "tool.statistics": "统计",

  // Status & errors
  "status.error": "请求失败，请检查后端服务是否正常运行。",
  "status.stopped": "⏹ *已停止生成*",
  "status.backendError": "后端中止请求失败，服务器可能仍在运行。",

  // Debug panel
  "debug.title": "传输流",
  "debug.events": "事件",
  "debug.clear": "清除",
  "debug.empty": "等待 SSE 事件...",
  "debug.emptyHint": "发送消息后，所有原始后端数据将在此处显示。",

  // Language toggle
  "lang.switch": "English",

  // Auth screen — tabs / forms
  "auth.tab.login": "登录",
  "auth.tab.register": "注册",
  "auth.login.title": "欢迎回来",
  "auth.login.hint": "输入账号继续上次对话。",
  "auth.login.submit": "登录",
  "auth.login.swap.q": "还没账号?",
  "auth.login.swap.cta": "立即注册",
  "auth.register.title": "创建账号",
  "auth.register.hint": "3-10 位用户名 · 8-16 位密码,注册即用。",
  "auth.register.submit": "注册并登录",
  "auth.register.swap.q": "已有账号?",
  "auth.register.swap.cta": "去登录",
  "auth.field.username": "USERNAME",
  "auth.field.password": "PASSWORD",
  "auth.field.username.placeholder": "alice_42",
  "auth.field.password.helper": "至少 8 位 · bcrypt 10 轮哈希存储",
  "auth.password.show": "显示密码",
  "auth.password.hide": "隐藏密码",
  "auth.submit.busy": "处理中…",

  // Auth — errors
  "auth.error.empty": "请填写用户名和密码",
  "auth.err.invalid_credentials": "用户名或密码不正确",
  "auth.err.username_taken": "该用户名已被注册",
  "auth.err.invalid_username": "用户名格式不合法(3-10 位,允许字母/数字/下划线/连字符)",
  "auth.err.invalid_password": "密码长度需在 8-16 之间",
  "auth.err.bad_request": "请求格式错误",
  "auth.err.db_error": "数据库暂不可达,请稍后重试",
  "auth.err.server_misconfigured": "服务端未配置 JWT_PRIVATE_KEY / JWT_PUBLIC_KEY",
  "auth.err.auth_required": "会话已失效,请重新登录",
  "auth.err.unknown": "未知错误",

  // Guest 模式(未登录头部 CTA + 弹窗关闭)
  "guest.signin": "登录",
  "auth.modal.dismiss": "关闭",
  "auth.modal.required": "登录后继续",

  // User pill
  "pill.expand": "展开账户菜单",
  "pill.collapse": "收起账户菜单",
  "pill.you": "已登录",
  "pill.userId": "用户 ID",
  "pill.token": "JWT",
  "pill.token.value": "RS256 · Authorization Bearer",
  "pill.expiresAt": "过期时间",
  "pill.signout": "退出登录",
} as const;

export default zh;
