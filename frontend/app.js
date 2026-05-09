import { createTerminal, getTerminal, removeTerminal, setActiveTerminal, writeToTerminal, fitTerminal, fitAllTerminals, refreshAllTerminals, initSearch, adjustFontSize, searchNext, searchPrevious, countMatches, getSearchCount, clearSearch } from './terminal/terminal.js';
import { initAIPanel, enableSendButton } from './ai/ai-panel.js';

let ws;
let terminals = new Map();
let tabCounter = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 1000;
let appInitialized = false;
let reconnectTimer = null;
let aiPanelAPI = null;

const modelSelect = document.getElementById('modelSelect');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const auditBtn = document.getElementById('auditBtn');
const loadingScreen = document.getElementById('loadingScreen');
const loadingMessage = document.getElementById('loadingMessage');
const terminalPanel = document.getElementById('terminalPanel');
const aiPanel = document.getElementById('aiPanel');
const resizer = document.getElementById('resizer');
const toast = document.getElementById('toast');
const tabsContainer = document.getElementById('tabsContainer');
const addTabBtn = document.getElementById('addTabBtn');
const terminalsContainer = document.getElementById('terminalsContainer');
const aiPanelContainer = document.getElementById('aiPanelContainer');

const auditModal = document.getElementById('auditModal');
const auditModalClose = document.getElementById('auditModalClose');
const logList = document.getElementById('logList');
const logContent = document.getElementById('logContent');
const logTabs = document.querySelectorAll('.log-tab');

let currentLogType = 'audit';

// Toast
let toastContainer = null;

function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function showToast(message, type = 'info') {
    const container = getToastContainer();
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    container.appendChild(toastEl);
    
    requestAnimationFrame(() => {
        toastEl.classList.add('visible');
    });

    setTimeout(() => {
        toastEl.classList.remove('visible');
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}

function initResizer() {
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const containerWidth = document.querySelector('.app-container').offsetWidth || document.documentElement.clientWidth;
        const newTerminalWidth = Math.max(300, Math.min(e.clientX - 4, containerWidth - 400));
        const aiWidth = containerWidth - newTerminalWidth - 4;
        terminalPanel.style.width = newTerminalWidth + 'px';
        aiPanel.style.width = aiWidth + 'px';
    });
    window.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        fitAllTerminals();
        refreshAllTerminals();
        sendResize();
    });
}

function sendResize() {
    terminals.forEach((terminalData, terminalId) => {
        const terminal = getTerminal(terminalId);
        if (ws && terminal) {
            ws.send(JSON.stringify({
                type: 'pty_resize',
                terminalId: terminalId,
                cols: terminal.cols,
                rows: terminal.rows
            }));
        }
    });
}

let searchPanelVisible = false;
let searchOptions = { caseSensitive: false, regex: false };
let currentMatchIndex = 0;
let totalMatches = 0;

function isAIPanelFocused() {
    const activeElement = document.activeElement;
    return aiPanel.contains(activeElement);
}

function toggleSearchPanel() {
    const searchPanel = document.getElementById('searchPanel');
    searchPanelVisible = !searchPanelVisible;
    searchPanel.classList.toggle('hidden', !searchPanelVisible);
    if (searchPanelVisible) {
        document.getElementById('searchInput').focus();
    }
}

function createTab(terminalId, title) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.terminalId = terminalId;
    tab.innerHTML = `
        <span class="tab-title">${title}</span>
        <span class="tab-close">&times;</span>
    `;
    tab.querySelector('.tab-title').addEventListener('click', () => switchToTerminal(terminalId));
    tab.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTerminal(terminalId);
    });
    return tab;
}

function switchToTerminal(terminalId) {
    terminals.forEach((data, id) => {
        if (id === terminalId) {
            data.tab.classList.add('active');
            data.terminalContainer.classList.remove('hidden');
            setActiveTerminal(terminalId);
        } else {
            data.tab.classList.remove('active');
            data.terminalContainer.classList.add('hidden');
        }
    });
    fitTerminal(terminalId);
}

function createNewTerminal() {
    tabCounter++;
    const terminalId = `terminal-${tabCounter}`;
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-instance';
    terminalContainer.id = terminalId;
    terminalsContainer.appendChild(terminalContainer);
    const tab = createTab(terminalId, `终端 ${tabCounter}`);
    tabsContainer.appendChild(tab);
    const { terminal, fitAddon } = createTerminal(terminalId, terminalContainer);
    terminals.set(terminalId, { terminal, fitAddon, tab, terminalContainer });
    
    terminal.onData((data) => {
        if (ws) {
            ws.send(JSON.stringify({ type: 'pty_input', terminalId: terminalId, data: data }));
        }
    });
    
    initSearch(terminalId);
    switchToTerminal(terminalId);
    
    if (ws) {
        ws.send(JSON.stringify({ 
            type: 'create_pty', 
            terminalId: terminalId,
            cols: terminal.cols,
            rows: terminal.rows
        }));
    }
}

function closeTerminal(terminalId) {
    const terminalData = terminals.get(terminalId);
    if (!terminalData) return;
    if (terminals.size <= 1) {
        showToast('至少需要保留一个终端', 'error');
        return;
    }
    // 确认关闭（有正在运行的进程时）
    const tabTitle = terminalData.tab.querySelector('.tab-title')?.textContent || '此终端';
    if (!confirm(`确定关闭「${tabTitle}」吗？`)) {
        return;
    }
    const allTerminalIds = Array.from(terminals.keys());
    const currentIndex = allTerminalIds.indexOf(terminalId);
    const newActiveTerminalId = currentIndex === allTerminalIds.length - 1 
        ? allTerminalIds[currentIndex - 1] 
        : allTerminalIds[currentIndex + 1];
    
    if (ws) {
        ws.send(JSON.stringify({ type: 'close_pty', terminalId: terminalId }));
    }
    terminalData.tab.remove();
    terminalData.terminalContainer.remove();
    removeTerminal(terminalId);
    terminals.delete(terminalId);
    if (newActiveTerminalId) {
        switchToTerminal(newActiveTerminalId);
    }
    showToast('终端已关闭');
}

function getActiveTerminalId() {
    for (const [id, data] of terminals) {
        if (data.tab.classList.contains('active')) {
            return id;
        }
    }
    return null;
}

function setupTerminalToolbar() {
    document.getElementById('searchBtn')?.addEventListener('click', toggleSearchPanel);
    document.getElementById('searchCloseBtn')?.addEventListener('click', () => {
        const searchPanel = document.getElementById('searchPanel');
        searchPanel.classList.add('hidden');
        searchPanelVisible = false;
    });
    document.getElementById('fontMinusBtn')?.addEventListener('click', () => {
        const newSize = adjustFontSize(-1);
        showToast(`字体大小: ${newSize}px`);
    });
    document.getElementById('fontPlusBtn')?.addEventListener('click', () => {
        const newSize = adjustFontSize(1);
        showToast(`字体大小: ${newSize}px`);
    });
    addTabBtn.addEventListener('click', createNewTerminal);
    
    // 搜索面板事件
    const searchInput = document.getElementById('searchInput');
    const caseSensitiveBtn = document.getElementById('caseSensitiveBtn');
    const regexBtn = document.getElementById('regexBtn');
    const searchPrevBtn = document.getElementById('searchPrevBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');
    
    const getSearchOptions = () => ({
        caseSensitive: caseSensitiveBtn?.classList.contains('active') || false,
        regex: regexBtn?.classList.contains('active') || false
    });
    
    const doSearch = (direction = 'next', isReset = false) => {
        const activeId = getActiveTerminalId();
        if (!activeId || !searchInput?.value) return;
        const options = getSearchOptions();
        if (isReset) {
            clearSearch(activeId);
        }
        if (direction === 'next') {
            searchNext(activeId, searchInput.value, options);
        } else {
            searchPrevious(activeId, searchInput.value, options);
        }
        const count = getSearchCount(activeId);
        if (count.total > 0) {
            document.getElementById('searchCount').textContent = `${count.current} / ${count.total}`;
        } else {
            document.getElementById('searchCount').textContent = '0 / 0';
        }
    };
    
    searchInput?.addEventListener('input', () => doSearch('next', true));
    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearch(e.shiftKey ? 'prev' : 'next', false);
        }
    });
    
    caseSensitiveBtn?.addEventListener('click', () => {
        caseSensitiveBtn.classList.toggle('active');
        caseSensitiveBtn.setAttribute('aria-pressed', caseSensitiveBtn.classList.contains('active'));
        doSearch('next');
    });
    
    regexBtn?.addEventListener('click', () => {
        regexBtn.classList.toggle('active');
        regexBtn.setAttribute('aria-pressed', regexBtn.classList.contains('active'));
        doSearch('next');
    });
    
    searchPrevBtn?.addEventListener('click', () => doSearch('prev'));
    searchNextBtn?.addEventListener('click', () => doSearch('next'));
}

function connectWebSocket() {
    console.log('[WS] 正在连接服务器...');
    loadingMessage.textContent = appInitialized ? '正在重连...' : '连接服务器...';
    
    const wsUrl = `ws://${location.host}`;
    ws = new WebSocket(wsUrl);
    
    // 连接超时处理
    const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            console.error('[WS] 连接超时');
            ws.close();
            loadingMessage.textContent = '连接超时，请检查服务器是否运行 (node index.js)';
        }
    }, 10000);
    
    ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WS] 连接已建立');
        reconnectAttempts = 0;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
        }, 600);
        if (!appInitialized) {
            initFullApp();
        } else {
            reattachTerminals();
            showToast('连接已恢复', 'success');
        }
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'pty_data') {
                writeToTerminal(data.terminalId, data.data);
            } else if (data.type === 'ollama_start') {
                // AI 开始响应
            } else if (data.type === 'ollama_chunk') {
                if (aiPanelAPI) {
                    aiPanelAPI.updateStreamMessage(data.data);
                }
            } else if (data.type === 'ollama_end') {
                if (aiPanelAPI) {
                    aiPanelAPI.endStream();
                }
                enableSendButton();
            } else if (data.type === 'error') {
                showToast(data.message, 'error');
                enableSendButton();
            } else if (data.type === 'command_blocked') {
                showToast(data.message, 'error');
            }
        } catch (e) {
            console.error('[WS] 消息处理失败:', e);
        }
    };
    
    ws.onclose = () => {
        clearTimeout(connectionTimeout);
        console.log('[WS] 连接已关闭');
        loadingScreen.classList.remove('hidden');
        loadingMessage.textContent = '连接已断开，正在重连...';
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts), 30000);
            reconnectTimer = setTimeout(() => {
                reconnectAttempts++;
                connectWebSocket();
            }, delay);
        } else {
            loadingMessage.textContent = '连接失败。请检查：1) 服务器是否运行 2) 端口是否正确 3) 防火墙设置。刷新页面重试。';
        }
    };
    
    ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('[WS] 连接错误:', error);
        loadingMessage.textContent = '连接错误。请确认服务器正在运行，然后刷新页面。';
    };
}

// 页面卸载时清理所有定时器，防止内存泄漏
window.addEventListener('beforeunload', () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
});

function reattachTerminals() {
    terminals.forEach((data, terminalId) => {
        const terminal = getTerminal(terminalId);
        if (terminal) {
            ws.send(JSON.stringify({
                type: 'create_pty',
                terminalId: terminalId,
                cols: terminal.cols,
                rows: terminal.rows
            }));
        }
    });
}

async function fetchModels() {
    try {
        const response = await fetch('/api/ollama/models');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        // 使用 DOM API 避免 XSS
        modelSelect.innerHTML = '';
        data.models.forEach(m => {
            const name = typeof m === 'object' ? (m.name || m.model || m.id || JSON.stringify(m)) : m;
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            modelSelect.appendChild(option);
        });
    } catch (e) {
        console.error('Failed to fetch models:', e);
        // 如果获取失败，添加一个默认选项
        modelSelect.innerHTML = '<option value="">无法获取模型列表</option>';
    }
}

async function fetchLogList(type) {
    try {
        const endpoint = type === 'audit' ? '/api/audit/logs' : '/api/app/logs';
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch logs:', e);
        return { logs: [] };
    }
}

async function fetchLogContent(type, filename) {
    try {
        const endpoint = type === 'audit' ? `/api/audit/logs/${filename}` : `/api/app/logs/${filename}`;
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        // 后端返回 { content, filename, truncated }
        return data.content || '';
    } catch (e) {
        console.error('Failed to fetch log content:', e);
        return '';
    }
}

function renderLogList(data) {
    const logs = Array.isArray(data) ? data : (data.logs || []);
    logList.innerHTML = '';
    logs.forEach(log => {
        const name = typeof log === 'object' ? log.name : log;
        const size = typeof log === 'object' ? log.size : 0;
        const modified = typeof log === 'object' ? log.modified : null;

        const item = document.createElement('div');
        item.className = 'log-item';
        item.dataset.filename = name;

        // 优化文件名显示：提取类型和日期（返回 HTML，不转义）
        const displayNameHtml = formatLogFileName(name);
        const sizeStr = size > 0 ? formatFileSize(size) : '';
        const dateStr = modified ? new Date(modified).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

        item.innerHTML = `
            <div class="log-item-name">${displayNameHtml}</div>
            <div class="log-item-meta">${dateStr}${sizeStr ? ' · ' + sizeStr : ''}</div>
        `;

        item.addEventListener('click', async () => {
            logList.querySelectorAll('.log-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const content = await fetchLogContent(currentLogType, item.dataset.filename);
            renderLogContent(content);
            // 如果有搜索词，重新执行搜索以高亮新内容
            const searchInput = document.getElementById('logSearchInput');
            if (searchInput && searchInput.value.trim()) {
                // 触发搜索事件
                searchInput.dispatchEvent(new Event('input'));
            }
        });
        logList.appendChild(item);
    });
}

/**
 * 优化日志文件名显示
 */
function formatLogFileName(filename) {
    // combined-2026-05-09.log → "综合日志"
    // error-2026-05-09.log → "错误日志"
    // audit-2026-05-09.log → "审计日志"
    // debug-2026-05-09.log → "调试日志"
    // warn-2026-05-09.log → "警告日志"
    const typeMap = {
        'combined': '📋 综合日志',
        'error': '🔴 错误日志',
        'warn': '🟡 警告日志',
        'debug': '🔍 调试日志',
        'audit': '📝 审计日志'
    };

    const match = filename.match(/^(.+?)-(\d{4}-\d{2}-\d{2})\.log$/);
    if (match) {
        const type = typeMap[match[1]] || match[1];
        const date = match[2];
        return `${type} <span style="opacity:0.6; font-size:11px;">${date}</span>`;
    }

    return filename;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 格式化渲染日志内容（JSON 格式化 + 语法高亮）
 */
function renderLogContent(rawContent) {
    const lines = rawContent.split('\n').filter(line => line.trim());
    let validLineCount = 0;
    
    const formattedLines = lines.map((line, idx) => {
        // 跳过空数组或无效内容
        if (line === '[]' || line === '{}' || line === '') {
            return '';
        }
        try {
            const obj = JSON.parse(line);
            // 跳过空对象或数组
            if (Array.isArray(obj) && obj.length === 0) return '';
            if (typeof obj === 'object' && Object.keys(obj).length === 0) return '';
            validLineCount++;
            return formatJsonLine(obj, validLineCount - 1);
        } catch (e) {
            // 非 JSON 行，直接显示
            validLineCount++;
            return `<div class="log-line" data-line="${validLineCount - 1}">
                <span class="log-line-num">${validLineCount}</span>
                <span class="log-line-body">${escapeHtml(line)}</span>
            </div>`;
        }
    }).filter(line => line).join(''); // 过滤空行

    if (!formattedLines) {
        logContent.innerHTML = `<div class="log-content-empty">日志文件为空或无有效内容</div>`;
    } else {
        logContent.innerHTML = `<div class="log-content-text">${formattedLines}</div>`;
    }
    // 存储原始内容用于搜索
    logContent.dataset.rawContent = rawContent;
    logContent.dataset.lines = validLineCount;
}

/**
 * 格式化单行 JSON 为带颜色的 HTML
 */
function formatJsonLine(obj, lineIdx) {
    const timestamp = obj.timestamp || obj.time || '';
    const level = obj.level || '';
    const message = obj.message || '';
    const service = obj.service || '';

    // 提取额外字段
    const knownKeys = new Set(['timestamp', 'time', 'level', 'message', 'service']);
    const extra = {};
    for (const [key, val] of Object.entries(obj)) {
        if (!knownKeys.has(key)) {
            extra[key] = val;
        }
    }

    const levelClass = `log-level-${level}`;
    const extraStr = Object.keys(extra).length > 0
        ? `<span class="log-json-key" style="opacity:0.7;">${escapeHtml(JSON.stringify(extra))}</span>`
        : '';

    return `<div class="log-line" data-line="${lineIdx}">
        <span class="log-line-num">${lineIdx + 1}</span>
        <span class="log-line-body">
        <span style="opacity:0.5;">${escapeHtml(timestamp)}</span>
        <span class="${levelClass}">[${escapeHtml(level.toUpperCase())}]</span>
        ${service ? `<span style="opacity:0.4;">${escapeHtml(service)}</span>` : ''}
        <span>${escapeHtml(message)}</span>
        ${extraStr}
        </span>
    </div>`;
}

// ============================================
// 日志搜索功能
// ============================================
let logSearchMatches = [];
let logSearchCurrentIdx = -1;
let logSearchDebounceTimer = null;
let logSearchQuery = '';

function setupLogSearch() {
    const searchInput = document.getElementById('logSearchInput');
    const searchCount = document.getElementById('logSearchCount');
    const searchPrev = document.getElementById('logSearchPrev');
    const searchNext = document.getElementById('logSearchNext');
    const searchClear = document.getElementById('logSearchClear');

    if (!searchInput) return;

    const doSearch = () => {
        const query = searchInput.value.trim();
        logSearchQuery = query;
        if (!query) {
            clearLogSearch();
            return;
        }

        // 重新渲染日志内容（清除之前的高亮，恢复干净的 DOM）
        const rawContent = logContent.dataset.rawContent;
        if (rawContent) {
            renderLogContent(rawContent);
        }

        // 在日志行中搜索
        const logLines = logContent.querySelectorAll('.log-line');
        logSearchMatches = [];
        logSearchCurrentIdx = -1;

        logLines.forEach((line, idx) => {
            const text = line.textContent;
            const lowerText = text.toLowerCase();
            const lowerQuery = query.toLowerCase();
            
            // 统计该行中所有匹配的位置
            let pos = 0;
            let matchCount = 0;
            while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
                logSearchMatches.push({ lineIdx: idx, matchIdx: matchCount });
                matchCount++;
                pos += lowerQuery.length;
            }
        });

        if (logSearchMatches.length > 0) {
            logSearchCurrentIdx = 0;
            applyHighlight(query);
            const firstMatch = logSearchMatches[0];
            scrollToMatch(firstMatch.lineIdx);
            searchCount.textContent = `1 / ${logSearchMatches.length}`;
        } else {
            searchCount.textContent = '0 / 0';
        }
    };

    // 防抖搜索，避免输入卡顿
    const debouncedSearch = () => {
        clearTimeout(logSearchDebounceTimer);
        logSearchDebounceTimer = setTimeout(doSearch, 150);
    };

    const goToMatch = (direction) => {
        if (logSearchMatches.length === 0) return;
        
        // 移除当前高亮的 current 标记
        logContent.querySelectorAll('.log-search-highlight.current').forEach(el => {
            el.classList.remove('current');
        });
        
        if (direction === 'next') {
            logSearchCurrentIdx = (logSearchCurrentIdx + 1) % logSearchMatches.length;
        } else {
            logSearchCurrentIdx = (logSearchCurrentIdx - 1 + logSearchMatches.length) % logSearchMatches.length;
        }
        
        // 高亮当前匹配
        const currentMatch = logSearchMatches[logSearchCurrentIdx];
        const line = logContent.querySelectorAll('.log-line')[currentMatch.lineIdx];
        if (line) {
            const highlights = line.querySelectorAll('.log-search-highlight');
            if (highlights[currentMatch.matchIdx]) {
                highlights[currentMatch.matchIdx].classList.add('current');
            }
            scrollToMatch(currentMatch.lineIdx);
        }
        searchCount.textContent = `${logSearchCurrentIdx + 1} / ${logSearchMatches.length}`;
    };

    const clearLogSearch = () => {
        searchInput.value = '';
        searchCount.textContent = '';
        logSearchMatches = [];
        logSearchCurrentIdx = -1;
        logSearchQuery = '';
        // 重新渲染日志内容，清除高亮
        const rawContent = logContent.dataset.rawContent;
        if (rawContent) {
            renderLogContent(rawContent);
        }
    };

    /**
     * 在所有匹配的行中应用高亮
     * 使用 innerHTML 替换方式，简单可靠
     */
    const applyHighlight = (query) => {
        const logLines = logContent.querySelectorAll('.log-line');
        const lowerQuery = query.toLowerCase();
        
        logLines.forEach((line, idx) => {
            // 只处理有匹配的行
            const hasMatch = logSearchMatches.some(m => m.lineIdx === idx);
            if (!hasMatch) return;
            
            // 获取该行所有直接子元素
            const children = Array.from(line.childNodes);
            
            children.forEach(child => {
                if (child.nodeType !== Node.TEXT_NODE) return;
                
                const text = child.textContent;
                const lowerText = text.toLowerCase();
                if (!lowerText.includes(lowerQuery)) return;
                
                // 用高亮 HTML 替换原始文本节点
                const html = escapeAndHighlight(text, query);
                const temp = document.createElement('span');
                temp.innerHTML = html;
                
                // 将高亮后的节点插入
                while (temp.firstChild) {
                    line.insertBefore(temp.firstChild, child);
                }
                line.removeChild(child);
            });
        });
    };

    /**
     * 转义 HTML 并高亮搜索词
     */
    const escapeAndHighlight = (text, query) => {
        // 先转义 HTML 特殊字符
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // 然后高亮搜索词（在转义后的文本中搜索）
        const lowerEscaped = escaped.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let idx = lowerEscaped.indexOf(lowerQuery);
        
        if (idx === -1) return escaped;
        
        const parts = [];
        let lastIdx = 0;
        while (idx !== -1) {
            if (idx > lastIdx) {
                parts.push(escaped.substring(lastIdx, idx));
            }
            parts.push(`<span class="log-search-highlight">${escaped.substring(idx, idx + query.length)}</span>`);
            lastIdx = idx + query.length;
            idx = lowerEscaped.indexOf(lowerQuery, lastIdx);
        }
        if (lastIdx < escaped.length) {
            parts.push(escaped.substring(lastIdx));
        }
        return parts.join('');
    };

    const scrollToMatch = (lineIdx) => {
        const logLines = logContent.querySelectorAll('.log-line');
        const line = logLines[lineIdx];
        if (line) {
            line.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // 使用防抖搜索
    searchInput.addEventListener('input', debouncedSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (logSearchMatches.length === 0) {
                clearTimeout(logSearchDebounceTimer);
                doSearch();
            } else {
                goToMatch(e.shiftKey ? 'prev' : 'next');
            }
        }
    });
    searchPrev?.addEventListener('click', () => goToMatch('prev'));
    searchNext?.addEventListener('click', () => goToMatch('next'));
    searchClear?.addEventListener('click', clearLogSearch);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openAuditModal() {
    auditModal.classList.remove('hidden');
    fetchLogList(currentLogType).then(renderLogList);
    setupLogSearch();
}

function closeAuditModal() {
    auditModal.classList.add('hidden');
}

function initFullApp() {
    appInitialized = true;
    
    // Initialize AI Panel
    if (aiPanelContainer) {
        aiPanelAPI = initAIPanel(aiPanelContainer);
        
        // Listen for AI send events
        window.addEventListener('ai-send', (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ollama_chat',
                    prompt: e.detail.content,
                    model: modelSelect.value
                }));
            }
        });
    }
    
    initResizer();
    fetchModels();
    setupTerminalToolbar();
    createNewTerminal();
    
    refreshModelsBtn.addEventListener('click', fetchModels);
    auditBtn.addEventListener('click', openAuditModal);
    auditModalClose.addEventListener('click', closeAuditModal);
    
    logTabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            logTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentLogType = tab.dataset.type;
            const logs = await fetchLogList(currentLogType);
            renderLogList(logs);
            logContent.innerHTML = '<div class="log-content-empty">选择一个日志文件查看</div>';
        });
    });
    
    auditModal.addEventListener('click', (e) => {
        if (e.target === auditModal) {
            closeAuditModal();
        }
    });
    
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            fitAllTerminals();
            refreshAllTerminals();
            sendResize();
        }, 100);
    });

    // 全局键盘快捷键
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+T: 新建终端
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
            e.preventDefault();
            createNewTerminal();
            return;
        }

        // Ctrl+Tab: 切换到下一个终端标签
        if (e.ctrlKey && e.key === 'Tab') {
            e.preventDefault();
            const allIds = Array.from(terminals.keys());
            if (allIds.length <= 1) return;
            const activeId = getActiveTerminalId();
            const currentIdx = allIds.indexOf(activeId);
            const nextIdx = e.shiftKey
                ? (currentIdx - 1 + allIds.length) % allIds.length
                : (currentIdx + 1) % allIds.length;
            switchToTerminal(allIds[nextIdx]);
            return;
        }

        // Ctrl+1~9: 切换到指定终端标签
        if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const allIds = Array.from(terminals.keys());
            const idx = parseInt(e.key) - 1;
            if (idx < allIds.length) {
                switchToTerminal(allIds[idx]);
            }
            return;
        }

        // Escape: 关闭搜索面板或弹窗
        if (e.key === 'Escape') {
            const searchPanel = document.getElementById('searchPanel');
            if (searchPanel && !searchPanel.classList.contains('hidden')) {
                searchPanel.classList.add('hidden');
                return;
            }
            if (!auditModal.classList.contains('hidden')) {
                closeAuditModal();
                return;
            }
        }
    });
}

function initApp() {
    connectWebSocket();
}

document.fonts.ready.then(() => {
    initApp();
});
