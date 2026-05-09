const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const logger = require('./logger');
const { AUDIT_TYPES } = require('./logger');
const TerminalSessionManager = require('./terminal-manager');
const ServiceContainer = require('./services');

// ============================================
// 初始化服务容器
// ============================================
const services = new ServiceContainer(logger);
const config = services.config;

logger.info('='.repeat(80));
logger.info('AiTerm 启动中...');
logger.info('时间: ' + new Date().toISOString());
logger.info('='.repeat(80));

const app = express();
const server = http.createServer(app);

// ============================================
// 中间件
// ============================================

// CORS 配置 - 只允许配置的源
const allowedOrigins = config.get('security.allowedOrigins') || [
    `http://127.0.0.1:${config.get('server.port')}`,
    `http://localhost:${config.get('server.port')}`
];

app.use((req, res, next) => {
    const origin = req.headers.origin;

    // 只允许配置的源，不允许通配符
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// 安全响应头
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy - 限制资源加载（移除 unsafe-eval 防止 XSS）
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "font-src 'self' data:; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' ws: wss:; " +
        "worker-src 'self' blob:;"
    );
    next();
});

// 静态文件服务 - 仅暴露必要的公开目录
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// 前端模块目录（ES modules）
const frontendDir = path.join(__dirname, 'frontend');
app.use('/frontend', express.static(frontendDir, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

// node_modules 目录（前端依赖）
const nodeModulesDir = path.join(__dirname, 'node_modules');
app.use('/node_modules', express.static(nodeModulesDir, {
    etag: true,
    lastModified: true,
    maxAge: '1d', // 依赖文件可缓存 1 天
    setHeaders: (res, filepath) => {
        // 根据文件类型设置正确的 MIME 类型
        if (filepath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filepath.endsWith('.js') || filepath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// 根路径返回 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});
app.use(express.json({ limit: '1mb' }));

// HTTP 速率限制中间件
const httpRateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 分钟
const RATE_LIMIT_MAX = 100; // 每窗口最大请求数

// 定期清理过期的速率限制记录（每 5 分钟）
const httpRateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [ip, record] of httpRateLimits) {
        if (now > record.resetAt) {
            httpRateLimits.delete(ip);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug('清理过期速率限制记录', { cleaned, remaining: httpRateLimits.size });
    }
}, 5 * 60 * 1000);

// 速率限制中间件 - 仅限制 API 请求，不限制静态文件
app.use((req, res, next) => {
    // 跳过静态文件请求
    if (req.path.startsWith('/node_modules/') || 
        req.path.startsWith('/frontend/') ||
        req.path.startsWith('/public/') ||
        req.path === '/' ||
        req.path.endsWith('.css') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.mjs') ||
        req.path.endsWith('.json')) {
        return next();
    }
    
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    let record = httpRateLimits.get(clientIp);
    if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
        httpRateLimits.set(clientIp, record);
    }

    record.count++;

    if (record.count > RATE_LIMIT_MAX) {
        logger.warn('HTTP 速率限制触发', { ip: clientIp, count: record.count });
        return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }

    next();
});

// HTTP 请求日志中间件
app.use((req, res, next) => {
    const start = Date.now();
    logger.http('请求开始', { method: req.method, url: req.url, ip: req.ip });

    const originalSend = res.send;
    res.send = function (data) {
        const duration = Date.now() - start;
        logger.http('请求完成', { method: req.method, url: req.url, statusCode: res.statusCode, durationMs: duration });
        return originalSend.apply(res, arguments);
    };

    next();
});

// ============================================
// 路由 - 页面
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 路由 - Ollama API
// ============================================
app.get('/api/ollama/models', async (req, res) => {
    try {
        const data = await services.ollama.getModels();
        res.json(data);
    } catch (e) {
        logger.error('获取模型列表失败', { error: e.message });
        res.status(500).json({ error: '无法连接到 Ollama', message: e.message });
    }
});

// ============================================
// 路由 - 日志 API（异步，不阻塞事件循环）
// ============================================
app.get('/api/audit/logs', async (req, res) => {
    try {
        const logs = await services.logReader.getLogList('audit');
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: '无法获取日志列表' });
    }
});

app.get('/api/audit/logs/:filename', async (req, res) => {
    try {
        const result = await services.logReader.getLogContent('audit', req.params.filename);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: '无法获取日志内容' });
    }
});

app.get('/api/app/logs', async (req, res) => {
    try {
        const logs = await services.logReader.getLogList('app');
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: '无法获取日志列表' });
    }
});

app.get('/api/app/logs/:filename', async (req, res) => {
    try {
        const result = await services.logReader.getLogContent('app', req.params.filename);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: '无法获取日志内容' });
    }
});

// ============================================
// 路由 - CSRF Token
// ============================================
app.get('/api/csrf-token', (req, res) => {
    const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
    const token = services.security.generateCsrfToken(sessionId);
    res.json({ token, sessionId });
});

// ============================================
// 404 处理
// ============================================
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// ============================================
// 全局错误处理中间件（必须放在所有路由和404之后）
// ============================================
app.use((err, req, res, next) => {
    logger.error('未捕获的错误', { 
        error: err.message, 
        stack: err.stack,
        url: req.url,
        method: req.method
    });
    res.status(500).json({ error: '服务器内部错误' });
});

// ============================================
// WebSocket 服务器
// ============================================
const PORT = config.get('server.port');
const HOST = config.get('server.host');
let serverInitialized = false;

function initWebSocketServer(port) {
    if (serverInitialized) return;
    serverInitialized = true;

    logger.info('');
    logger.info('='.repeat(80));
    logger.info('AiTerm — Your AI-powered terminal.');
    logger.info(`已启动，访问: http://${HOST}:${port}`);
    logger.info('='.repeat(80));
    logger.info('');
    logger.info('使用说明:');
    logger.info('  - 左侧为完整的伪终端，支持交互命令、SSH 等');
    logger.info('  - 支持多个终端标签页');
    logger.info('  - 右侧为 AI 助手，支持与 Ollama 本地大模型对话');
    logger.info('  - 拖动中间分隔条可以调整左右面板比例');
    logger.info('');
    logger.info('调试日志已开启！详细日志文件见 ./logs/ 目录');
    logger.info('审计日志见 ./audit_logs/ 目录');
    logger.info('='.repeat(80));

    // TCP keepalive：30 秒初始延迟，防止半开连接堆积
    server.keepAliveInitialDelay = 30000;
    server.headersTimeout = 60000;
    server.requestTimeout = 300000;

    const wss = new WebSocket.Server({
        server,
        maxPayload: 1024 * 1024,
        clientTracking: true
    });
    
    // 保存引用用于优雅关闭
    wssInstance = wss;

    // 定期清理僵尸连接（每 60 秒）
    const cleanupInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                if (!ws._isAlive) {
                    ws.terminate();
                    return;
                }
                ws._isAlive = false;
                ws.ping();
            }
        });
    }, 60000);

    wss.on('close', () => {
        clearInterval(cleanupInterval);
    });

    wss.on('connection', (ws, req) => {
        const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        logger.info('WebSocket 新连接建立', { sessionId, ip: req.socket.remoteAddress });
        logger.audit(sessionId, AUDIT_TYPES.WEBSOCKET_CONNECT, {});

        ws._isAlive = true;
        ws.on('pong', () => { ws._isAlive = true; });

        // 标记认证状态
        ws._authenticated = !services.security.config.get('security.enabled');

        const terminalManager = new TerminalSessionManager(ws, logger, config, services.security, sessionId);
        let ollamaAbortController = null;

        ws.on('message', (message) => {
            ws._isAlive = true;

            let data;
            try {
                data = JSON.parse(message);
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', message: '消息格式无效' }));
                return;
            }

            // 认证消息处理（不需要已认证状态）
            if (data.type === 'auth') {
                services.security.createSession(sessionId, data.password || '').then(result => {
                    if (result.success) {
                        ws._authenticated = true;
                        ws.send(JSON.stringify({ type: 'auth_success', token: result.token }));
                    } else {
                        ws.send(JSON.stringify({ type: 'auth_failed', message: result.error }));
                    }
                });
                return;
            }

            // 所有非 auth 消息必须先通过认证检查
            if (!ws._authenticated) {
                ws.send(JSON.stringify({ type: 'auth_required', message: '请先登录' }));
                return;
            }

            // 速率限制检查
            const rateCheck = services.security.checkRateLimit(sessionId);
            if (!rateCheck.allowed) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `请求过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`
                }));
                return;
            }

            // 消息格式验证
            const validation = services.security.validateMessage(data);
            if (!validation.valid) {
                ws.send(JSON.stringify({ type: 'error', message: validation.error }));
                return;
            }

            logger.debug('收到 WebSocket 消息', { sessionId, type: data.type });

            switch (data.type) {
                case 'create_pty':
                    terminalManager.createSession(data.terminalId, data.cols || 80, data.rows || 24);
                    break;
                case 'close_pty':
                    terminalManager.closeSession(data.terminalId);
                    break;
                case 'pty_input':
                    // 审计日志不记录完整输入（可能包含密码），只记录输入长度和类型
                    const inputType = data.data.includes('\r') ? 'command' : 'input';
                    logger.audit(sessionId, AUDIT_TYPES.TERMINAL_INPUT, { 
                        type: inputType, 
                        length: data.data.length,
                        terminalId: data.terminalId 
                    });
                    terminalManager.sendInput(data.terminalId, data.data);
                    break;
                case 'pty_resize':
                    terminalManager.resize(data.terminalId, data.cols, data.rows);
                    break;
                case 'ollama_chat':
                    if (ollamaAbortController) ollamaAbortController.abort();
                    ollamaAbortController = new AbortController();
                    // 注入最近执行的命令历史作为上下文
                    const recentCommands = terminalManager.getRecentCommandHistory(5);
                    services.ollama.chat({
                        sessionId,
                        prompt: data.prompt,
                        model: data.model,
                        signal: ollamaAbortController.signal,
                        commandHistory: recentCommands,
                        onStart: () => ws.send(JSON.stringify({ type: 'ollama_start' })),
                        onChunk: (fullText) => ws.send(JSON.stringify({ type: 'ollama_chunk', data: fullText })),
                        onEnd: () => { ollamaAbortController = null; ws.send(JSON.stringify({ type: 'ollama_end' })); },
                        onError: (err) => { ollamaAbortController = null; ws.send(JSON.stringify({ type: 'error', message: err.message })); }
                    });
                    break;
                case 'ollama_clear':
                    services.ollama.clearConversation(sessionId);
                    ws.send(JSON.stringify({ type: 'ollama_cleared' }));
                    break;
                default:
                    logger.warn('未知消息类型', { sessionId, type: data.type });
            }
        });

        ws.on('close', (code, reason) => {
            logger.info('WebSocket 连接关闭', { sessionId, code, reason: reason?.toString() });
            if (ollamaAbortController) { ollamaAbortController.abort(); ollamaAbortController = null; }
            terminalManager.cleanup();
            services.ollama.clearConversation(sessionId);
            services.security.destroySession(sessionId);
            logger.audit(sessionId, AUDIT_TYPES.WEBSOCKET_DISCONNECT, { code });
            logger.audit(sessionId, AUDIT_TYPES.SESSION_CLOSE, {});
        });

        ws.on('error', (err) => {
            logger.error('WebSocket 错误', { sessionId, error: err.message });
            if (ollamaAbortController) { ollamaAbortController.abort(); ollamaAbortController = null; }
            terminalManager.cleanup();
        });
    });
}

let serverStartAttempts = 0;
const MAX_SERVER_START_ATTEMPTS = 10;

function startServer(port) {
    serverStartAttempts++;
    if (serverStartAttempts > MAX_SERVER_START_ATTEMPTS) {
        logger.error(`无法找到可用端口，已尝试 ${MAX_SERVER_START_ATTEMPTS} 次`);
        process.exit(1);
    }
    
    server.listen(port, HOST, () => {
        initWebSocketServer(port);
    }).once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.warn(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            startServer(port + 1);
        } else {
            logger.error('服务器启动失败', { error: err.message, stack: err.stack });
            process.exit(1);
        }
    });
}

// WebSocket Server 引用（用于优雅关闭）
let wssInstance = null;

// 优雅退出
function gracefulShutdown(signal) {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
    
    // 0. 清理 HTTP 速率限制定时器
    clearInterval(httpRateLimitCleanupTimer);
    
    // 1. 先关闭所有 WebSocket 连接
    if (wssInstance) {
        wssInstance.clients.forEach((ws) => {
            try {
                ws.close(1001, 'Server shutting down');
            } catch {
                ws.terminate();
            }
        });
    }
    
    // 2. 销毁服务
    services.destroy();
    
    // 3. 关闭 HTTP 服务器
    const shutdownTimer = setTimeout(() => {
        logger.warn('强制关闭服务器（超时）');
        process.exit(1);
    }, 5000);
    
    server.close(() => {
        clearTimeout(shutdownTimer);
        logger.info('服务器已关闭');
        process.exit(0);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Windows 下 SIGINT 可能不会触发，额外监听 exit
if (process.platform === 'win32') {
    process.on('exit', () => {
        if (wssInstance) {
            wssInstance.clients.forEach((ws) => {
                try { ws.terminate(); } catch {}
            });
        }
    });
}

startServer(PORT);
