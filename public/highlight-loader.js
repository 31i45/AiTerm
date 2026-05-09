// highlight.js loader - 使用 script 标签 + IIFE 隔离加载 CommonJS 模块
// 利用 CSP 允许的 'unsafe-inline' 而非 'unsafe-eval'
(function() {
    const basePath = './node_modules/highlight.js/lib';
    
    // 为 core 准备模块容器
    window.__hljs_mod = { exports: {} };
    window.__hljs_require = function(name) {
        if (name === '../highlight') return window.hljs;
        return {};
    };

    // 用 script 标签加载 core.js
    fetch(`${basePath}/core.js`)
        .then(r => r.text())
        .then(source => {
            const script = document.createElement('script');
            script.textContent = `(function(module,exports){${source}})(window.__hljs_mod,window.__hljs_mod.exports);`;
            document.head.appendChild(script);
            
            window.hljs = window.__hljs_mod.exports;
            console.log('[highlight.js] Core loaded');
            loadLanguages();
        })
        .catch(err => console.error('[highlight.js] Failed to load core:', err));
    
    function loadLanguages() {
        const languages = [
            'bash', 'c', 'cpp', 'csharp', 'css', 'dockerfile',
            'go', 'xml', 'java', 'javascript', 'json', 'kotlin',
            'lua', 'markdown', 'php', 'powershell', 'python',
            'ruby', 'rust', 'scss', 'shell', 'sql', 'swift',
            'typescript', 'vim', 'yaml'
        ];
        
        let loaded = 0;
        let failed = 0;
        
        languages.forEach(function(lang) {
            fetch(`${basePath}/languages/${lang}.js`)
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.text();
                })
                .then(source => {
                    // 每个语言在独立 IIFE 中执行，避免变量名冲突
                    const mod = { exports: {} };
                    window.__hljs_mod = mod;
                    
                    const script = document.createElement('script');
                    script.textContent = `(function(module,exports,require){${source}})(window.__hljs_mod,window.__hljs_mod.exports,window.__hljs_require);`;
                    document.head.appendChild(script);
                    
                    if (typeof mod.exports === 'function' && window.hljs) {
                        window.hljs.registerLanguage(lang, mod.exports);
                    }
                    loaded++;
                    checkDone();
                })
                .catch(err => {
                    console.warn(`[highlight.js] Skip ${lang}:`, err.message);
                    failed++;
                    checkDone();
                });
        });
        
        function checkDone() {
            if (loaded + failed === languages.length) {
                console.log(`[highlight.js] Done: ${loaded} loaded, ${failed} skipped`);
                // 清理临时全局变量
                delete window.__hljs_mod;
                delete window.__hljs_require;
            }
        }
    }
})();
