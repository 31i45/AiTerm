// ─── 全局常量 ──────────────────────────────────────────────────

/** Ollama API 基础 URL */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** 危险命令模式（AI 工具和命令执行共用） */
export const DANGEROUS_PATTERNS = [
  // 磁盘/分区破坏
  /rm\s+-rf\s+\/\s*/,
  /rm\s+-rf\s+\*\s*/,
  /format\s+[a-z]:/i,
  /del\s+\/[sfq]\s+[a-z]:\\/i,
  /rd\s+\/[sq]\s+[a-z]:\\/i,
  /mkfs\./,
  /dd\s+if=/,
  /diskpart/,
  // 系统关停
  /shutdown/,
  /reboot/,
  /halt/,
  /poweroff/,
  // 权限滥用
  /chmod\s+-R\s+777\s+\//,
  /chown\s+-R/,
  // 用户/密码操作
  /passwd/,
  /useradd/,
  /userdel/,
  /usermod/,
  // Fork 炸弹
  /:\(\)\s*\{/,
  // 管道执行远程脚本
  /\|\s*(bash|sh|powershell)\s*$/,
  /curl.*\|\s*(bash|sh)/,
  /wget.*\|\s*(bash|sh)/,
];

/** 当前平台 */
export const IS_WINDOWS = process.platform === "win32";

/** 系统默认 Shell */
export const DEFAULT_SHELL = IS_WINDOWS
  ? (Bun.which("pwsh.exe") || Bun.which("powershell.exe") || "cmd.exe")
  : (process.env.SHELL || "/bin/bash");

/** Shell 参数格式 */
export const SHELL_ARGS = IS_WINDOWS ? ["/c"] : ["-c"];

// ─── AI Chat Types ───────────────────────────────────────────────

export interface OllamaStatus {
  connected: boolean;
  version: string | null;
  error: string | null;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
}
