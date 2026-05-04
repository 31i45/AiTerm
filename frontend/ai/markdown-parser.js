export const STYLES = {
    normal: {
        font: '14px -apple-system, system-ui, sans-serif',
        color: '#f8f8f2',
        weight: 'normal',
        style: 'normal'
    },
    bold: {
        font: 'bold 14px -apple-system, system-ui, sans-serif',
        color: '#f8f8f2',
        weight: 'bold',
        style: 'normal'
    },
    italic: {
        font: 'italic 14px -apple-system, system-ui, sans-serif',
        color: '#f8f8f2',
        weight: 'normal',
        style: 'italic'
    },
    code: {
        font: '13px "Cascadia Code", "Consolas", "Menlo", monospace',
        color: '#ff79c6',
        background: 'rgba(255, 121, 198, 0.1)',
        padding: 2
    },
    codeBlock: {
        font: '13px "Cascadia Code", "Consolas", "Menlo", monospace',
        color: '#f8f8f2',
        background: '#282a36',
        padding: 12
    },
    h1: {
        font: 'bold 24px -apple-system, system-ui, sans-serif',
        color: '#bd93f9',
        weight: 'bold'
    },
    h2: {
        font: 'bold 20px -apple-system, system-ui, sans-serif',
        color: '#bd93f9',
        weight: 'bold'
    },
    h3: {
        font: 'bold 18px -apple-system, system-ui, sans-serif',
        color: '#bd93f9',
        weight: 'bold'
    },
    link: {
        font: '14px -apple-system, system-ui, sans-serif',
        color: '#57c7ff',
        decoration: 'underline'
    },
    listItem: {
        font: '14px -apple-system, system-ui, sans-serif',
        color: '#f8f8f2'
    }
};

export function parseMarkdownToSegments(text) {
    const segments = [];
    let i = 0;
    let inCodeBlock = false;
    let codeBlockLang = '';
    let inInlineCode = false;

    while (i < text.length) {
        // 代码块 ```code```
        if (text.substr(i, 3) === '```') {
            inCodeBlock = !inCodeBlock;
            i += 3;
            if (inCodeBlock) {
                let langEnd = text.indexOf('\n', i);
                if (langEnd === -1) langEnd = text.length;
                codeBlockLang = text.substring(i, langEnd).trim();
                i = langEnd + 1;
            }
            continue;
        }

        if (inCodeBlock) {
            let codeEnd = text.indexOf('```', i);
            if (codeEnd === -1) codeEnd = text.length;
            segments.push({
                text: text.substring(i, codeEnd),
                style: 'codeBlock',
                lang: codeBlockLang
            });
            i = codeEnd;
            continue;
        }

        // 行内代码 `code`
        if (text[i] === '`') {
            inInlineCode = !inInlineCode;
            i++;
            if (inInlineCode) {
                let codeEnd = text.indexOf('`', i);
                if (codeEnd === -1) codeEnd = text.length;
                segments.push({
                    text: text.substring(i, codeEnd),
                    style: 'code'
                });
                i = codeEnd + 1;
            }
            continue;
        }

        // 标题 # ## ###
        if (text[i] === '#' && (i === 0 || text[i - 1] === '\n')) {
            let level = 0;
            while (text[i + level] === '#' && level < 3) level++;
            if (text[i + level] === ' ') {
                let headerEnd = text.indexOf('\n', i + level + 1);
                if (headerEnd === -1) headerEnd = text.length;
                segments.push({
                    text: text.substring(i + level + 1, headerEnd),
                    style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3',
                    isHeader: true
                });
                i = headerEnd + 1;
                continue;
            }
        }

        // 粗体 **text**
        if (text.substr(i, 2) === '**') {
            let boldEnd = text.indexOf('**', i + 2);
            if (boldEnd !== -1) {
                segments.push({
                    text: text.substring(i + 2, boldEnd),
                    style: 'bold'
                });
                i = boldEnd + 2;
                continue;
            }
        }

        // 斜体 *text*
        if (text[i] === '*' && text[i - 1] !== ' ' && text[i + 1] !== ' ') {
            let italicEnd = text.indexOf('*', i + 1);
            if (italicEnd !== -1) {
                segments.push({
                    text: text.substring(i + 1, italicEnd),
                    style: 'italic'
                });
                i = italicEnd + 1;
                continue;
            }
        }

        // 链接 [text](url)
        if (text[i] === '[') {
            let linkTextEnd = text.indexOf(']', i + 1);
            if (linkTextEnd !== -1 && text[linkTextEnd + 1] === '(') {
                let linkUrlEnd = text.indexOf(')', linkTextEnd + 2);
                if (linkUrlEnd !== -1) {
                    segments.push({
                        text: text.substring(i + 1, linkTextEnd),
                        style: 'link',
                        url: text.substring(linkTextEnd + 2, linkUrlEnd)
                    });
                    i = linkUrlEnd + 1;
                    continue;
                }
            }
        }

        // 列表项 - 或者 *
        if ((text[i] === '-' || text[i] === '*') && (i === 0 || text[i - 1] === '\n') && text[i + 1] === ' ') {
            let listEnd = text.indexOf('\n', i + 2);
            if (listEnd === -1) listEnd = text.length;
            segments.push({
                text: text.substring(i + 2, listEnd),
                style: 'listItem',
                isList: true
            });
            i = listEnd + 1;
            continue;
        }

        // 普通文本 - 读到下一个特殊字符
        let normalEnd = i;
        while (normalEnd < text.length) {
            if (text[normalEnd] === '`' || 
                text[normalEnd] === '*' || 
                text[normalEnd] === '#' ||
                text[normalEnd] === '[' ||
                text.substr(normalEnd, 3) === '```') {
                break;
            }
            normalEnd++;
        }
        if (normalEnd > i) {
            segments.push({
                text: text.substring(i, normalEnd),
                style: 'normal'
            });
            i = normalEnd;
        } else {
            i++;
        }
    }

    return segments;
}

export function highlightCode(code, lang) {
    const keywords = ['function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'import', 'export'];
    const strings = [];
    
    let result = [];
    let i = 0;
    let inString = false;
    let stringChar = '';

    while (i < code.length) {
        if (!inString && (code[i] === '"' || code[i] === "'" || code[i] === '`')) {
            inString = true;
            stringChar = code[i];
            let strStart = i;
            i++;
            while (i < code.length && code[i] !== stringChar) i++;
            result.push({ text: code.substring(strStart, i + 1), color: '#f1fa8c' });
            i++;
            continue;
        }

        if (!inString && /[a-zA-Z]/.test(code[i])) {
            let wordStart = i;
            while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) i++;
            let word = code.substring(wordStart, i);
            if (keywords.includes(word)) {
                result.push({ text: word, color: '#ff79c6' });
            } else {
                result.push({ text: word, color: '#8be9fd' });
            }
            continue;
        }

        if (!inString && /[0-9]/.test(code[i])) {
            let numStart = i;
            while (i < code.length && /[0-9]/.test(code[i])) i++;
            result.push({ text: code.substring(numStart, i), color: '#bd93f9' });
            continue;
        }

        result.push({ text: code[i], color: '#f8f8f2' });
        i++;
    }

    return result;
}
