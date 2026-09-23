const en = {
  // Header
  "app.title": "Agents Login Auth Starter",
  "app.subtitle": "EdgeOne Makers · Platform JWT auth (verified at the edge) + Cloud Functions issuing RS256 tokens",

  // Empty state
  "empty.title": "Agents Login Auth Starter",
  "empty.hint": "This demo shows how to use EdgeOne Makers' platform auth capability to add JWT authentication to Agent endpoints.",
  "empty.features": "EdgeOne Store · Session Memory · Agent Tools",

  // Chat input
  "chat.placeholder": "Type a message...  ⏎ Send · Shift+⏎ Newline",
  "chat.hint": "Powered by OpenAI Agents SDK · Demo only",

  // Preset questions
  "preset.1": "What is the weather like in Beijing now? Any clothing suggestions?",
  "preset.2": "Translate \"Hello, welcome to Beijing!\" into English and count the characters.",

  // Tool indicators
  "tool.weather": "Weather",
  "tool.clothing": "Clothing",
  "tool.translate": "Translate",
  "tool.statistics": "Statistics",

  // Status & errors
  "status.error": "Request failed. Please check if the backend service is running.",
  "status.stopped": "⏹ *Generation stopped*",
  "status.backendError": "Backend abort request failed. The server may still be running.",

  // Debug panel
  "debug.title": "Trace",
  "debug.events": "events",
  "debug.clear": "Clear",
  "debug.empty": "Waiting for SSE events...",
  "debug.emptyHint": "After sending a message, all raw backend data will be displayed here.",

  // Language toggle
  "lang.switch": "中文",

  // Auth screen — tabs / forms
  "auth.tab.login": "Sign in",
  "auth.tab.register": "Sign up",
  "auth.login.title": "Welcome back",
  "auth.login.hint": "Sign in to continue your conversation.",
  "auth.login.submit": "Sign in",
  "auth.login.swap.q": "No account yet?",
  "auth.login.swap.cta": "Create one",
  "auth.register.title": "Create account",
  "auth.register.hint": "3-10 char username · 8-16 char password — sign up to start.",
  "auth.register.submit": "Register & sign in",
  "auth.register.swap.q": "Already registered?",
  "auth.register.swap.cta": "Sign in",
  "auth.field.username": "USERNAME",
  "auth.field.password": "PASSWORD",
  "auth.field.username.placeholder": "alice_42",
  "auth.field.password.helper": "Min 8 chars · stored as bcrypt cost 10",
  "auth.password.show": "Show password",
  "auth.password.hide": "Hide password",
  "auth.submit.busy": "Working…",

  // Auth — errors
  "auth.error.empty": "Username and password are required",
  "auth.err.invalid_credentials": "Invalid username or password",
  "auth.err.username_taken": "Username is already taken",
  "auth.err.invalid_username": "Invalid username (3-10 chars, [A-Za-z0-9_-] only)",
  "auth.err.invalid_password": "Password must be 8 to 16 characters",
  "auth.err.bad_request": "Bad request",
  "auth.err.db_error": "Database unavailable, please retry",
  "auth.err.server_misconfigured": "Server misconfigured: JWT_PRIVATE_KEY / JWT_PUBLIC_KEY missing",
  "auth.err.auth_required": "Session expired, please sign in again",
  "auth.err.unknown": "Unknown error",

  // Guest mode (anonymous header CTA + modal close)
  "guest.signin": "Sign in",
  "auth.modal.dismiss": "Close",
  "auth.modal.required": "Sign in to continue",

  // User pill
  "pill.expand": "Open account menu",
  "pill.collapse": "Close account menu",
  "pill.you": "Signed in",
  "pill.userId": "User ID",
  "pill.token": "JWT",
  "pill.token.value": "RS256 · Authorization Bearer",
  "pill.expiresAt": "Expires at",
  "pill.signout": "Sign out",
} as const;

export default en;
