const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * 终端会话管理器
 * 参考 WebSSH2 架构，管理多个 PTY 会话的生命周期
 *
 * 职责：
 * - 创建/销毁 PTY 进程
 * - 终端输入/输出转发
 * - 终端尺寸调整
 * - 高危命令拦截（委托给 SecurityService）
 */
class TerminalSessionManager {
    /**
     * @param {import('ws')} ws - WebSocket 连接实例
     * @param {import('../logger')} logger - 日志服务
     * @param {import('../services/config')} config - 配置服务
     * @param {import('../services/security')} security - 安全服务
     * @param {string} sessionId - 会话 ID
     */
    constructor(ws, logger, config, security, sessionId) {
        this.ws = ws;
        this.logger = logger;
        this.config = config;
        this.security = security;
        this.sessionId = sessionId;

        /** @type {Map<string, { process: import('node-pty').IPty, terminalId: string, createdAt: number }>} */
        this.sessions = new Map();

        /** @type {number} */
        this.maxSessions = config.get('limits.maxSessionsPerUser') || 10;

        // 命令历史记录（用于 AI 上下文注入）
        /** @type {Array<{input: string, output: string, timestamp: number}>} */
        this.commandHistory = [];
        /** @type {number} 最大保留条数 */
        this.maxHistoryLength = 20;

        // 当前正在累积的输出缓冲
        this._outputBuffer = '';
        /** @type {number} 输出缓冲超时（毫秒）*/
        this._outputFlushTimer = null;
    }

    /**
     * 获取最近的命令历史（用于 AI 上下文）
     * @param {number} [limit=5] - 返回最近 N 条
     * @returns {Array<{input: string, output: string}>}
     */
    getRecentCommandHistory(limit = 5) {
        return this.commandHistory.slice(-limit);
    }

    /**
     * 创建新的终端会话
     * @param {string} terminalId - 终端标识
     * @param {number} [cols=80] - 列数
     * @param {number} [rows=24] - 行数
     * @returns {import('node-pty').IPty|null}
     */
    createSession(terminalId, cols = 80, rows = 24) {
        // 会话数量限制
        if (this.sessions.size >= this.maxSessions) {
            this._sendToClient('error', {
                message: `已达到最大终端数量 (${this.maxSessions})，请关闭不需要的终端`
            });
            return null;
        }

        // 防止重复创建
        if (this.sessions.has(terminalId)) {
            this.logger.warn('终端会话已存在', { sessionId: this.sessionId, terminalId });
            return this.sessions.get(terminalId).process;
        }

        this.logger.info('创建新终端会话', {
            sessionId: this.sessionId,
            terminalId,
            cols,
            rows
        });

        const shell = this._getDefaultShell();
        this.logger.debug('使用 Shell', { shell });

        // 继承完整环境变量，只过滤敏感信息
        const sensitiveKeys = new Set([
            'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
            'DATABASE_URL', 'DB_PASSWORD', 'SECRET_KEY', 'PRIVATE_KEY',
            'API_KEY', 'AUTH_TOKEN', 'PASSWORD', 'TOKEN'
        ]);
        const env = { ...process.env };
        // 覆盖终端相关变量
        env.TERM = 'xterm-256color';
        env.COLORTERM = 'truecolor';
        // 过滤敏感变量
        for (const key of Object.keys(env)) {
            if (sensitiveKeys.has(key)) {
                delete env[key];
            }
        }

        // 根据 shell 类型设置参数（PowerShell 使用 -Login 加载 profile）
        const shellArgs = this._getShellArgs(shell);

        const ptyProcess = pty.spawn(shell, shellArgs, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: os.homedir(),
            env
        });

        // PTY 数据输出 → 客户端
        ptyProcess.onData((data) => {
            // 收集输出用于命令历史
            if (this._pendingOutputCollect) {
                const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]{0,500}\x07/g, '');
                this._pendingOutputCollect.collectedOutput += clean;
            }

            this._sendToClient('pty_data', { terminalId, data });
        });

        // PTY 进程退出
        ptyProcess.onExit(({ exitCode, signal }) => {
            this.logger.info('PTY 进程退出', {
                sessionId: this.sessionId,
                terminalId,
                exitCode,
                signal
            });
            this._cleanupSession(terminalId);
        });

        this.sessions.set(terminalId, {
            process: ptyProcess,
            terminalId,
            createdAt: Date.now()
        });

        return ptyProcess;
    }

    /**
     * 关闭指定终端会话
     * @param {string} terminalId
     */
    closeSession(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session) return;

        this.logger.info('关闭终端会话', { sessionId: this.sessionId, terminalId });
        this._killProcess(session.process, terminalId);
        this.sessions.delete(terminalId);
    }

    /**
     * 发送输入到终端（含安全检查）
     * @param {string} terminalId
     * @param {string} data - 用户输入
     */
    sendInput(terminalId, data) {
        const session = this.sessions.get(terminalId);
        if (!session) return;

        // 委托安全服务进行高危命令检测
        const { isHighRisk, reason } = this.security.checkCommand(data);
        if (isHighRisk) {
            this._sendToClient('command_blocked', {
                terminalId,
                message: `高危命令已拦截: ${reason}`,
                reason
            });
            return;
        }

        // 记录命令输入（仅记录回车提交的命令，过滤控制序列）
        if (data === '\r' || data === '\n') {
            this._flushOutputBuffer();
        } else if (data.length > 0 && !this._isControlSequence(data)) {
            this._outputBuffer += data;
        }

        session.process.write(data);
    }

    /**
     * 判断输入是否为控制序列（方向键、功能键等）
     * @private
     * @param {string} data
     * @returns {boolean}
     */
    _isControlSequence(data) {
        // ESC 开头的序列、退格、Tab 等控制字符
        if (data.startsWith('\x1b')) return true;
        if (data === '\b' || data === '\t') return true;
        if (data.charCodeAt(0) < 32 && data !== '\r' && data !== '\n') return true;
        return false;
    }

    /**
     * 将累积的命令输入和对应的输出保存到历史
     * @private
     */
    _flushOutputBuffer() {
        const input = this._outputBuffer.trim();
        this._outputBuffer = '';

        if (!input || input.length < 2) return;

        // 清除之前的输出累积定时器，开始新的输出收集窗口
        if (this._outputFlushTimer) clearTimeout(this._outputFlushTimer);

        // 收集命令执行后的输出（500ms 窗口）
        let collectedOutput = '';
        const collectOutput = (terminalId, data) => {
            // 过滤 ANSI 转义序列，只保留纯文本（限制 OSC 序列长度防止 ReDoS）
            const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]{0,500}\x07/g, '');
            collectedOutput += clean;
        };

        // 临时监听输出
        this._pendingOutputCollect = { input, collectedOutput: '', startTime: Date.now() };

        // 800ms 后停止收集并保存到历史（等待命令执行完成）
        this._outputFlushTimer = setTimeout(() => {
            if (this._pendingOutputCollect) {
                const { input: cmd, collectedOutput: output } = this._pendingOutputCollect;
                this._pendingOutputCollect = null;

                // 保存到命令历史
                const cleanOutput = output.trim().substring(0, 2000); // 限制输出长度
                this.commandHistory.push({
                    input: cmd,
                    output: cleanOutput,
                    timestamp: Date.now()
                });

                // 限制历史长度
                while (this.commandHistory.length > this.maxHistoryLength) {
                    this.commandHistory.shift();
                }
            }
        }, 800);
    }

    /**
     * 调整终端尺寸
     * @param {string} terminalId
     * @param {number} cols
     * @param {number} rows
     */
    resize(terminalId, cols, rows) {
        const session = this.sessions.get(terminalId);
        if (!session) return;

        try {
            session.process.resize(cols, rows);
        } catch (e) {
            this.logger.error('终端调整大小失败', {
                sessionId: this.sessionId,
                terminalId,
                error: e.message
            });
        }
    }

    /**
     * 清理所有会话（WebSocket 断开时调用）
     */
    cleanup() {
        this.logger.info('清理所有终端会话', {
            sessionId: this.sessionId,
            sessionCount: this.sessions.size
        });

        // 清理输出刷新定时器
        if (this._outputFlushTimer) {
            clearTimeout(this._outputFlushTimer);
            this._outputFlushTimer = null;
        }

        for (const [terminalId, session] of this.sessions) {
            this._killProcess(session.process, terminalId);
        }
        this.sessions.clear();
    }

    /**
     * 获取当前活跃会话数量
     * @returns {number}
     */
    get sessionCount() {
        return this.sessions.size;
    }

    /**
     * 获取默认 Shell
     * @private
     * @returns {string}
     */
    _getDefaultShell() {
        const platform = os.platform();
        const candidates = platform === 'win32'
            ? ['pwsh.exe', 'powershell.exe', 'cmd.exe']
            : platform === 'darwin'
                ? ['/bin/zsh', '/bin/bash', '/bin/sh']
                : ['/bin/bash', '/bin/sh', '/bin/zsh'];

        for (const shell of candidates) {
            if (this._isValidShell(shell)) {
                return shell;
            }
        }

        // 兜底方案
        return platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    }

    /**
     * 获取 shell 启动参数
     * PowerShell 使用 -Login 加载 profile，其他 shell 不使用额外参数
     * @private
     * @param {string} shell
     * @returns {string[]}
     */
    _getShellArgs(shell) {
        const basename = path.basename(shell).toLowerCase();

        // PowerShell Core 和 Windows PowerShell 都使用 -Login 加载 profile
        if (basename === 'pwsh.exe' || basename === 'powershell.exe') {
            return ['-Login'];
        }

        // cmd.exe 和其他 shell 不需要额外参数
        return [];
    }

    /**
     * 验证 shell 是否有效（防止命令注入）
     * @private
     * @param {string} shell
     * @returns {boolean}
     */
    _isValidShell(shell) {
        if (!shell || typeof shell !== 'string') return false;

        // 禁止包含路径遍历或特殊字符
        const dangerous = /[;&|`$(){}[\]<>!#*?~]|\.\.|^\/\/|\\/;
        if (dangerous.test(shell)) {
            this.logger.warn('Shell 路径包含危险字符', { shell });
            return false;
        }

        // Windows: 只检查文件名
        if (os.platform() === 'win32') {
            const validShells = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl.exe'];
            const basename = path.basename(shell).toLowerCase();
            return validShells.includes(basename);
        }

        // Unix: 检查文件是否存在且可执行
        try {
            const stats = fs.statSync(shell);
            return stats.isFile();
        } catch {
            return false;
        }
    }

    /**
     * 安全终止 PTY 进程
     * Windows 不支持 POSIX 信号，使用不同的终止策略
     * @private
     * @param {import('node-pty').IPty} process
     * @param {string} terminalId
     */
    _killProcess(process, terminalId) {
        const platform = os.platform();

        try {
            if (platform === 'win32') {
                // Windows: 直接终止，不使用信号
                // node-pty 在 Windows 上会调用 TerminateProcess
                process.kill();
            } else {
                // POSIX: 先 SIGTERM 优雅退出，3 秒后 SIGKILL 强制
                process.kill('SIGTERM');

                const killTimer = setTimeout(() => {
                    try {
                        process.kill('SIGKILL');
                    } catch {
                        // 进程已退出
                    }
                }, 3000);

                process.once('exit', () => {
                    clearTimeout(killTimer);
                });
            }
        } catch (e) {
            // 进程可能已退出，忽略错误
            if (!e.message.includes('Process already exited') && !e.message.includes('not found')) {
                this.logger.debug('PTY 进程终止', {
                    sessionId: this.sessionId,
                    terminalId,
                    note: '进程可能已退出'
                });
            }
        }
    }

    /**
     * 发送消息到客户端
     * @private
     * @param {string} type
     * @param {object} data
     */
    _sendToClient(type, data) {
        try {
            if (this.ws.readyState === 1) { // WebSocket.OPEN
                this.ws.send(JSON.stringify({ type, ...data }));
            }
        } catch (e) {
            this.logger.error('发送消息到客户端失败', {
                sessionId: this.sessionId,
                error: e.message
            });
        }
    }

    /**
     * 清理单个会话
     * @private
     * @param {string} terminalId
     */
    _cleanupSession(terminalId) {
        this.sessions.delete(terminalId);
    }
}

module.exports = TerminalSessionManager;
