'use strict';

const { AUDIT_TYPES } = require('../logger');
const os = require('os');
const { execSync } = require('child_process');

/** @type {number} AI 请求超时时间（毫秒） */
const AI_REQUEST_TIMEOUT = 60000;

/** @type {number} 连接超时时间（毫秒） */
const CONNECTION_TIMEOUT = 5000;

/**
 * 获取终端环境上下文信息
 * 参考 Warp 的 9 种 AIAgentContext 设计
 * @returns {string} 格式化的环境上下文描述
 */
function getEnvironmentContext() {
    const parts = [];

    // 1. 操作系统信息
    parts.push(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
    parts.push(`Hostname: ${os.hostname()}`);
    parts.push(`Home: ${os.homedir()}`);

    // 2. Shell 类型
    const platform = os.platform();
    let shell = 'unknown';
    if (platform === 'win32') shell = 'PowerShell';
    else if (platform === 'darwin') shell = process.env.SHELL || 'zsh';
    else shell = process.env.SHELL || 'bash';
    parts.push(`Shell: ${shell}`);

    // 3. Node.js 版本
    parts.push(`Node.js: ${process.version}`);

    // 4. 当前工作目录
    try {
        const cwd = process.cwd();
        parts.push(`CWD: ${cwd}`);
    } catch {}

    // 5. Git 信息（轻量级，不执行重量操作）
    try {
        const branch = execSync('git branch --show-current 2>/dev/null', {
            encoding: 'utf-8',
            timeout: 2000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (branch) {
            parts.push(`Git branch: ${branch}`);
        }
    } catch {
        // 不在 git 仓库中，忽略
    }

    // 6. 当前时间
    parts.push(`Time: ${new Date().toISOString()}`);

    return parts.join('\n');
}

/**
 * Ollama AI 对话服务
 * 负责与 Ollama API 通信，管理对话上下文
 */
class OllamaService {
    /**
     * @param {import('./config')} configService
     * @param {import('../logger')} logger
     */
    constructor(configService, logger) {
        this.config = configService;
        this.logger = logger;
        /** @type {Map<string, Array<{role: string, content: string}>>} */
        this.conversations = new Map();
        this.maxContextLength = this.config.get('maxContextLength') || 50; // 减少保留的消息数，给更多 token 空间
        
        // 设置对话数量上限和清理定时器
        this.maxConversations = 100; // 最多同时维护 100 个对话
        this.conversationTimeout = 30 * 60 * 1000; // 30 分钟不活跃清理
        this.lastActivity = new Map(); // 记录每个对话的最后活跃时间
        
        // 启动清理定时器
        this._cleanupTimer = setInterval(() => {
            this._cleanupExpiredConversations();
        }, 5 * 60 * 1000); // 每 5 分钟清理一次
    }
    
    /**
     * 清理过期对话
     * @private
     */
    _cleanupExpiredConversations() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [sessionId, lastTime] of this.lastActivity.entries()) {
            if (now - lastTime > this.conversationTimeout) {
                this.conversations.delete(sessionId);
                this.lastActivity.delete(sessionId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            this.logger.debug('清理过期对话', { cleanedCount, remaining: this.conversations.size });
        }
        
        // 如果对话数量超过上限，清理最旧的
        if (this.conversations.size > this.maxConversations) {
            const sortedByActivity = [...this.lastActivity.entries()]
                .sort((a, b) => a[1] - b[1]);
            const toRemove = sortedByActivity.slice(0, this.conversations.size - this.maxConversations);
            
            for (const [sessionId] of toRemove) {
                this.conversations.delete(sessionId);
                this.lastActivity.delete(sessionId);
            }
            
            this.logger.debug('清理超额对话', { removed: toRemove.length, remaining: this.conversations.size });
        }
    }

    /**
     * 获取可用模型列表
     * @returns {Promise<{ models: Array<{name: string, size?: number}> }>}
     */
    async getModels() {
        const baseUrl = this.config.get('ollama.baseUrl');
        const url = `${baseUrl}/api/tags`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw this._createError(response.status, '获取模型列表');
            }

            const data = await response.json();
            return { models: data.models || [] };
        } catch (error) {
            clearTimeout(timeoutId);
            throw this._classifyError(error, '获取模型列表');
        }
    }

    /**
     * 发送聊天消息（流式响应）
     * @param {object} params
     * @param {string} params.sessionId
     * @param {string} params.prompt
     * @param {string} [params.model]
     * @param {AbortSignal} [params.signal] - 外部取消信号（连接断开时触发）
     * @param {Function} params.onChunk - 收到文本块时的回调 (fullText: string) => void
     * @param {Function} params.onStart - 开始响应时的回调 () => void
     * @param {Function} params.onEnd - 响应结束时的回调 () => void
     * @param {Function} params.onError - 错误时的回调 (error: Error) => void
     */
    async chat({ sessionId, prompt, model, signal, commandHistory, onChunk, onStart, onEnd, onError }) {
        const baseUrl = this.config.get('ollama.baseUrl');
        const url = `${baseUrl}/api/chat`;
        const useModel = model || this.config.get('ollama.defaultModel');

        this.logger.info('AI 请求', {
            sessionId,
            model: useModel,
            promptPreview: prompt.substring(0, 100)
        });
        this.logger.audit(sessionId, AUDIT_TYPES.AI_REQUEST, {
            promptLength: prompt.length,
            promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
            model: useModel
        });

        // 管理对话上下文
        if (!this.conversations.has(sessionId)) {
            // 构建包含环境上下文的 System Prompt
            const envContext = getEnvironmentContext();
            const systemPrompt = [
                '你是 AiTerm 的智能终端助手，直接集成在用户的终端环境中。',
                '你的名字是 AiTerm，请始终以这个身份回应用户。',
                '',
                '## 语言规则（最重要）',
                '- 用户用什么语言提问，你就用什么语言回复',
                '- 如果用户用中文提问，必须用中文回复',
                '- 如果用户用英文提问，用英文回复',
                '',
                '## 回复质量要求',
                '- 回复要详尽完整，不要敷衍或过度简短',
                '- 对于技术问题，给出完整的解释、代码示例和步骤说明',
                '- 代码块必须包含完整的、可运行的代码',
                '- 解释概念时要深入，不要只给表面答案',
                '- 如果问题复杂，分步骤详细说明',
                '',
                '## 当前环境信息',
                '```',
                envContext,
                '```',
                '',
                '## 格式指南',
                '- 支持 Markdown 格式回复（代码块请标注语言）',
                '- 对于代码问题，给出完整可运行的代码示例',
                '- 对于命令行问题，解释命令的作用和参数',
                '- 利用环境信息给出准确的、针对当前系统的回答',
            ].join('\n');

            this.conversations.set(sessionId, [
                {
                    role: 'system',
                    content: systemPrompt
                }
            ]);
        }

        // 更新最后活跃时间
        this.lastActivity.set(sessionId, Date.now());

        const messages = this.conversations.get(sessionId);

        // 注入最近执行的命令历史作为上下文（如果有）
        if (commandHistory && commandHistory.length > 0) {
            const historyText = commandHistory
                .map((cmd, i) => {
                    const outputPreview = cmd.output
                        ? `\n输出:\n${cmd.output.length > 500 ? cmd.output.substring(0, 500) + '...' : cmd.output}`
                        : '（无输出）';
                    return `${i + 1}. $ ${cmd.input}${outputPreview}`;
                })
                .join('\n\n');

            // 将命令历史作为系统上下文注入（不占用 user 消息轮次）
            messages.push({
                role: 'system',
                content: `## 用户最近在终端中执行的命令\n\n${historyText}\n\n如果用户的问题与这些命令相关，请参考这些命令及其输出进行回答。`
            });
        }

        messages.push({ role: 'user', content: prompt });

        // 限制上下文长度，保留第一个 system message
        while (messages.length > this.maxContextLength) {
            // 如果第一条是 system message，从第二条开始删除
            const startIndex = messages[0]?.role === 'system' ? 1 : 0;
            if (startIndex < messages.length) {
                messages.splice(startIndex, 1);
            } else {
                // 防止无限循环
                break;
            }
        }

        // 创建超时控制器
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            const error = new Error('AI 响应超时，请稍后重试');
            this.logger.warn('AI 请求超时', { sessionId, timeout: AI_REQUEST_TIMEOUT });
            this.logger.audit(sessionId, AUDIT_TYPES.AI_ERROR, { error: '请求超时' });
            if (onError) onError(error);
        }, AI_REQUEST_TIMEOUT);

        // 外部信号（连接断开）联动内部超时控制器
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timeoutId);
                return;
            }
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                controller.abort();
            }, { once: true });
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: useModel,
                    messages,
                    stream: true
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw this._createError(response.status, 'AI 对话', useModel);
            }

            // 清除连接超时，开始流式读取
            clearTimeout(timeoutId);

            if (onStart) onStart();

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullReply = '';
            let buffer = '';
            let chunkCount = 0;

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
                        if (result.message?.content) {
                            fullReply += result.message.content;
                            if (onChunk) onChunk(fullReply);
                            chunkCount++;
                        }
                    } catch (parseErr) {
                        this.logger.warn('解析流式响应行失败', { error: parseErr.message });
                    }
                }
            }

            // 处理剩余 buffer
            if (buffer.trim()) {
                try {
                    const result = JSON.parse(buffer);
                    if (result.message?.content) {
                        fullReply += result.message.content;
                        if (onChunk) onChunk(fullReply);
                    }
                } catch (parseErr) {
                    this.logger.warn('解析剩余 buffer 失败', { error: parseErr.message });
                }
            }

            // 保存 AI 回复到上下文
            messages.push({ role: 'assistant', content: fullReply });

            this.logger.info('AI 回复完成', { sessionId, length: fullReply.length, chunks: chunkCount });
            this.logger.audit(sessionId, AUDIT_TYPES.AI_RESPONSE, { replyLength: fullReply.length });

            if (onEnd) onEnd();

        } catch (error) {
            clearTimeout(timeoutId);

            // 如果是超时错误，已经处理过了
            if (error.name === 'AbortError') {
                if (onEnd) onEnd();
                return;
            }

            const classifiedError = this._classifyError(error, 'AI 对话');
            this.logger.error('Ollama 请求失败', { sessionId, error: classifiedError.message });
            this.logger.audit(sessionId, AUDIT_TYPES.AI_ERROR, { error: classifiedError.message });
            if (onError) onError(classifiedError);
        }
    }

    /**
     * 创建友好的错误信息
     * @private
     * @param {number} status - HTTP 状态码
     * @param {string} operation - 操作名称
     * @param {string} [model] - 模型名称
     * @returns {Error}
     */
    _createError(status, operation, model) {
        if (status === 404) {
            return new Error(model
                ? `模型 "${model}" 不存在。运行 ollama list 查看可用模型。`
                : 'Ollama API 端点不存在，请检查 Ollama 版本。'
            );
        }
        if (status === 503) {
            return new Error('Ollama 服务繁忙，模型可能正在加载中，请稍后重试。');
        }
        if (status >= 500) {
            return new Error(`Ollama 服务错误 (${status})，请检查 Ollama 日志。`);
        }
        return new Error(`Ollama ${operation}失败: HTTP ${status}`);
    }

    /**
     * 分类并转换错误
     * @private
     * @param {Error} error - 原始错误
     * @param {string} operation - 操作名称
     * @returns {Error}
     */
    _classifyError(error, operation) {
        const msg = error.message?.toLowerCase() || '';

        // 连接错误
        if (msg.includes('econnrefused') || msg.includes('connect econnrefused')) {
            return new Error('无法连接到 Ollama 服务。请确认 Ollama 正在运行（执行 ollama serve）。');
        }
        if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
            return new Error('无法解析 Ollama 服务地址，请检查网络或配置。');
        }
        if (msg.includes('etimedout') || msg.includes('timeout')) {
            return new Error('连接 Ollama 超时，请检查服务状态或网络。');
        }
        if (msg.includes('network') || msg.includes('fetch failed')) {
            return new Error('网络错误，无法访问 Ollama 服务。');
        }

        // 超时错误
        if (error.name === 'AbortError' || msg.includes('abort')) {
            return new Error(`${operation}超时，请稍后重试。`);
        }

        return error;
    }

    /**
     * 清理会话对话上下文
     * @param {string} sessionId
     */
    clearConversation(sessionId) {
        this.conversations.delete(sessionId);
    }

    /**
     * 获取会话上下文信息
     * @param {string} sessionId
     * @returns {{ messageCount: number, contextLength: number }}
     */
    getContextInfo(sessionId) {
        const messages = this.conversations.get(sessionId);
        return {
            messageCount: messages ? messages.length : 0,
            contextLength: messages ? messages.reduce((sum, m) => sum + m.content.length, 0) : 0
        };
    }

    /**
     * 销毁服务，清理资源
     */
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this.conversations.clear();
        this.lastActivity.clear();
    }
}

module.exports = OllamaService;
