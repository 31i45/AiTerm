import type { OllamaStatus, OllamaModel } from "../types";
import { OLLAMA_BASE_URL, DANGEROUS_PATTERNS, IS_WINDOWS, DEFAULT_SHELL, SHELL_ARGS } from "../types";

// ─── 工具类型 ──────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  content?: string;
  error?: string;
  entries?: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
  truncated?: boolean;
  totalLength?: number;
  message?: string;
}

// ─── Ollama API 调用 ───────────────────────────────────────────────

/**
 * 检查 Ollama 连接状态
 */
export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        connected: false,
        version: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json() as { version: string };
    return {
      connected: true,
      version: data.version,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      connected: false,
      version: null,
      error: message,
    };
  }
}

/**
 * 获取可用模型列表
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: HTTP ${response.status}`);
    }

    const data = await response.json() as { models: OllamaModel[] };
    return data.models ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Failed to list models: ${message}`);
  }
}

// ─── 工具执行 ──────────────────────────────────────────────────────

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * 路径安全验证：防止目录遍历
 * 只允许访问用户主目录及其子目录
 */
function validatePath(inputPath: string): { ok: true; resolvedPath: string } | { ok: false; error: string } {
  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();

  // 规范化路径，解析 .. 和符号链接
  let resolved: string;
  try {
    resolved = new URL(`file:///${inputPath.replace(/\\/g, '/')}`).pathname;
    resolved = decodeURIComponent(resolved);
  } catch {
    return { ok: false, error: `Invalid path: ${inputPath}` };
  }

  // 检查路径遍历
  if (resolved.includes('..')) {
    return { ok: false, error: `Path traversal not allowed: ${inputPath}` };
  }

  // Windows 盘符检查：只允许用户主目录所在盘符
  if (IS_WINDOWS) {
    const homeRoot = homeDir.charAt(0).toUpperCase();
    const pathRoot = resolved.charAt(0).toUpperCase();
    if (pathRoot < 'A' || pathRoot > 'Z' || pathRoot !== homeRoot) {
      return { ok: false, error: `Access denied: ${inputPath} (outside home directory)` };
    }
  }

  return { ok: true, resolvedPath: resolved };
}

/**
 * 命令白名单验证：防止命令注入
 * 只允许常用安全命令
 */
const ALLOWED_COMMANDS = [
  // 文件操作
  "ls", "dir", "cat", "type", "head", "tail", "less", "more", "wc",
  // 目录操作
  "cd", "pwd", "mkdir", "rmdir",
  // 文件管理
  "cp", "copy", "mv", "move", "rm", "del", "ren", "rename", "touch",
  // 查找/搜索
  "grep", "find", "where", "which", "echo", "printf",
  // 网络（只读）
  "curl", "wget", "ping", "nslookup", "ipconfig", "ifconfig",
  // 系统（只读）
  "whoami", "hostname", "date", "time", "cal", "uptime", "df", "du",
  "free", "top", "ps", "env", "printenv", "set", "export",
  // 开发工具
  "git", "npm", "bun", "node", "python", "python3", "pip", "pip3",
  "cargo", "go", "rustc", "gcc", "g++", "make", "cmake",
  // 文本处理
  "sed", "awk", "sort", "uniq", "diff", "tee", "xargs",
  // 压缩/解压
  "tar", "zip", "unzip", "gzip", "gunzip",
  // 进程管理
  "kill", "killall", "nohup",
  // 权限（仅限当前用户文件）
  "chmod",
];

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  // 提取第一个命令（支持管道和链式命令中的每个命令）
  const parts = trimmed.split(/[|;&]/);
  for (const part of parts) {
    const cmd = part.trim().split(/\s+/)[0];
    // 去除路径前缀（如 /usr/bin/ls → ls）
    const baseName = cmd.split(/[/\\]/).pop() ?? "";
    if (!ALLOWED_COMMANDS.includes(baseName)) {
      return false;
    }
  }
  return true;
}

export const tools = {
  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {

    if (isDangerousCommand(command)) {
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: "Error: Dangerous command blocked for security reasons.",
      };
    }

    if (!isCommandAllowed(command)) {
      const baseCmd = command.trim().split(/\s+/)[0].split(/[/\\]/).pop();
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: `Error: Command "${baseCmd}" is not in the allowed list.`,
      };
    }

    const TIMEOUT = 30000;
    const timeoutSignal = AbortSignal.timeout(TIMEOUT);

    const shellArgs = [...SHELL_ARGS, command];

    try {
      const proc = Bun.spawn([DEFAULT_SHELL, ...shellArgs], {
        cwd: cwd ?? undefined,
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeoutPromise: Promise<never> = new Promise((_, reject) => {
        timeoutSignal.addEventListener("abort", () => {
          proc.kill();
          proc.exited.then(() => {
            reject(new Error(`Command timed out after ${TIMEOUT}ms`));
          });
        });
      });

      const resultPromise = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      const [stdout, stderr, exitCode] = await Promise.race([
        resultPromise,
        timeoutPromise,
      ]);

      return {
        success: exitCode === 0,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: message,
      };
    }
  },

  async readFile(path: string): Promise<ToolResult> {
    try {
      const validated = validatePath(path);
      if (!validated.ok) return { success: false, error: validated.error };

      const file = Bun.file(validated.resolvedPath);
      const exists = await file.exists();

      if (!exists) {
        return {
          success: false,
          error: `File not found: ${path}`,
        };
      }

      const content = await file.text();
      const MAX_CHARS = 50000;

      if (content.length > MAX_CHARS) {
        return {
          success: true,
          content: content.slice(0, MAX_CHARS) + "\n\n... [truncated]",
          truncated: true,
          totalLength: content.length,
        };
      }

      return {
        success: true,
        content,
        truncated: false,
        totalLength: content.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },

  async listDirectory(path: string): Promise<ToolResult> {
    try {
      const validated = validatePath(path);
      if (!validated.ok) return { success: false, error: validated.error };

      const dir = Bun.file(validated.resolvedPath);
      const stat = await dir.stat();

      if (!stat?.isDirectory()) {
        return {
          success: false,
          error: `Not a directory: ${path}`,
        };
      }

      const entries = await Array.fromAsync(Bun.file(validated.resolvedPath).scan());

      if (entries.length === 0) {
        return {
          success: true,
          entries: [],
          message: "Directory is empty",
        };
      }

      const formatted = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        isFile: entry.isFile,
      }));

      return {
        success: true,
        entries: formatted,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
};

// ─── 工具描述 ──────────────────────────────────────────────────────

export const toolDescriptions = [
  {
    name: "execute_command",
    description: "Execute a shell command on the system. Use this to run terminal commands, scripts, or system utilities.",
    parameters: {
      command: { type: "string", description: "The shell command to execute" },
      cwd: { type: "string", description: "Working directory for the command (optional)", optional: true },
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content as text.",
    parameters: {
      path: { type: "string", description: "Absolute path to the file to read" },
    },
  },
  {
    name: "list_directory",
    description: "List files and directories at the given path. Returns names and types (file/directory).",
    parameters: {
      path: { type: "string", description: "Absolute path to the directory to list" },
    },
  },
];
