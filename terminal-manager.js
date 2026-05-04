const pty = require('node-pty');
const os = require('os');

/**
 * Terminal Session Manager
 * 参考 WebSSH2 架构的专业会话管理
 */
class TerminalSessionManager {
    constructor(ws, logger, config, sessionId) {
        this.ws = ws;
        this.logger = logger;
        this.config = config;
        this.sessionId = sessionId;
        this.sessions = new Map();
    }

    /**
     * 创建新的终端会话
     */
    createSession(terminalId, cols = 80, rows = 24) {
        this.logger.info('创建新终端会话', {
            sessionId: this.sessionId,
            terminalId,
            cols,
            rows
        });

        const shell = this._getDefaultShell();
        this.logger.debug('使用 Shell', { shell });

        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: process.cwd(),
            env: process.env
        });

        // 设置数据处理
        ptyProcess.onData((data) => {
            this.logger.silly('PTY 数据输出', {
                sessionId: this.sessionId,
                terminalId,
                dataLength: data.length
            });
            this._sendToClient('pty_data', { terminalId, data });
        });

        // 设置退出处理
        ptyProcess.onExit((code, signal) => {
            this.logger.info('PTY 进程退出', {
                sessionId: this.sessionId,
                terminalId,
                code,
                signal
            });
            this._cleanupSession(terminalId);
        });

        // 保存会话
        this.sessions.set(terminalId, {
            process: ptyProcess,
            terminalId,
            createdAt: Date.now()
        });

        return ptyProcess;
    }

    /**
     * 关闭终端会话
     */
    closeSession(terminalId) {
        const session = this.sessions.get(terminalId);
        if (session) {
            this.logger.info('关闭终端会话', { sessionId: this.sessionId, terminalId });
            try {
                session.process.kill();
                this.logger.info('PTY 进程已终止', { sessionId: this.sessionId, terminalId });
            } catch (e) {
                this.logger.error('终止 PTY 进程失败', {
                    sessionId: this.sessionId,
                    terminalId,
                    error: e.message
                });
            }
            this.sessions.delete(terminalId);
        }
    }

    /**
     * 发送输入到终端
     */
    sendInput(terminalId, data) {
        const session = this.sessions.get(terminalId);
        if (session) {
            this.logger.debug('终端输入', {
                sessionId: this.sessionId,
                terminalId,
                input: data
            });

            // 检查高危命令
            const isHighRisk = this.config.highRiskCommands.some(cmd =>
                data.toLowerCase().includes(cmd.toLowerCase())
            );

            if (isHighRisk) {
                this.logger.warn('检测到高危命令输入', { sessionId: this.sessionId, input: data });
                this._sendToClient('error', {
                    message: '检测到高危命令，已阻止执行。'
                });
            } else {
                session.process.write(data);
            }
        }
    }

    /**
     * 调整终端大小
     */
    resize(terminalId, cols, rows) {
        const session = this.sessions.get(terminalId);
        if (session) {
            this.logger.debug('终端调整大小', {
                sessionId: this.sessionId,
                terminalId,
                cols,
                rows
            });
            session.process.resize(cols, rows);
        }
    }

    /**
     * 清屏终端
     */
    clearScreen(terminalId) {
        const session = this.sessions.get(terminalId);
        if (session) {
            this.logger.debug('清屏终端', { sessionId: this.sessionId, terminalId });
            // 发送标准的 VT100 清屏序列
            session.process.write('\x1b[H\x1b[2J\x1b[3J');
        }
    }

    /**
     * 清理所有会话
     */
    cleanup() {
        this.logger.info('清理所有终端会话', { sessionId: this.sessionId });
        this.sessions.forEach((session, terminalId) => {
            try {
                session.process.kill();
                this.logger.info('PTY 进程已终止', { sessionId: this.sessionId, terminalId });
            } catch (e) {
                this.logger.error('终止 PTY 进程失败', {
                    sessionId: this.sessionId,
                    terminalId,
                    error: e.message
                });
            }
        });
        this.sessions.clear();
    }

    /**
     * 获取默认 shell
     * @private
     */
    _getDefaultShell() {
        const platform = os.platform();
        if (platform === 'win32') {
            return 'powershell.exe';
        } else if (platform === 'darwin') {
            return 'zsh';
        } else {
            return 'bash';
        }
    }

    /**
     * 发送消息到客户端
     * @private
     */
    _sendToClient(type, data) {
        try {
            this.ws.send(JSON.stringify({ type, ...data }));
        } catch (e) {
            this.logger.error('发送消息到客户端失败', {
                sessionId: this.sessionId,
                error: e.message
            });
        }
    }

    /**
     * 清理单个会话（内部方法）
     * @private
     */
    _cleanupSession(terminalId) {
        this.sessions.delete(terminalId);
    }
}

module.exports = TerminalSessionManager;