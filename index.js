const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const logger = require('./logger');
const { AUDIT_TYPES } = require('./logger');
const TerminalSessionManager = require('./terminal-manager');

let config;
try {
    const configPath = path.join(__dirname, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    logger.info('配置文件加载成功');
} catch (e) {
    logger.error('配置文件加载失败，使用默认配置', { error: e.message });
    config = {
        server: { host: '127.0.0.1', port: 3000 },
        ollama: { baseUrl: 'http://127.0.0.1:11434', defaultModel: 'codellama:7b-instruct-q4_K_M' },
        security: { enabled: false, password: '', sessionTimeout: 3600000 },
        highRiskCommands: [],
        safeCommands: [],
        useWhitelist: false,
        maxContextLength: 100,
        ws: { maxReconnectAttempts: 5, reconnectDelayMs: 1000 }
    };
}

logger.info('='.repeat(80));
logger.info('AiTerm 启动中...');
logger.info('时间: ' + new Date().toISOString());
logger.info('='.repeat(80));

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
    const start = Date.now();
    logger.http('请求开始', { method: req.method, url: req.url, ip: req.ip, userAgent: req.get('user-agent') });
    
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - start;
        logger.http('请求完成', { method: req.method, url: req.url, statusCode: res.statusCode, durationMs: duration });
        return originalSend.apply(res, arguments);
    };
    
    next();
});

app.get('/', (req, res) => {
    logger.debug('首页访问');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/ollama/models', async (req, res) => {
    logger.info('请求获取 Ollama 模型列表');
    try {
        const ollamaUrl = `${config.ollama.baseUrl}/api/tags`;
        logger.debug('请求地址', { url: ollamaUrl });

        const ollamaRes = await fetch(ollamaUrl);
        logger.debug('Ollama 响应状态码', { status: ollamaRes.status });

        if (!ollamaRes.ok) {
            logger.error('Ollama 响应错误', { status: ollamaRes.status, statusText: ollamaRes.statusText });
            return res.status(ollamaRes.status).json({ error: '无法获取模型列表' });
        }

        const data = await ollamaRes.json();
        logger.verbose('收到模型列表', { models: data.models?.length });
        logger.debug('模型详情', { models: data.models });
        res.json({ models: data.models || [] });
    } catch (e) {
        logger.error('获取模型列表失败', { error: e.message, stack: e.stack });
        res.status(500).json({ error: '无法连接到 Ollama', message: e.message });
    }
});

app.get('/api/audit/logs', (req, res) => {
    logger.info('请求获取审计日志列表');
    try {
        const files = fs.readdirSync(logger.AUDIT_LOG_DIR)
            .filter(file => file.endsWith('.log'))
            .map(file => ({
                name: file,
                size: fs.statSync(path.join(logger.AUDIT_LOG_DIR, file)).size,
                modified: fs.statSync(path.join(logger.AUDIT_LOG_DIR, file)).mtime
            }))
            .sort((a, b) => b.modified - a.modified);

        res.json({ logs: files });
    } catch (e) {
        logger.error('获取审计日志列表失败', { error: e.message });
        res.status(500).json({ error: '无法获取日志列表' });
    }
});

app.get('/api/audit/logs/:filename', (req, res) => {
    logger.info('请求获取审计日志内容', { filename: req.params.filename });
    try {
        const filePath = path.join(logger.AUDIT_LOG_DIR, req.params.filename);
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ content, filename: req.params.filename });
    } catch (e) {
        logger.error('获取审计日志内容失败', { error: e.message, filename: req.params.filename });
        res.status(500).json({ error: '无法获取日志内容' });
    }
});

app.get('/api/app/logs', (req, res) => {
    logger.info('请求获取应用日志列表');
    try {
        const files = fs.readdirSync(logger.LOG_DIR)
            .filter(file => file.endsWith('.log'))
            .map(file => ({
                name: file,
                size: fs.statSync(path.join(logger.LOG_DIR, file)).size,
                modified: fs.statSync(path.join(logger.LOG_DIR, file)).mtime
            }))
            .sort((a, b) => b.modified - a.modified);

        res.json({ logs: files });
    } catch (e) {
        logger.error('获取应用日志列表失败', { error: e.message });
        res.status(500).json({ error: '无法获取日志列表' });
    }
});

app.get('/api/app/logs/:filename', (req, res) => {
    logger.info('请求获取应用日志内容', { filename: req.params.filename });
    try {
        const filePath = path.join(logger.LOG_DIR, req.params.filename);
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ content, filename: req.params.filename });
    } catch (e) {
        logger.error('获取应用日志内容失败', { error: e.message, filename: req.params.filename });
        res.status(500).json({ error: '无法获取日志内容' });
    }
});

async function handleOllamaChat(data, ws, sessionId) {
    try {
        const ollamaUrl = `${config.ollama.baseUrl}/api/chat`;
        logger.info('发送请求到 Ollama', { url: ollamaUrl, model: data.model || '默认模型' });
        logger.debug('Ollama 请求详情', { prompt: data.prompt, stream: true });

        const requestBody = {
            model: data.model || config.ollama.defaultModel,
            messages: [
                {
                    role: 'system',
                    content: '你是一个专业的运维助手。用户会询问运维相关问题，请简洁、准确地回答。'
                },
                { role: 'user', content: data.prompt }
            ],
            stream: true
        };

        logger.debug('开始 fetch 请求 (流式)...');
        const ollamaRes = await fetch(ollamaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        logger.debug('Ollama 响应状态', { status: ollamaRes.status, statusText: ollamaRes.statusText });
        if (!ollamaRes.ok) {
            const errorText = await ollamaRes.text();
            logger.error('Ollama 响应错误', { errorText, status: ollamaRes.status });
            let friendlyMsg = `Ollama 响应错误: ${ollamaRes.status} ${ollamaRes.statusText}`;
            if (ollamaRes.status === 404) {
                friendlyMsg = `Ollama 404 错误！请确认模型存在或 Ollama API 端点正确。运行 ollama list 查看可用模型。`;
            }
            throw new Error(friendlyMsg);
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let fullReply = '';
        let buffer = '';
        let chunkCount = 0;

        ws.send(JSON.stringify({ type: 'ollama_start' }));

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const result = JSON.parse(line);
                    if (result.message && result.message.content) {
                        fullReply += result.message.content;
                        ws.send(JSON.stringify({ type: 'ollama_chunk', data: fullReply }));
                        chunkCount++;
                        
                        if (chunkCount % 20 === 0) {
                            logger.silly('流式响应进度', { sessionId, chunksReceived: chunkCount });
                        }
                    }
                } catch (e) {
                    logger.warn('解析流式响应行失败', { error: e.message, line: line });
                }
            }
        }

        if (buffer.trim()) {
            try {
                const result = JSON.parse(buffer);
                if (result.message && result.message.content) {
                    fullReply += result.message.content;
                    ws.send(JSON.stringify({ type: 'ollama_chunk', data: fullReply }));
                }
            } catch (e) {
                logger.warn('解析剩余 buffer 失败', { error: e.message });
            }
        }

        logger.info('AI 回复完成', { sessionId, bytes: fullReply.length, chunks: chunkCount });
        logger.verbose('完整 AI 回复', { sessionId, reply: fullReply });
        ws.send(JSON.stringify({ type: 'ollama_end' }));
        logger.audit(sessionId, AUDIT_TYPES.AI_RESPONSE, { replyLength: fullReply.length, reply: fullReply });
    } catch (e) {
        logger.error('Ollama 请求失败', { sessionId, error: e.message, stack: e.stack });
        let errorMsg = e.message;
        if (e.message.includes('fetch') || e.message.includes('ECONNREFUSED') || e.message.includes('connect')) {
            errorMsg = '无法连接到 Ollama！请确认 Ollama 正在本地运行。可以运行 ollama serve 启动服务。';
        }
        ws.send(JSON.stringify({ type: 'error', message: errorMsg }));
        logger.audit(sessionId, AUDIT_TYPES.AI_ERROR, { error: e.message });
    }
}

const PORT = config.server.port;
const HOST = config.server.host;

function startServer(port) {
    server.listen(port, HOST, () => {
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

        const wss = new WebSocket.Server({ server });

        wss.on('connection', (ws) => {
            const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
            logger.info('WebSocket 新连接建立', { sessionId });
            logger.audit(sessionId, AUDIT_TYPES.WEBSOCKET_CONNECT, {});

            // 使用专业的会话管理器
            const terminalManager = new TerminalSessionManager(ws, logger, config, sessionId);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    logger.debug('收到 WebSocket 消息', { sessionId, type: data.type });
                    logger.silly('WebSocket 消息详情', { sessionId, data });
                    
                    if (data.type === 'create_pty') {
                        terminalManager.createSession(data.terminalId, data.cols || 80, data.rows || 24);
                    } else if (data.type === 'close_pty') {
                        terminalManager.closeSession(data.terminalId);
                    } else if (data.type === 'pty_input') {
                        logger.audit(sessionId, AUDIT_TYPES.TERMINAL_INPUT, { input: data.data });
                        terminalManager.sendInput(data.terminalId, data.data);
                    } else if (data.type === 'pty_resize') {
                        terminalManager.resize(data.terminalId, data.cols, data.rows);
                    } else if (data.type === 'pty_clear') {
                        terminalManager.clearScreen(data.terminalId);
                    } else if (data.type === 'ollama_chat') {
                        logger.info('AI 请求', { sessionId, model: data.model || '默认模型', prompt: data.prompt.substring(0, 100) + '...' });
                        logger.audit(sessionId, AUDIT_TYPES.AI_REQUEST, { prompt: data.prompt, model: data.model });
                        handleOllamaChat(data, ws, sessionId);
                    } else {
                        logger.warn('未知消息类型', { sessionId, type: data.type });
                    }
                } catch (err) {
                    logger.error('消息处理异常', { sessionId, error: err.message, stack: err.stack });
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                    logger.audit(sessionId, AUDIT_TYPES.ERROR, { error: err.message });
                }
            });

            ws.on('close', () => {
                logger.info('WebSocket 连接关闭', { sessionId });
                terminalManager.cleanup();
                logger.audit(sessionId, AUDIT_TYPES.WEBSOCKET_DISCONNECT, {});
                logger.audit(sessionId, AUDIT_TYPES.SESSION_CLOSE, {});
                logger.info('会话清理完成', { sessionId });
            });

            ws.on('error', (err) => {
                logger.error('WebSocket 错误', { sessionId, error: err.message, stack: err.stack });
            });
        });
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.warn(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            startServer(port + 1);
        } else {
            logger.error('服务器启动失败', { error: err.message, stack: err.stack });
            throw err;
        }
    });
}

startServer(PORT);

