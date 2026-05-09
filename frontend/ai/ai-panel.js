/**
 * AI Panel - Modern DOM-based AI Chat Interface
 * Best practices: marked.js + highlight.js + native DOM
 */

import { marked } from '../../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../../node_modules/dompurify/dist/purify.es.mjs';

// Configure marked with code highlighting
marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
        if (typeof hljs !== 'undefined') {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        }
        return code;
    },
    langPrefix: 'hljs language-'
});

// XSS 清理配置
const purifyConfig = {
    ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'strike', 'del', 's',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'code', 'pre',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span'
    ],
    ALLOWED_ATTR: [
        'href', 'title', 'target', 'rel',
        'src', 'alt', 'width', 'height',
        'class', 'id', 'data-language'
    ],
    ALLOW_DATA_ATTR: false,
    SANITIZE_DOM: true
};

// Message store
let messages = [];
let isStreaming = false;
let currentStreamMessage = null;

// DOM Elements
let panelContainer = null;
let messagesContainer = null;
let inputContainer = null;
let inputField = null;
let sendButton = null;

/**
 * Initialize AI Panel
 */
export function initAIPanel(container) {
    panelContainer = container;
    panelContainer.innerHTML = '';
    
    // Create layout
    panelContainer.className = 'ai-panel';
    panelContainer.innerHTML = `
        <div class="ai-messages"></div>
        <div class="ai-input-area">
            <textarea class="ai-input" placeholder="输入消息... (Shift+Enter换行)" rows="1"></textarea>
            <button class="ai-send-btn">发送</button>
        </div>
    `;
    
    messagesContainer = panelContainer.querySelector('.ai-messages');
    inputContainer = panelContainer.querySelector('.ai-input-area');
    inputField = panelContainer.querySelector('.ai-input');
    sendButton = panelContainer.querySelector('.ai-send-btn');
    
    // Event listeners
    sendButton.addEventListener('click', handleSend);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Ctrl+V / Cmd+V 粘贴支持
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            // 浏览器默认处理粘贴
            return;
        }
    });
    inputField.addEventListener('input', autoResizeInput);
    
    // 支持粘贴事件，自动调整高度
    inputField.addEventListener('paste', (e) => {
        setTimeout(autoResizeInput, 0);
    });
    
    // Load persisted messages
    loadMessages();
    
    return {
        addMessage,
        updateStreamMessage,
        endStream,
        getMessages: () => messages
    };
}

/**
 * Add a new message
 */
function addMessage(type, content, metadata = {}) {
    const message = {
        id: generateId(),
        type, // 'user' | 'ai'
        content,
        timestamp: Date.now(),
        ...metadata
    };
    
    messages.push(message);
    renderMessage(message);
    scrollToBottom();
    persistMessages();
    
    return message.id;
}

/**
 * Update streaming message content
 */
function updateStreamMessage(content) {
    if (!currentStreamMessage) {
        currentStreamMessage = {
            id: generateId(),
            type: 'ai',
            content: '',
            timestamp: Date.now(),
            streaming: true
        };
        messages.push(currentStreamMessage);
        renderMessage(currentStreamMessage, true);
    }
    
    currentStreamMessage.content = content;
    updateMessageDOM(currentStreamMessage.id, content, true);
    scrollToBottom();
}

/**
 * End streaming
 */
function endStream() {
    if (currentStreamMessage) {
        currentStreamMessage.streaming = false;
        const el = document.getElementById(currentStreamMessage.id);
        if (el) {
            el.classList.remove('streaming');
            // Final render with complete markdown
            updateMessageDOM(currentStreamMessage.id, currentStreamMessage.content, false);
        }
        currentStreamMessage = null;
        persistMessages();
    }
}

/**
 * Render a message to DOM
 */
function renderMessage(message, isStream = false) {
    const el = document.createElement('div');
    el.id = message.id;
    el.className = `ai-message ai-message-${message.type}${isStream ? ' streaming' : ''}`;

    // 用户消息保留换行，使用 pre-wrap 样式
    let contentHtml;
    if (message.type === 'user') {
        // 转义 HTML 并保留换行
        const escaped = escapeHtml(message.content);
        contentHtml = `<div style="white-space: pre-wrap; word-wrap: break-word;">${escaped}</div>`;
    } else {
        const rawHtml = marked.parse(message.content);
        contentHtml = DOMPurify.sanitize(rawHtml, purifyConfig);
    }

    el.innerHTML = `
        <div class="ai-message-content">${contentHtml}</div>
        <div class="ai-message-meta">
            <span class="ai-message-time">${formatTime(message.timestamp)}</span>
            <button class="ai-copy-btn">复制</button>
        </div>
    `;

    const contentEl = el.querySelector('.ai-message-content');

    // Apply syntax highlighting to code blocks (仅 AI 消息)
    if (message.type === 'ai' && !isStream) {
        highlightCodeBlocks(el);
    }
    
    // Add copy functionality - 复制选中的文本或整个消息
    const copyBtn = el.querySelector('.ai-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const selection = window.getSelection();
            let textToCopy;
            
            if (selection && selection.toString().trim()) {
                // 如果有选中的文本，复制选中的部分
                textToCopy = selection.toString();
            } else {
                // 否则复制整个消息的纯文本内容
                textToCopy = contentEl.innerText || message.content;
            }
            
            navigator.clipboard.writeText(textToCopy).then(() => {
                copyBtn.textContent = '已复制';
                setTimeout(() => copyBtn.textContent = '复制', 2000);
            }).catch(err => {
                console.error('复制失败:', err);
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = textToCopy;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                copyBtn.textContent = '已复制';
                setTimeout(() => copyBtn.textContent = '复制', 2000);
            });
        });
    }
    
    // 双击选中段落
    contentEl.addEventListener('dblclick', (e) => {
        const selection = window.getSelection();
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
            selection.removeAllRanges();
            selection.addRange(range);
            // 扩展到单词边界
            selection.modify('move', 'backward', 'word');
            selection.modify('extend', 'forward', 'word');
        }
    });
    
    messagesContainer.appendChild(el);
}

/**
 * Update existing message DOM
 */
/**
 * 智能检测内容是否包含代码，如果没有代码块标记则自动添加
 */
function smartCodeDetection(content) {
    // 如果已经包含代码块标记，直接返回
    if (content.includes('```')) return content;
    
    // 检测是否包含代码特征（多行缩进、关键字、括号等）
    const lines = content.split('\n');
    let codeLines = 0;
    let hasCodeIndicators = false;
    
    const codePatterns = [
        /^\s*(def|class|import|from|function|const|let|var|if|for|while|return)\s/,
        /[{};]$/,
        /^\s{2,}/,  // 缩进
        /\(.*\):$/,  // Python 函数定义
    ];
    
    for (const line of lines) {
        if (codePatterns.some(p => p.test(line))) {
            codeLines++;
        }
        if (/^(import|from|def|class)\s/.test(line)) {
            hasCodeIndicators = true;
        }
    }
    
    // 如果超过3行像代码，且有代码指示器，则自动包裹为代码块
    if (codeLines >= 3 && hasCodeIndicators) {
        // 尝试检测语言
        let lang = '';
        if (/^(import|from|def|class)\s/.test(content)) lang = 'python';
        else if (/^(const|let|var|function)\s/.test(content)) lang = 'javascript';
        
        return `\`\`\`${lang}\n${content}\n\`\`\``;
    }
    
    return content;
}

function updateMessageDOM(id, content, isStream) {
    const el = document.getElementById(id);
    if (!el) return;

    const contentEl = el.querySelector('.ai-message-content');
    if (isStream) {
        // For streaming, show raw text with cursor
        contentEl.textContent = content;
        contentEl.classList.add('streaming-text');
    } else {
        // 智能代码检测 + markdown 渲染
        const processedContent = smartCodeDetection(content);
        const rawHtml = marked.parse(processedContent);
        contentEl.innerHTML = DOMPurify.sanitize(rawHtml, purifyConfig);
        contentEl.classList.remove('streaming-text');
        // Apply syntax highlighting
        highlightCodeBlocks(el);
    }
}

/**
 * Apply syntax highlighting to code blocks and add copy buttons
 */
function highlightCodeBlocks(container) {
    if (typeof hljs === 'undefined') return;
    container.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
        
        // 为代码块添加复制按钮
        const pre = block.parentElement;
        if (pre && !pre.querySelector('.code-copy-btn')) {
            // 创建包装器
            pre.style.position = 'relative';
            
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.textContent = '复制';
            copyBtn.style.cssText = `
                position: absolute;
                top: 8px;
                right: 8px;
                background: rgba(68, 71, 90, 0.8);
                border: none;
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                color: #f8f8f2;
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.2s;
            `;
            
            pre.appendChild(copyBtn);
            
            // 鼠标悬停时显示按钮
            pre.addEventListener('mouseenter', () => copyBtn.style.opacity = '1');
            pre.addEventListener('mouseleave', () => copyBtn.style.opacity = '0');
            
            // 复制功能
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(block.textContent).then(() => {
                    copyBtn.textContent = '已复制';
                    setTimeout(() => copyBtn.textContent = '复制', 2000);
                }).catch(() => {
                    // 降级方案
                    const textarea = document.createElement('textarea');
                    textarea.value = block.textContent;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    copyBtn.textContent = '已复制';
                    setTimeout(() => copyBtn.textContent = '复制', 2000);
                });
            });
        }
    });
}

/**
 * Handle send button click
 */
function handleSend() {
    const content = inputField.value.trim();
    if (!content || sendButton.disabled) return;
    
    // 禁用发送按钮，防止重复发送
    sendButton.disabled = true;
    sendButton.textContent = '思考中...';
    sendButton.style.opacity = '0.6';
    
    // Add user message
    addMessage('user', content);
    
    // Clear input
    inputField.value = '';
    autoResizeInput();
    
    // Trigger AI response (to be implemented with WebSocket)
    window.dispatchEvent(new CustomEvent('ai-send', { detail: { content } }));
}

/**
 * 恢复发送按钮状态
 */
export function enableSendButton() {
    if (sendButton) {
        sendButton.disabled = false;
        sendButton.textContent = '发送';
        sendButton.style.opacity = '1';
    }
}

/**
 * Auto-resize input textarea
 */
function autoResizeInput() {
    inputField.style.height = 'auto';
    inputField.style.height = Math.min(inputField.scrollHeight, 200) + 'px';
}

/**
 * Scroll to bottom of messages
 */
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Persist messages to localStorage with size limit
 */
const MAX_MESSAGES = 500; // 最多保留 500 条消息

function persistMessages() {
    try {
        // 限制消息数量，保留最新的
        if (messages.length > MAX_MESSAGES) {
            messages = messages.slice(-MAX_MESSAGES);
        }
        localStorage.setItem('ai_messages', JSON.stringify(messages));
    } catch (e) {
        console.warn('Failed to persist messages:', e);
        // 如果存储失败（超出配额），尝试清理旧消息
        if (e.name === 'QuotaExceededError' && messages.length > 100) {
            messages = messages.slice(-100); // 只保留最近 100 条
            try {
                localStorage.setItem('ai_messages', JSON.stringify(messages));
            } catch (e2) {
                console.error('Still failed after cleanup:', e2);
            }
        }
    }
}

/**
 * Load messages from localStorage with validation
 */
function loadMessages() {
    try {
        const stored = localStorage.getItem('ai_messages');
        if (stored) {
            const parsed = JSON.parse(stored);
            // 验证数据结构
            if (Array.isArray(parsed)) {
                messages = parsed.filter(msg => {
                    // 验证每条消息的必需字段
                    const isValid = msg &&
                        typeof msg === 'object' &&
                        typeof msg.id === 'string' &&
                        typeof msg.type === 'string' &&
                        (msg.type === 'user' || msg.type === 'ai') &&
                        typeof msg.content === 'string' &&
                        typeof msg.timestamp === 'number';
                    if (!isValid) {
                        console.warn('Invalid message skipped:', msg);
                    }
                    return isValid;
                });
                messages.forEach(msg => renderMessage(msg));
                
                // 滚动到最后一条消息
                if (messages.length > 0) {
                    setTimeout(() => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }, 50);
                }
            } else {
                console.warn('Invalid messages data format');
                messages = [];
            }
        }
    } catch (e) {
        console.warn('Failed to load messages:', e);
        messages = [];
    }
}

/**
 * Generate unique ID
 */
function generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for backward compatibility
export function getMessages() { return messages; }
export function addAIMessage(text) {
    return addMessage('ai', text);
}
export function updateLastAIMessage(text) {
    updateStreamMessage(text);
}
export function renderAICanvas() {
    // No-op for DOM-based implementation
}
export function resizeCanvas() {
    // No-op for DOM-based implementation
}
