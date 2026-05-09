'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');

/**
 * 高危命令正则表达式模式
 * 基于语义分析而非简单字符串匹配
 */
const HIGH_RISK_PATTERNS = [
    // 破坏性删除
    /\brm\s+(-[rfRF]+\s+)?\/\s*$/m,
    /\brm\s+(-[rfRF]+\s+)?\/\S/m,
    /\brm\s+(-[rfRF]+\s+)-\*?\s*$/m,
    // 磁盘操作
    /\bdd\s+.*of=\/dev\/(sd|hd|nvme|vd|loop)/m,
    /\bmkfs\b/m,
    /\bwipefs\b/m,
    /\bparted\b/m,
    /\bfdisk\b/m,
    /\bsfdisk\b/m,
    /\bgdisk\b/m,
    // 系统控制
    /\breboot\b/m,
    /\bshutdown\b/m,
    /\bhalt\b/m,
    /\bpoweroff\b/m,
    /\binit\s+[06]\b/m,
    // Fork 炸弹
    /:\(\)\{\s*:\|:\s*&\s*\}\s*;/m,
    // 权限危险操作
    /\bchmod\s+(-R\s+)?777\s+\/\S/m,
    // 覆盖关键文件
    /\bmv\s+.*\/\s*$/m,
    /\bcp\s+.*\/dev\/null/m,
];

/** bcrypt 盐轮数 */
const BCRYPT_ROUNDS = 10;

/**
 * 安全服务 - 负责命令过滤、输入验证、会话认证、CSRF 防护
 */
class SecurityService {
    /**
     * @param {import('./config')} configService
     * @param {import('../logger')} logger
     */
    constructor(configService, logger) {
        this.config = configService;
        this.logger = logger;
        /** @type {Map<string, { createdAt: number, lastActivity: number, csrfToken?: string }>} */
        this.sessions = new Map();
        /** @type {Map<string, { count: number, resetAt: number }>} */
        this.rateLimits = new Map();
        
        // 定期清理过期的速率限制记录（每 5 分钟）
        this._rateLimitCleanupTimer = setInterval(() => {
            this.cleanupExpiredRateLimits();
        }, 5 * 60 * 1000);
    }
    
    /**
     * 销毁服务，清理资源
     */
    destroy() {
        if (this._rateLimitCleanupTimer) {
            clearInterval(this._rateLimitCleanupTimer);
            this._rateLimitCleanupTimer = null;
        }
        this.sessions.clear();
        this.rateLimits.clear();
    }
    
    /**
     * 清理过期的速率限制记录
     */
    cleanupExpiredRateLimits() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, record] of this.rateLimits) {
            if (now > record.resetAt) {
                this.rateLimits.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.debug('清理过期速率限制记录', { cleaned, remaining: this.rateLimits.size });
        }
    }

    /**
     * 生成 CSRF Token
     * @param {string} sessionId
     * @returns {string} CSRF Token
     */
    generateCsrfToken(sessionId) {
        const token = crypto.randomBytes(32).toString('hex');
        const session = this.sessions.get(sessionId);
        if (session) {
            session.csrfToken = token;
        }
        return token;
    }

    /**
     * 验证 CSRF Token
     * @param {string} sessionId
     * @param {string} token
     * @returns {boolean}
     */
    validateCsrfToken(sessionId, token) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.csrfToken) {
            return false;
        }
        // 先比较长度，防止 timingSafeEqual 因长度不等抛出异常
        if (session.csrfToken.length !== token.length) {
            return false;
        }
        try {
            const valid = crypto.timingSafeEqual(
                Buffer.from(session.csrfToken, 'hex'),
                Buffer.from(token, 'hex')
            );
            return valid;
        } catch (e) {
            return false;
        }
    }

    /**
     * 检测高危命令
     * @param {string} input - 用户输入的命令
     * @returns {{ isHighRisk: boolean, matchedPattern: string|null, reason: string }}
     */
    checkCommand(input) {
        if (!input || typeof input !== 'string') {
            return { isHighRisk: false, matchedPattern: null, reason: '' };
        }

        for (const pattern of HIGH_RISK_PATTERNS) {
            if (pattern.test(input)) {
                const reason = `匹配高危命令模式: ${pattern.source}`;
                this.logger.warn('高危命令拦截', { input: input.substring(0, 200), pattern: pattern.source });
                return { isHighRisk: true, matchedPattern: pattern.source, reason };
            }
        }

        return { isHighRisk: false, matchedPattern: null, reason: '' };
    }

    /**
     * 验证 WebSocket 消息
     * @param {unknown} data - 原始消息数据
     * @returns {{ valid: boolean, error?: string, data?: object }}
     */
    validateMessage(data) {
        if (!data || typeof data !== 'object') {
            return { valid: false, error: '消息格式无效' };
        }

        const allowedTypes = [
            'create_pty', 'close_pty', 'pty_input', 'pty_resize',
            'ollama_chat', 'ollama_clear', 'auth'
        ];

        if (!data.type || typeof data.type !== 'string') {
            return { valid: false, error: '缺少消息类型' };
        }

        if (!allowedTypes.includes(data.type)) {
            return { valid: false, error: `未知消息类型: ${data.type}` };
        }

        // 类型特定验证
        if (data.type === 'pty_input') {
            const maxLen = this.config.get('limits.maxCommandLength') || 10000;
            if (!data.data || typeof data.data !== 'string') {
                return { valid: false, error: '终端输入数据无效' };
            }
            if (data.data.length > maxLen) {
                return { valid: false, error: `输入过长，最大 ${maxLen} 字符` };
            }
        }

        if (data.type === 'ollama_chat') {
            if (!data.prompt || typeof data.prompt !== 'string') {
                return { valid: false, error: 'AI 提示词无效' };
            }
            if (data.prompt.length > 50000) {
                return { valid: false, error: '提示词过长' };
            }
        }

        if (data.type === 'create_pty' || data.type === 'pty_resize') {
            const cols = data.cols || 80;
            const rows = data.rows || 24;
            if (cols < 1 || cols > 500 || rows < 1 || rows > 200) {
                return { valid: false, error: '终端尺寸参数无效' };
            }
        }

        return { valid: true, data };
    }

    /**
     * 速率限制检查
     * @param {string} sessionId
     * @returns {{ allowed: boolean, retryAfterMs: number }}
     */
    checkRateLimit(sessionId) {
        const limits = this.config.get('limits.rateLimit');
        const now = Date.now();

        let record = this.rateLimits.get(sessionId);
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + (limits.windowMs || 60000) };
            this.rateLimits.set(sessionId, record);
        }

        record.count++;
        if (record.count > (limits.maxRequests || 120)) {
            return { allowed: false, retryAfterMs: record.resetAt - now };
        }
        return { allowed: true, retryAfterMs: 0 };
    }

    /**
     * 验证会话认证（如果启用）
     * @param {string} sessionId
     * @param {string} [token]
     * @returns {{ authenticated: boolean, error?: string }}
     */
    authenticate(sessionId, token) {
        if (!this.config.get('security.enabled')) {
            return { authenticated: true };
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
            return { authenticated: false, error: '会话不存在' };
        }

        const timeout = this.config.get('security.sessionTimeout') || 3600000;
        if (Date.now() - session.lastActivity > timeout) {
            this.sessions.delete(sessionId);
            return { authenticated: false, error: '会话已过期' };
        }

        session.lastActivity = Date.now();
        return { authenticated: true };
    }

    /**
     * 创建认证会话
     * @param {string} sessionId
     * @param {string} password
     * @returns {{ success: boolean, token?: string, error?: string }}
     */
    async createSession(sessionId, password) {
        const configuredPassword = this.config.get('security.password');
        
        // 如果没有配置密码，允许直接登录
        if (!configuredPassword) {
            return { success: true };
        }

        try {
            // 强制使用 bcrypt 比较，移除明文密码回退
            const isMatch = await bcrypt.compare(password, configuredPassword);
            if (!isMatch) {
                return { success: false, error: '密码错误' };
            }

            const token = crypto.randomBytes(32).toString('hex');
            this.sessions.set(sessionId, {
                token,
                createdAt: Date.now(),
                lastActivity: Date.now()
            });

            this.logger.info('会话认证成功', { sessionId });
            return { success: true, token };
        } catch (error) {
            this.logger.error('密码验证失败', { error: error.message });
            return { success: false, error: '认证失败' };
        }
    }

    /**
     * 生成密码哈希（用于初始化配置）
     * @param {string} password - 明文密码
     * @returns {Promise<string>} - bcrypt 哈希
     */
    static async hashPassword(password) {
        return bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    /**
     * 清理会话
     * @param {string} sessionId
     */
    destroySession(sessionId) {
        this.sessions.delete(sessionId);
        this.rateLimits.delete(sessionId);
    }

    /**
     * 清理过期会话（定时调用）
     */
    cleanupExpired() {
        const timeout = this.config.get('security.sessionTimeout') || 3600000;
        const now = Date.now();
        let cleaned = 0;

        for (const [id, session] of this.sessions) {
            if (now - session.lastActivity > timeout) {
                this.sessions.delete(id);
                cleaned++;
            }
        }

        // 清理过期的速率限制记录
        for (const [id, record] of this.rateLimits) {
            if (now > record.resetAt) {
                this.rateLimits.delete(id);
            }
        }

        if (cleaned > 0) {
            this.logger.debug('清理过期会话', { count: cleaned });
        }
    }
}

module.exports = SecurityService;
