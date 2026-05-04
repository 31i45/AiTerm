import { createTerminal, getTerminal, getFitAddon, removeTerminal, setActiveTerminal, getActiveTerminal, getActiveFitAddon, writeToTerminal, fitTerminal, fitAllTerminals, onTerminalData, adjustFontSize, getFontSize, refreshTerminal, refreshAllTerminals, initSearch, searchNext, searchPrevious, clearSearch, attachTerminal, detachTerminal, countMatches } from './terminal/terminal.js';
import { initAICanvas, resizeCanvas, renderAICanvas, addMessage, updateLastAIMessage, setAiTyping, clearUserScrollFlag } from './ai/ai-renderer.js';

let ws;
let terminals = new Map();
let tabCounter = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 1000;
let appInitialized = false;
let reconnectTimer = null;

const modelSelect = document.getElementById('modelSelect');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const auditBtn = document.getElementById('auditBtn');
const loadingScreen = document.getElementById('loadingScreen');
const loadingMessage = document.getElementById('loadingMessage');
const aiInput = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSendBtn');
const terminalPanel = document.getElementById('terminalPanel');
const aiPanel = document.getElementById('aiPanel');
const resizer = document.getElementById('resizer');
const toast = document.getElementById('toast');
const tabsContainer = document.getElementById('tabsContainer');
const addTabBtn = document.getElementById('addTabBtn');
const terminalsContainer = document.getElementById('terminalsContainer');

const auditModal = document.getElementById('auditModal');
const auditModalClose = document.getElementById('auditModalClose');
const logList = document.getElementById('logList');
const logContent = document.getElementById('logContent');
const logTabs = document.querySelectorAll('.log-tab');

let currentLogType = 'audit';

function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = 'toast ' + type;
    void toast.offsetWidth;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function sendAIMessage() {
    const text = aiInput.value.trim();
    if (!text || !ws) return;
    addMessage('user', text);
    aiInput.value = '';
    aiInput.style.height = 'auto';
    setAiTyping(true);
    clearUserScrollFlag();
    ws.send(JSON.stringify({ type: 'ollama_chat', prompt: text, model: modelSelect.value }));
}

async function fetchModels() {
    try {
        const res = await fetch('/api/ollama/models');
        const data = await res.json();
        modelSelect.innerHTML = '';
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        });
    } catch (e) {
        console.error('[ERROR] 加载模型列表失败:', e);
    }
}

async function fetchLogList(type) {
    try {
        const endpoint = type === 'audit' ? '/api/audit/logs' : '/api/app/logs';
        const res = await fetch(endpoint);
        const data = await res.json();
        return data.logs;
    } catch (e) {
        console.error('[ERROR] 加载日志列表失败:', e);
        return [];
    }
}

async function fetchLogContent(type, filename) {
    try {
        const endpoint = type === 'audit' ? `/api/audit/logs/${encodeURIComponent(filename)}` : `/api/app/logs/${encodeURIComponent(filename)}`;
        const res = await fetch(endpoint);
        const data = await res.json();
        return data.content;
    } catch (e) {
        console.error('[ERROR] 加载日志内容失败:', e);
        return null;
    }
}

function renderLogList(logs) {
    if (logs.length === 0) {
        logList.innerHTML = '<div class="loading-logs">暂无日志文件</div>';
        return;
    }
    logList.innerHTML = logs.map(log => `
        <div class="log-item" data-filename="${log.name}">
            <div class="log-item-name">${log.name}</div>
            <div class="log-item-meta">${log.size} bytes · ${new Date(log.modified).toLocaleString()}</div>
        </div>
    `).join('');
    logList.querySelectorAll('.log-item').forEach(item => {
        item.addEventListener('click', async () => {
            logList.querySelectorAll('.log-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const filename = item.dataset.filename;
            const content = await fetchLogContent(currentLogType, filename);
            if (content !== null) {
                logContent.innerHTML = `<div class="log-content-text">${escapeHtml(content)}</div>`;
            } else {
                logContent.innerHTML = '<div class="log-content-empty">加载失败</div>';
            }
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function openAuditModal() {
    auditModal.classList.remove('hidden');
    const logs = await fetchLogList(currentLogType);
    renderLogList(logs);
    logContent.innerHTML = '<div class="log-content-empty">选择一个日志文件查看</div>';
}

function closeAuditModal() {
    auditModal.classList.add('hidden');
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
        const containerWidth = document.querySelector('.app-container').offsetWidth;
        const newTerminalWidth = Math.max(200, Math.min(containerWidth - 200, e.clientX));
        const aiWidth = containerWidth - newTerminalWidth - 4;
        terminalPanel.style.width = newTerminalWidth + 'px';
        aiPanel.style.width = aiWidth + 'px';
        resizeCanvas();
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

function toggleSearchPanel() {
    const searchPanel = document.getElementById('searchPanel');
    const searchInput = document.getElementById('searchInput');
    searchPanelVisible = !searchPanelVisible;
    if (searchPanelVisible) {
        searchPanel.classList.remove('hidden');
        searchInput.focus();
        searchInput.select();
    } else {
        searchPanel.classList.add('hidden');
        const activeTerminalId = getActiveTerminalId();
        if (activeTerminalId) {
            clearSearch(activeTerminalId);
        }
    }
    const activeTerminalId = getActiveTerminalId();
    if (activeTerminalId) {
        const fitAddon = getFitAddon(activeTerminalId);
        if (fitAddon) {
            setTimeout(() => {
                fitAddon.fit();
                refreshTerminal(activeTerminalId);
            }, 50);
        }
    }
}

function setupSearchPanel() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const searchPrevBtn = document.getElementById('searchPrevBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');
    const searchCloseBtn = document.getElementById('searchCloseBtn');
    const caseSensitiveBtn = document.getElementById('caseSensitiveBtn');
    const regexBtn = document.getElementById('regexBtn');
    const searchCount = document.getElementById('searchCount');
    
    function updateSearchCountDisplay() {
        if (searchCount) {
            searchCount.textContent = totalMatches > 0 ? `${currentMatchIndex + 1}/${totalMatches}` : '';
        }
    }
    
    function resetSearchState() {
        currentMatchIndex = 0;
        totalMatches = 0;
        updateSearchCountDisplay();
    }
    
    function updateCount() {
        const searchText = searchInput?.value;
        const activeTerminalId = getActiveTerminalId();
        if (searchText && activeTerminalId) {
            const result = countMatches(activeTerminalId, searchText, searchOptions);
            totalMatches = result.total;
            updateSearchCountDisplay();
        } else {
            resetSearchState();
        }
    }

    searchBtn?.addEventListener('click', toggleSearchPanel);
    searchCloseBtn?.addEventListener('click', () => {
        toggleSearchPanel();
    });

    // 区分大小写按钮
    caseSensitiveBtn?.addEventListener('click', () => {
        searchOptions.caseSensitive = !searchOptions.caseSensitive;
        caseSensitiveBtn.classList.toggle('active', searchOptions.caseSensitive);
        currentMatchIndex = 0;
        const searchText = searchInput?.value;
        const activeTerminalId = getActiveTerminalId();
        if (searchText && activeTerminalId) {
            searchNext(activeTerminalId, searchText, searchOptions);
            updateCount();
        }
    });

    // 正则表达式按钮
    regexBtn?.addEventListener('click', () => {
        searchOptions.regex = !searchOptions.regex;
        regexBtn.classList.toggle('active', searchOptions.regex);
        currentMatchIndex = 0;
        const searchText = searchInput?.value;
        const activeTerminalId = getActiveTerminalId();
        if (searchText && activeTerminalId) {
            searchNext(activeTerminalId, searchText, searchOptions);
            updateCount();
        }
    });

    searchInput?.addEventListener('input', (e) => {
        const searchText = e.target.value;
        const activeTerminalId = getActiveTerminalId();
        currentMatchIndex = 0;
        if (searchText && activeTerminalId) {
            searchNext(activeTerminalId, searchText, searchOptions);
            updateCount();
        } else if (activeTerminalId) {
            clearSearch(activeTerminalId);
            resetSearchState();
        }
    });

    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            toggleSearchPanel();
        } else if (e.key === 'Enter' && e.shiftKey) {
            const searchText = searchInput.value;
            const activeTerminalId = getActiveTerminalId();
            if (searchText && activeTerminalId) {
                searchPrevious(activeTerminalId, searchText, searchOptions);
                if (currentMatchIndex > 0) {
                    currentMatchIndex--;
                }
                updateCount();
            }
        } else if (e.key === 'Enter') {
            const searchText = searchInput.value;
            const activeTerminalId = getActiveTerminalId();
            if (searchText && activeTerminalId) {
                searchNext(activeTerminalId, searchText, searchOptions);
                if (totalMatches > 0) {
                    currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
                }
                updateCount();
            }
        }
    });

    searchPrevBtn?.addEventListener('click', () => {
        const searchText = searchInput.value;
        const activeTerminalId = getActiveTerminalId();
        if (searchText && activeTerminalId) {
            searchPrevious(activeTerminalId, searchText, searchOptions);
            if (currentMatchIndex > 0) {
                currentMatchIndex--;
            }
            updateCount();
        }
    });

    searchNextBtn?.addEventListener('click', () => {
        const searchText = searchInput.value;
        const activeTerminalId = getActiveTerminalId();
        if (searchText && activeTerminalId) {
            searchNext(activeTerminalId, searchText, searchOptions);
            if (totalMatches > 0) {
                currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
            }
            updateCount();
        }
    });
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
    onTerminalData(terminalId, (data) => {
        if (ws) {
            ws.send(JSON.stringify({ type: 'pty_input', terminalId: terminalId, data: data }));
        }
    });
    initSearch(terminalId);
    switchToTerminal(terminalId);
    if (ws) {
        // 发送终端大小信息，确保后端知道正确的尺寸
        ws.send(JSON.stringify({ 
            type: 'create_pty', 
            terminalId: terminalId,
            cols: terminal.cols || 80,
            rows: terminal.rows || 24
        }));
    }
}

function createTab(terminalId, title) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.terminalId = terminalId;
    const tabTitle = document.createElement('span');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    tab.appendChild(tabTitle);
    tab.appendChild(closeBtn);
    
    // 点击切换标签
    tab.addEventListener('click', (e) => {
        if (e.target !== closeBtn && e.target !== tabTitle) {
            switchToTerminal(terminalId);
        }
    });
    
    // 双击标题重命名
    tabTitle.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-title-input';
        input.value = tabTitle.textContent;
        tab.replaceChild(input, tabTitle);
        input.focus();
        input.select();
        
        const saveRename = () => {
            const newTitle = input.value.trim() || title;
            tabTitle.textContent = newTitle;
            tab.replaceChild(tabTitle, input);
        };
        
        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = title;
                input.blur();
            }
        });
    });
    
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTerminal(terminalId);
    });
    return tab;
}

function switchToTerminal(terminalId) {
    terminals.forEach((data, id) => {
        data.tab.classList.remove('active');
        data.terminalContainer.classList.remove('active');
    });
    const selectedTerminal = terminals.get(terminalId);
    if (selectedTerminal) {
        selectedTerminal.tab.classList.add('active');
        selectedTerminal.terminalContainer.classList.add('active');
        setActiveTerminal(terminalId);
        const fitAddon = getFitAddon(terminalId);
        if (fitAddon) {
            setTimeout(() => {
                fitAddon.fit();
                refreshTerminal(terminalId);
                if (ws) {
                    const terminal = getTerminal(terminalId);
                    if (terminal) {
                        ws.send(JSON.stringify({
                            type: 'pty_resize',
                            terminalId: terminalId,
                            cols: terminal.cols,
                            rows: terminal.rows
                        }));
                    }
                }
            }, 50);
        }
    }
}

function closeTerminal(terminalId) {
    const terminalData = terminals.get(terminalId);
    if (!terminalData) return;
    const allTerminalIds = Array.from(terminals.keys());
    if (allTerminalIds.length === 1) {
        showToast('至少需要保留一个终端', 'error');
        return;
    }
    const currentIndex = allTerminalIds.indexOf(terminalId);
    let newActiveTerminalId;
    if (currentIndex === allTerminalIds.length - 1) {
        newActiveTerminalId = allTerminalIds[currentIndex - 1];
    } else {
        newActiveTerminalId = allTerminalIds[currentIndex + 1];
    }
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
    // 直接从 terminal.js 中获取已设置的 activeTerminalId，确保映射一致
    // 注意：我们不需要重新从 DOM 查找，因为 switchToTerminal 中已经调用了 setActiveTerminal
    let activeId = null;
    for (const [id, data] of terminals) {
        if (data.tab.classList.contains('active')) {
            activeId = id;
            break;
        }
    }
    return activeId;
}

function setupTerminalToolbar() {
    document.getElementById('searchBtn')?.addEventListener('click', toggleSearchPanel);
    document.getElementById('fontMinusBtn')?.addEventListener('click', () => {
        const newSize = adjustFontSize(-1);
        showToast(`字体大小: ${newSize}px`);
    });
    document.getElementById('fontPlusBtn')?.addEventListener('click', () => {
        const newSize = adjustFontSize(1);
        showToast(`字体大小: ${newSize}px`);
    });
    document.getElementById('clearBtn')?.addEventListener('click', () => {
        const activeTerminalId = getActiveTerminalId();
        if (!activeTerminalId) return;
        if (ws) {
            ws.send(JSON.stringify({ type: 'pty_clear', terminalId: activeTerminalId }));
            setTimeout(() => {
                ws.send(JSON.stringify({ type: 'pty_input', terminalId: activeTerminalId, data: '\r' }));
            }, 50);
        }
        showToast('终端已清空');
    });
    addTabBtn.addEventListener('click', createNewTerminal);
}

function connectWebSocket() {
    console.log('[WS] 正在连接服务器...');
    loadingMessage.textContent = appInitialized ? '正在重连...' : '连接服务器...';
    
    const wsUrl = `ws://${location.host}`;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
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
        const data = JSON.parse(event.data);
        if (data.type === 'pty_data') {
            writeToTerminal(data.terminalId, data.data);
        } else if (data.type === 'ollama_start') {
            setAiTyping(true);
        } else if (data.type === 'ollama_chunk') {
            updateLastAIMessage(data.data);
        } else if (data.type === 'ollama_end') {
            setAiTyping(false);
        } else if (data.type === 'error') {
            showToast(data.message, 'error');
        }
    };
    
    ws.onclose = () => {
        console.log('[WS] 连接已关闭');
        handleDisconnect();
    };
    
    ws.onerror = (err) => {
        console.error('[WS] 连接错误:', err);
    };
}

function reattachTerminals() {
    terminals.forEach((terminalData, terminalId) => {
        const terminal = getTerminal(terminalId);
        if (terminal && ws) {
            ws.send(JSON.stringify({
                type: 'create_pty',
                terminalId: terminalId,
                cols: terminal.cols || 80,
                rows: terminal.rows || 24
            }));
        }
    });
}

function handleDisconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(30000, BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts));
        console.log(`[WS] ${delay/1000}秒后重连... (尝试 ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
        
        if (appInitialized) {
            showToast(`连接断开，${Math.round(delay/1000)}秒后重连... (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`, 'error');
        }
        
        reconnectTimer = setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
        }, delay);
    } else {
        console.error('[WS] 已达到最大重连次数，停止重连');
        showToast('连接已断开，请刷新页面重试', 'error');
        loadingScreen.classList.remove('hidden');
        loadingMessage.textContent = '连接失败，请刷新页面';
    }
}

function initFullApp() {
    appInitialized = true;
    console.log('[APP] 初始化完整应用...');
    
    document.addEventListener('toggle-search', () => {
        toggleSearchPanel();
    });
    
    initAICanvas('aiCanvas', showToast);
    resizeCanvas();
    fetchModels();
    setupSearchPanel();
    setupTerminalToolbar();
    createNewTerminal();
    
    aiSendBtn.addEventListener('click', sendAIMessage);
    aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAIMessage();
        }
    });
    aiInput.addEventListener('input', () => {
        aiInput.style.height = 'auto';
        aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
    });
    modelSelect.addEventListener('change', () => {
        showToast(`已选择模型: ${modelSelect.value}`);
    });
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
        resizeCanvas();
        renderAICanvas();
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            fitAllTerminals();
            refreshAllTerminals();
            sendResize();
        }, 100);
    });
    
    initResizer();
}

function initApp() {
    connectWebSocket();
}

document.fonts.ready.then(() => {
    initApp();
});

