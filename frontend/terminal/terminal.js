const hyperSnazzyTheme = {
    background: '#282a36',
    foreground: '#eff0eb',
    cursor: '#97979b',
    cursorAccent: '#282a36',
    selectionBackground: 'rgba(171, 125, 249, 0.3)',
    black: '#282a36',
    red: '#ff5c57',
    green: '#5af78e',
    yellow: '#f3f99d',
    blue: '#57c7ff',
    magenta: '#ff6ac1',
    cyan: '#9aedfe',
    white: '#f1f1f0',
    brightBlack: '#686868',
    brightRed: '#ff5c57',
    brightGreen: '#5af78e',
    brightYellow: '#f3f99d',
    brightBlue: '#57c7ff',
    brightMagenta: '#ff6ac1',
    brightCyan: '#9aedfe',
    brightWhite: '#eff0eb'
};

// ===== 剪贴板工具函数 =====

function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.id = 'terminal-clipboard-fallback';
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(textarea);
}

function pasteFromClipboard(terminal) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.readText().then(text => {
            if (text) terminal.paste(text);
        }).catch(() => fallbackPaste(terminal));
    } else {
        fallbackPaste(terminal);
    }
}

function fallbackPaste(terminal) {
    const textarea = document.createElement('textarea');
    textarea.id = 'terminal-paste-fallback';
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.focus();
    // 监听粘贴事件
    const handler = (e) => {
        const text = e.clipboardData?.getData('text/plain');
        if (text) terminal.paste(text);
        document.removeEventListener('paste', handler);
        document.body.removeChild(textarea);
    };
    document.addEventListener('paste', handler, { once: true });
    // 触发系统粘贴对话框
    document.execCommand('paste');
    // 2 秒后清理（用户取消时）
    setTimeout(() => {
        document.removeEventListener('paste', handler);
        if (document.getElementById('terminal-paste-fallback')) {
            document.body.removeChild(textarea);
        }
    }, 2000);
}

let currentFontSize = 14;
let terminalInstances = new Map();
let activeTerminalId = null;
let fitAddons = new Map();
let attachAddons = new Map();
let searchAddons = new Map();
let isTerminalFocused = false;
let globalMouseDownHandlers = new Map(); // 存储每个终端的全局 mousedown 处理器引用

export function hasTerminalSelection() {
    for (const terminal of terminalInstances.values()) {
        if (terminal.hasSelection()) return true;
    }
    return false;
}

export function copyTerminalSelection() {
    for (const terminal of terminalInstances.values()) {
        if (terminal.hasSelection()) {
            const selection = terminal.getSelection();
            navigator.clipboard.writeText(selection).catch(() => {
                // fallback
            });
            return true;
        }
    }
    return false;
}

// 清除 AI 面板的选择状态（防止复制粘贴混淆）
function clearAiSelection() {
    // 触发自定义事件通知 AI 面板清除选择
    const event = new CustomEvent('clear-ai-selection');
    document.dispatchEvent(event);
}

export function createTerminal(terminalId, container) {
    const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: currentFontSize,
        lineHeight: 1.2,
        fontFamily: '"Cascadia Code", "Cascadia Code NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Consolas", "Menlo", "SF Mono", monospace',
        fontLigatures: true,
        theme: hyperSnazzyTheme,
        scrollback: 10000,
        allowTransparency: false,
        convertEol: true,
        rendererType: 'canvas',
        bellStyle: 'sound',
        allowProposedApi: true,
        macOptionIsMeta: false,
        rightClickSelectsWord: true
    });

    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const terminalElement = container;

    // 焦点管理
    const focusHandler = () => {
        isTerminalFocused = true;
        clearAiSelection(); // 点击终端时清除 AI 面板的选择
    };
    terminalElement.addEventListener('mousedown', focusHandler);
    
    // 全局 mousedown 处理器 - 存储引用以便清理
    const globalMouseDownHandler = (e) => {
        if (!terminalElement.contains(e.target)) {
            isTerminalFocused = false;
        }
    };
    document.addEventListener('mousedown', globalMouseDownHandler);
    globalMouseDownHandlers.set(terminalId, globalMouseDownHandler);

    terminal.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown') {
            // Ctrl+F 搜索
            if (event.ctrlKey && !event.shiftKey && event.key === 'f') {
                event.preventDefault();
                const eventToggle = new CustomEvent('toggle-search');
                document.dispatchEvent(eventToggle);
                return false;
            }
            // Ctrl+C 或 Ctrl+Shift+C 复制（有选中时）
            if ((event.ctrlKey || event.metaKey) && event.key === 'c' && terminal.hasSelection()) {
                event.preventDefault();
                const selection = terminal.getSelection();
                copyToClipboard(selection);
                clearAiSelection(); // 复制后清除 AI 面板的选择
                return false;
            }
            // Ctrl+V 或 Ctrl+Shift+V 粘贴
            if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
                event.preventDefault();
                pasteFromClipboard(terminal);
                return false;
            }
        }
        return true;
    });

    // 右键：有选中则复制，无选中则粘贴
    terminalElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (terminal.hasSelection()) {
            copyToClipboard(terminal.getSelection());
            clearAiSelection(); // 复制后清除 AI 面板的选择
        } else {
            pasteFromClipboard(terminal);
        }
    });

    setTimeout(() => {
        fitAddon.fit();
    }, 100);
    setTimeout(() => {
        fitAddon.fit();
        terminal.refresh(0, terminal.rows);
    }, 300);

    terminalInstances.set(terminalId, terminal);
    fitAddons.set(terminalId, fitAddon);

    return { terminal, fitAddon };
}

export function attachTerminal(terminalId, websocket) {
    const terminal = terminalInstances.get(terminalId);
    if (terminal) {
        const attachAddon = new AttachAddon.AttachAddon(websocket);
        terminal.loadAddon(attachAddon);
        attachAddons.set(terminalId, attachAddon);
        return attachAddon;
    }
    return null;
}

export function detachTerminal(terminalId) {
    const attachAddon = attachAddons.get(terminalId);
    if (attachAddon) {
        attachAddon.dispose();
        attachAddons.delete(terminalId);
    }
}

export function getTerminal(terminalId) {
    return terminalInstances.get(terminalId);
}

export function getFitAddon(terminalId) {
    return fitAddons.get(terminalId);
}

export function removeTerminal(terminalId) {
    const terminal = terminalInstances.get(terminalId);
    if (terminal) {
        terminal.dispose();
        terminalInstances.delete(terminalId);
        fitAddons.delete(terminalId);
        
        // 清理 attach addon
        const attachAddon = attachAddons.get(terminalId);
        if (attachAddon) {
            attachAddon.dispose();
            attachAddons.delete(terminalId);
        }
        
        // 清理 search addon
        const searchAddon = searchAddons.get(terminalId);
        if (searchAddon) {
            searchAddon.dispose();
            searchAddons.delete(terminalId);
        }
        
        // 清理全局 mousedown 事件监听器
        const globalMouseDownHandler = globalMouseDownHandlers.get(terminalId);
        if (globalMouseDownHandler) {
            document.removeEventListener('mousedown', globalMouseDownHandler);
            globalMouseDownHandlers.delete(terminalId);
        }
    }
}

export function setActiveTerminal(terminalId) {
    activeTerminalId = terminalId;
}

export function getActiveTerminal() {
    if (activeTerminalId) {
        return terminalInstances.get(activeTerminalId);
    }
    return null;
}

export function getActiveFitAddon() {
    if (activeTerminalId) {
        return fitAddons.get(activeTerminalId);
    }
    return null;
}

export function writeToTerminal(terminalId, data) {
    const terminal = terminalInstances.get(terminalId);
    if (terminal) {
        terminal.write(data);
    }
}

export function fitTerminal(terminalId) {
    const fitAddon = fitAddons.get(terminalId);
    if (fitAddon) {
        fitAddon.fit();
    }
}

export function fitAllTerminals() {
    fitAddons.forEach(fitAddon => {
        fitAddon.fit();
    });
}

export function onTerminalData(terminalId, callback) {
    const terminal = terminalInstances.get(terminalId);
    if (terminal) {
        terminal.onData(callback);
    }
}

export function adjustFontSize(delta) {
    currentFontSize = Math.max(8, Math.min(32, currentFontSize + delta));
    terminalInstances.forEach(terminal => {
        terminal.options.fontSize = currentFontSize;
    });
    fitAddons.forEach(fitAddon => {
        fitAddon.fit();
    });
    terminalInstances.forEach(terminal => {
        terminal.refresh(0, terminal.rows);
    });
    return currentFontSize;
}

export function refreshTerminal(terminalId) {
    const terminal = terminalInstances.get(terminalId);
    if (terminal) {
        terminal.refresh(0, terminal.rows);
    }
}

export function refreshAllTerminals() {
    terminalInstances.forEach(terminal => {
        terminal.refresh(0, terminal.rows);
    });
}

export function getFontSize() {
    return currentFontSize;
}

let searchTerms = new Map();

export function initSearch(terminalId) {
    try {
        if (typeof SearchAddon !== 'undefined') {
            const terminal = terminalInstances.get(terminalId);
            if (terminal) {
                const SearchAddonClass = SearchAddon.SearchAddon || SearchAddon;
                const searchAddon = new SearchAddonClass();
                terminal.loadAddon(searchAddon);
                searchAddons.set(terminalId, searchAddon);
                return true;
            }
        }
    } catch (e) {
        console.log('[initSearch] Error loading search addon:', e);
    }
    return false;
}

export function countMatches(terminalId, searchText, options = { caseSensitive: false, regex: false }) {
    const terminal = terminalInstances.get(terminalId);
    if (!terminal || !searchText) {
        return { total: 0, matches: [] };
    }
    
    let count = 0;
    const buffer = terminal.buffer.active;
    const lineCount = buffer.length;
    
    for (let i = 0; i < lineCount; i++) {
        const line = buffer.getLine(i);
        if (line) {
            let lineText = line.translateToString(true);
            if (lineText) {
                if (options.regex) {
                    try {
                        const flags = options.caseSensitive ? 'g' : 'gi';
                        const regex = new RegExp(searchText, flags);
                        const matches = lineText.match(regex);
                        if (matches) {
                            count += matches.length;
                        }
                    } catch (e) {
                    }
                } else {
                    let searchTextLower = options.caseSensitive ? searchText : searchText.toLowerCase();
                    let lineTextLower = options.caseSensitive ? lineText : lineText.toLowerCase();
                    let index = 0;
                    while ((index = lineTextLower.indexOf(searchTextLower, index)) !== -1) {
                        count++;
                        index += searchTextLower.length;
                    }
                }
            }
        }
    }
    
    return { total: count };
}

export function searchNext(terminalId, searchText, options = { caseSensitive: false, regex: false }) {
    searchTerms.set(terminalId, searchText);
    const searchAddon = searchAddons.get(terminalId);
    if (searchAddon && searchText) {
        searchAddon.findNext(searchText, {
            caseSensitive: options.caseSensitive,
            regex: options.regex,
            wholeWord: false,
            incremental: true
        });
        updateSearchCount(terminalId, searchText, options, 'next');
    }
}

export function searchPrevious(terminalId, searchText, options = { caseSensitive: false, regex: false }) {
    searchTerms.set(terminalId, searchText);
    const searchAddon = searchAddons.get(terminalId);
    if (searchAddon && searchText) {
        searchAddon.findPrevious(searchText, {
            caseSensitive: options.caseSensitive,
            regex: options.regex,
            wholeWord: false,
            incremental: true
        });
        updateSearchCount(terminalId, searchText, options, 'prev');
    }
}

let searchCurrentIndex = new Map();
let searchTotalCount = new Map();

function updateSearchCount(terminalId, searchText, options, direction) {
    const result = countMatches(terminalId, searchText, options);
    searchTotalCount.set(terminalId, result.total);
    
    if (result.total === 0) {
        searchCurrentIndex.set(terminalId, 0);
        return;
    }
    
    let current = searchCurrentIndex.get(terminalId) || 1;
    
    if (direction === 'next') {
        current = (current % result.total) + 1;
    } else if (direction === 'prev') {
        current = ((current - 2 + result.total) % result.total) + 1;
    } else {
        // 首次搜索，重置为 1
        current = 1;
    }
    
    searchCurrentIndex.set(terminalId, current);
}

export function getSearchCount(terminalId) {
    return {
        current: searchCurrentIndex.get(terminalId) || 0,
        total: searchTotalCount.get(terminalId) || 0
    };
}

export function clearSearch(terminalId) {
    const searchAddon = searchAddons.get(terminalId);
    if (searchAddon) {
        searchAddon.clearDecorations();
    }
    searchTerms.delete(terminalId);
    searchCurrentIndex.delete(terminalId);
    searchTotalCount.delete(terminalId);
}



