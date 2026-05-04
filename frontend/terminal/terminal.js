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

let currentFontSize = 14;
let terminalInstances = new Map();
let activeTerminalId = null;
let fitAddons = new Map();
let attachAddons = new Map();

export function createTerminal(terminalId, container) {
    const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: currentFontSize,
        lineHeight: 1.2,
        fontFamily: '"Cascadia Code", "Consolas", "Menlo", "SF Mono", monospace',
        theme: hyperSnazzyTheme,
        scrollback: 10000,
        allowTransparency: false,
        convertEol: false,
        rendererType: 'canvas',
        bellStyle: 'none',
        allowProposedApi: true,
        macOptionIsMeta: false,
        rightClickSelectsWord: true
    });

    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const terminalElement = container;

    terminal.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown') {
            if (event.ctrlKey && event.key === 'f') {
                event.preventDefault();
                const eventToggle = new CustomEvent('toggle-search');
                document.dispatchEvent(eventToggle);
                return false;
            } else if (event.ctrlKey && event.key === 'c' && terminal.hasSelection()) {
                event.preventDefault();
                const selection = terminal.getSelection();
                navigator.clipboard.writeText(selection).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = selection;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                });
                return false;
            } else if (event.ctrlKey && event.key === 'v') {
                event.preventDefault();
                navigator.clipboard.readText().then(text => {
                    if (text) {
                        terminal.paste(text);
                    }
                }).catch(() => {});
                return false;
            }
        }
        return true;
    });

    terminalElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (terminal.hasSelection()) {
            const selection = terminal.getSelection();
            navigator.clipboard.writeText(selection).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = selection;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            });
        } else {
            navigator.clipboard.readText().then(text => {
                if (text) {
                    terminal.paste(text);
                }
            }).catch(() => {});
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

let searchAddons = new Map();
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
        updateSearchCount(terminalId, searchText, options);
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
        updateSearchCount(terminalId, searchText, options);
    }
}

function updateSearchCount(terminalId, searchText, options) {
    // 搜索计数功能可以通过监听高亮装饰器来获取
    // 目前 xterm-addon-search 没有直接的计数 API，我们用一个简单的计数
}

export function clearSearch(terminalId) {
    const searchAddon = searchAddons.get(terminalId);
    if (searchAddon) {
        searchAddon.clearDecorations();
    }
    searchTerms.delete(terminalId);
}



