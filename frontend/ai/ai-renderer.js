import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { STYLES, parseMarkdownToSegments, highlightCode } from './markdown-parser.js';

const LINE_HEIGHT = 22;
const padding = { left: 20, right: 20, top: 16, bottom: 16 };
const messageSpacing = 20;
const MAX_CACHE_SIZE = 50;
const CONTENT_BOTTOM_PADDING = 30; // 最后一条消息底部与 Canvas 底部的间距

const aiMessages = [];
const preparedMessages = new Map();
const layoutCache = new Map();
let scrollY = 0;
let isDragging = false;
let dragStartY = 0;
let dragStartScrollY = 0;
let userHasScrolledUp = false;
let isAiTyping = false;

let aiCanvas;
let ctx;
let dpr;
let showToastFn;

let needsRender = true;
let animationFrameId = null;

let textSelection = {
    active: false,
    startMessageIndex: -1,
    startLineIndex: -1,
    startGraphemeIndex: 0,
    endMessageIndex: -1,
    endLineIndex: -1,
    endGraphemeIndex: 0
};

let selectionVisual = { rects: [] };

function addToCache(cache, key, value) {
    if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, value);
}

export function initAICanvas(canvasId, toastFn) {
    aiCanvas = document.getElementById(canvasId);
    ctx = aiCanvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    showToastFn = toastFn;
    initEventListeners();
}

function requestRender() {
    needsRender = true;
    if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(renderAICanvas);
    }
}

function initEventListeners() {
    aiCanvas.addEventListener('mousedown', (e) => {
        const rect = aiCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top + scrollY;

        const result = findPositionAtPoint(x, y);
        if (result) {
            textSelection = {
                active: true,
                startMessageIndex: result.messageIndex,
                startLineIndex: result.lineIndex,
                startGraphemeIndex: result.graphemeIndex,
                endMessageIndex: result.messageIndex,
                endLineIndex: result.lineIndex,
                endGraphemeIndex: result.graphemeIndex
            };
            selectionVisual.rects = computeSelectionRects();
        } else {
            textSelection.active = false;
            selectionVisual.rects = [];
        }

        isDragging = true;
        dragStartY = e.clientY;
        dragStartScrollY = scrollY;
        aiCanvas.style.cursor = 'text';
        requestRender();
    });

    aiCanvas.addEventListener('dblclick', (e) => {
        const rect = aiCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top + scrollY;

        const result = findPositionAtPoint(x, y);
        if (result && result.line && result.line.prepared) {
            selectEntireWord(result);
        } else if (textSelection.active) {
            const text = getSelectedText();
            if (text) {
                copyTextToClipboard(text);
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const rect = aiCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top + scrollY;

            if (textSelection.active) {
                const result = findPositionAtPoint(x, y);
                if (result) {
                    textSelection.endMessageIndex = result.messageIndex;
                    textSelection.endLineIndex = result.lineIndex;
                    textSelection.endGraphemeIndex = result.graphemeIndex;
                    selectionVisual.rects = computeSelectionRects();
                }
            }

            const delta = dragStartY - e.clientY;
            const maxScroll = Math.max(0, calculateContentHeight() - (aiCanvas.height / dpr));
            scrollY = Math.max(0, Math.min(maxScroll, dragStartScrollY + delta));
            userHasScrolledUp = scrollY < maxScroll - 10;
            requestRender();
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        aiCanvas.style.cursor = 'text';
    });

    aiCanvas.addEventListener('wheel', (e) => {
        const maxScroll = Math.max(0, calculateContentHeight() - (aiCanvas.height / dpr));
        scrollY = Math.max(0, Math.min(maxScroll, scrollY + e.deltaY));
        userHasScrolledUp = scrollY < maxScroll - 10;
        requestRender();
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (textSelection.active) {
                const text = getSelectedText();
                if (text) {
                    copyTextToClipboard(text);
                }
            } else {
                const text = getAllMessagesText();
                if (text) {
                    copyTextToClipboard(text);
                }
            }
        }
    });
}

function copyTextToClipboard(text) {
    if (!text) return;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToastFn('已复制到剪贴板');
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-99999px';
    textArea.style.top = '-99999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToastFn('已复制到剪贴板');
    } catch {
        showToastFn('复制失败，请手动选择复制', 'error');
    } finally {
        document.body.removeChild(textArea);
    }
}

function getAllMessagesText() {
    return aiMessages.map(msg => msg.text).join('\n\n');
}

function getSelectedText() {
    if (!textSelection.active) return '';

    let startMsgIdx = Math.min(textSelection.startMessageIndex, textSelection.endMessageIndex);
    let endMsgIdx = Math.max(textSelection.startMessageIndex, textSelection.endMessageIndex);

    let text = '';

    for (let msgIdx = startMsgIdx; msgIdx <= endMsgIdx; msgIdx++) {
        const msg = aiMessages[msgIdx];
        const styledSegments = getPreparedStyledSegments(msg);
        const width = Math.min(420, (aiCanvas.width / dpr) - padding.left - padding.right);
        const layout = getLayout(styledSegments, width - 32);

        let startLineIdx = 0;
        let endLineIdx = layout.lines.length - 1;

        if (msgIdx === textSelection.startMessageIndex && textSelection.startMessageIndex === textSelection.endMessageIndex) {
            startLineIdx = Math.min(textSelection.startLineIndex, textSelection.endLineIndex);
            endLineIdx = Math.max(textSelection.startLineIndex, textSelection.endLineIndex);
        } else if (msgIdx === textSelection.startMessageIndex) {
            startLineIdx = textSelection.startLineIndex;
        } else if (msgIdx === textSelection.endMessageIndex) {
            endLineIdx = textSelection.endLineIndex;
        }

        for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx++) {
            const line = layout.lines[lineIdx];
            let lineText = line.text;

            if (msgIdx === textSelection.startMessageIndex && lineIdx === startLineIdx && textSelection.startMessageIndex === textSelection.endMessageIndex) {
                const startG = Math.min(textSelection.startGraphemeIndex, textSelection.endGraphemeIndex);
                const endG = Math.max(textSelection.startGraphemeIndex, textSelection.endGraphemeIndex);
                lineText = line.text.slice(startG, endG);
            } else if (msgIdx === textSelection.startMessageIndex && lineIdx === startLineIdx) {
                const startG = textSelection.startGraphemeIndex;
                lineText = line.text.slice(startG);
            } else if (msgIdx === textSelection.endMessageIndex && lineIdx === endLineIdx) {
                const endG = textSelection.endGraphemeIndex;
                lineText = line.text.slice(0, endG);
            }

            text += lineText;
            if (lineIdx < endLineIdx || msgIdx < endMsgIdx) {
                text += '\n';
            }
        }

        if (msgIdx < endMsgIdx) {
            text += '\n';
        }
    }

    return text.trim();
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function selectEntireWord(result) {
    const line = result.line;
    const lineText = line.text;
    const graphemeIndex = result.graphemeIndex;

    let wordStart = graphemeIndex;
    let wordEnd = graphemeIndex;

    const isWordChar = (i) => {
        if (i < 0 || i >= lineText.length) return false;
        const ch = lineText[i];
        return /[\p{L}\p{N}]/u.test(ch);
    };

    while (wordStart > 0 && isWordChar(wordStart - 1)) {
        wordStart--;
    }
    while (wordEnd < lineText.length && isWordChar(wordEnd)) {
        wordEnd++;
    }

    textSelection = {
        active: true,
        startMessageIndex: result.messageIndex,
        startLineIndex: result.lineIndex,
        startGraphemeIndex: wordStart,
        endMessageIndex: result.messageIndex,
        endLineIndex: result.lineIndex,
        endGraphemeIndex: wordEnd
    };
    selectionVisual.rects = computeSelectionRects();
    requestRender();
}

function findPositionAtPoint(x, y) {
    let currentY = padding.top;

    for (let msgIdx = 0; msgIdx < aiMessages.length; msgIdx++) {
        const msg = aiMessages[msgIdx];
        const isUserMsg = msg.type === 'user';
        const maxBubbleWidth = (aiCanvas.width / dpr) - padding.left - padding.right;
        const bubbleX = padding.left;
        const bubbleWidth = maxBubbleWidth;

        const styledSegments = getPreparedStyledSegments(msg);
        const layout = getLayout(styledSegments, bubbleWidth - 80);
        const bubbleHeight = layout.height + 12;
        const bubbleY = currentY;

        if (y >= bubbleY && y <= bubbleY + bubbleHeight) {
            let lineY = bubbleY + 4;
            
            ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace';
            const label = `[${isUserMsg ? '你' : 'AI'} ${formatTime(msg.time)}]`;
            const labelWidth = ctx.measureText(label).width + 8;

            for (let lineIdx = 0; lineIdx < layout.lines.length; lineIdx++) {
                const line = layout.lines[lineIdx];
                let lineHeight = LINE_HEIGHT;

                if (line.isHeader) {
                    lineHeight = line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
                } else if (line.isCodeBlock) {
                    lineHeight = 20;
                }

                if (y >= lineY && y <= lineY + lineHeight) {
                    let textX = bubbleX;
                    if (line.isCodeBlock) {
                        textX = bubbleX + 8;
                    } else if (lineIdx === 0) {
                        textX = bubbleX + labelWidth;
                    } else {
                        textX = bubbleX;
                    }
                    
                    let graphemeIndex = 0;

                    if (x > textX) {
                        let currentX = textX;
                        for (let i = 0; i < line.text.length; i++) {
                            const charWidth = ctx.measureText(line.text[i]).width;
                            if (x >= currentX && x < currentX + charWidth) {
                                graphemeIndex = i;
                                break;
                            }
                            if (x >= currentX + charWidth) {
                                graphemeIndex = i + 1;
                            }
                            currentX += charWidth;
                        }
                    }

                    return {
                        messageIndex: msgIdx,
                        lineIndex: lineIdx,
                        graphemeIndex: graphemeIndex,
                        bubbleX,
                        bubbleY,
                        lineY,
                        line,
                        layout
                    };
                }

                if (line.isCodeBlock) {
                    lineY += 20;
                } else if (line.isHeader) {
                    lineY += line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
                } else {
                    lineY += LINE_HEIGHT;
                }
            }
        }

        currentY += bubbleHeight + 8;
    }

    return null;
}

function computeSelectionRects() {
    if (!textSelection.active) return [];

    const rects = [];
    let startMsgIdx = Math.min(textSelection.startMessageIndex, textSelection.endMessageIndex);
    let endMsgIdx = Math.max(textSelection.startMessageIndex, textSelection.endMessageIndex);
    let currentY = padding.top;

    for (let msgIdx = 0; msgIdx < aiMessages.length; msgIdx++) {
        const msg = aiMessages[msgIdx];
        const isUserMsg = msg.type === 'user';
        const maxBubbleWidth = (aiCanvas.width / dpr) - padding.left - padding.right;
        const bubbleX = padding.left;
        const bubbleWidth = maxBubbleWidth;

        const styledSegments = getPreparedStyledSegments(msg);
        const layout = getLayout(styledSegments, bubbleWidth - 80);
        const bubbleHeight = layout.height + 12;
        const bubbleY = currentY;

        if (msgIdx >= startMsgIdx && msgIdx <= endMsgIdx) {
            let lineY = bubbleY + 4;
            
            ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace';
            const label = `[${isUserMsg ? '你' : 'AI'} ${formatTime(msg.time)}]`;
            const labelWidth = ctx.measureText(label).width + 8;
            
            let startLineIdx = 0;
            let endLineIdx = layout.lines.length - 1;

            if (msgIdx === textSelection.startMessageIndex && textSelection.startMessageIndex !== textSelection.endMessageIndex) {
                startLineIdx = textSelection.startLineIndex;
            } else if (msgIdx === textSelection.endMessageIndex && textSelection.startMessageIndex !== textSelection.endMessageIndex) {
                endLineIdx = textSelection.endLineIndex;
            } else if (textSelection.startMessageIndex === textSelection.endMessageIndex) {
                startLineIdx = Math.min(textSelection.startLineIndex, textSelection.endLineIndex);
                endLineIdx = Math.max(textSelection.startLineIndex, textSelection.endLineIndex);
            }

            for (let lineIdx = 0; lineIdx < layout.lines.length; lineIdx++) {
                const line = layout.lines[lineIdx];
                let lineHeight = LINE_HEIGHT;

                if (line.isHeader) {
                    lineHeight = line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
                } else if (line.isCodeBlock) {
                    lineHeight = 20;
                }

                if (lineIdx >= startLineIdx && lineIdx <= endLineIdx) {
                    ctx.font = line.font;
                    let textStartX = bubbleX;
                    if (line.isCodeBlock) {
                        textStartX = bubbleX + 8;
                    } else if (lineIdx === 0) {
                        textStartX = bubbleX + labelWidth;
                    } else {
                        textStartX = bubbleX;
                    }
                    
                    let textWidth = line.width || ctx.measureText(line.text).width;

                    if (msgIdx === textSelection.startMessageIndex && lineIdx === startLineIdx && textSelection.startMessageIndex === textSelection.endMessageIndex) {
                        const startG = Math.min(textSelection.startGraphemeIndex, textSelection.endGraphemeIndex);
                        const endG = Math.max(textSelection.startGraphemeIndex, textSelection.endGraphemeIndex);
                        const startText = line.text.slice(0, startG);
                        const selectedText = line.text.slice(startG, endG);
                        textStartX += ctx.measureText(startText).width;
                        textWidth = ctx.measureText(selectedText).width;
                    } else if (msgIdx === textSelection.startMessageIndex && lineIdx === startLineIdx) {
                        const startG = textSelection.startGraphemeIndex;
                        const startText = line.text.slice(0, startG);
                        textStartX += ctx.measureText(startText).width;
                        textWidth -= ctx.measureText(startText).width;
                    } else if (msgIdx === textSelection.endMessageIndex && lineIdx === endLineIdx) {
                        const endG = textSelection.endGraphemeIndex;
                        const endText = line.text.slice(endG);
                        textWidth -= ctx.measureText(endText).width;
                    }

                    rects.push({
                        x: textStartX,
                        y: lineY + LINE_HEIGHT - 2,
                        width: textWidth,
                        height: lineHeight - 2
                    });
                }

                if (line.isCodeBlock) {
                    lineY += 20;
                } else if (line.isHeader) {
                    lineY += line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
                } else {
                    lineY += LINE_HEIGHT;
                }
            }
        }

        currentY += bubbleHeight + 8;
    }

    return rects;
}

export function resizeCanvas() {
    const rect = aiCanvas.parentElement.getBoundingClientRect();
    const inputHeight = 76;
    const canvasHeight = rect.height - inputHeight;

    aiCanvas.width = rect.width * dpr;
    aiCanvas.height = canvasHeight * dpr;
    aiCanvas.style.width = rect.width + 'px';
    aiCanvas.style.height = canvasHeight + 'px';

    requestRender();
}

function ensureScale() {
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
}

function calculateContentHeight() {
    const width = (aiCanvas.width / dpr) - padding.left - padding.right;
    let y = padding.top;

    for (const msg of aiMessages) {
        const styledSegments = getPreparedStyledSegments(msg);
        const layout = getLayout(styledSegments, width - 80);
        const bubbleHeight = layout.height + 12;
        y += bubbleHeight + 8;
    }

    if (isAiTyping) {
        y += 24;
    }

    return y + padding.bottom + CONTENT_BOTTOM_PADDING;
}

function getPreparedStyledSegments(message) {
    const key = message.text + ':' + message.type;
    if (preparedMessages.has(key)) {
        return preparedMessages.get(key);
    }

    const segments = parseMarkdownToSegments(message.text);
    const styledSegments = [];

    for (const seg of segments) {
        const style = STYLES[seg.style] || STYLES.normal;
        styledSegments.push({
            text: seg.text,
            style: seg.style,
            font: style.font,
            color: style.color,
            background: style.background,
            padding: style.padding,
            isHeader: seg.isHeader,
            isList: seg.isList,
            isCodeBlock: seg.style === 'codeBlock',
            isCode: seg.style === 'code',
            url: seg.url,
            lang: seg.lang
        });
    }

    addToCache(preparedMessages, key, styledSegments);
    return styledSegments;
}

function getLayout(styledSegments, width) {
    const key = JSON.stringify(styledSegments.map(s => ({text: s.text, style: s.style}))) + ':' + width;
    if (layoutCache.has(key)) {
        return layoutCache.get(key);
    }

    const lines = [];
    let currentY = 0;

    for (let i = 0; i < styledSegments.length; i++) {
        const seg = styledSegments[i];

        if (seg.isCodeBlock) {
            const prepared = prepareWithSegments(seg.text, seg.font, {
                wordBreak: 'normal',
                whiteSpace: 'pre'
            });
            const layoutResult = layoutWithLines(prepared, width - 24, 20);

            for (let lineIdx = 0; lineIdx < layoutResult.lines.length; lineIdx++) {
                const line = layoutResult.lines[lineIdx];
                lines.push({
                    text: line.text,
                    style: seg.style,
                    font: seg.font,
                    color: seg.color,
                    background: seg.background,
                    padding: seg.padding,
                    y: currentY,
                    isCodeBlock: true,
                    highlightedCode: highlightCode(line.text, seg.lang),
                    width: line.width,
                    start: line.start,
                    end: line.end,
                    prepared
                });
                currentY += 20;
            }
            currentY += 8;
            continue;
        }

        if (seg.isHeader) {
            const lineHeight = seg.style === 'h1' ? 32 : seg.style === 'h2' ? 28 : 24;
            const prepared = prepareWithSegments(seg.text, seg.font, {
                wordBreak: 'keep-all',
                letterSpacing: 0.5
            });
            const layoutResult = layoutWithLines(prepared, width, lineHeight);

            for (let lineIdx = 0; lineIdx < layoutResult.lines.length; lineIdx++) {
                const line = layoutResult.lines[lineIdx];
                lines.push({
                    text: line.text,
                    style: seg.style,
                    font: seg.font,
                    color: seg.color,
                    y: currentY,
                    isHeader: true,
                    width: line.width,
                    start: line.start,
                    end: line.end,
                    prepared
                });
                currentY += lineHeight;
            }
            continue;
        }

        const prepared = prepareWithSegments(seg.text, seg.font, {
            wordBreak: 'normal',
            letterSpacing: 0.2
        });
        const layoutResult = layoutWithLines(prepared, width, LINE_HEIGHT);

        for (let lineIdx = 0; lineIdx < layoutResult.lines.length; lineIdx++) {
            const line = layoutResult.lines[lineIdx];
            lines.push({
                text: line.text,
                style: seg.style,
                font: seg.font,
                color: seg.color,
                background: seg.background,
                padding: seg.padding,
                y: currentY,
                isCode: seg.isCode,
                url: seg.url,
                isList: seg.isList,
                width: line.width,
                start: line.start,
                end: line.end,
                prepared
            });
            currentY += LINE_HEIGHT;
        }
    }

    const result = { lines, height: currentY };
    addToCache(layoutCache, key, result);
    return result;
}

export function renderAICanvas() {
    if (!needsRender && !isAiTyping) {
        animationFrameId = requestAnimationFrame(renderAICanvas);
        return;
    }

    ensureScale();

    const width = aiCanvas.width / dpr;
    const height = aiCanvas.height / dpr;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#21222c';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(0, -scrollY);

    let y = padding.top;

    for (let msgIdx = 0; msgIdx < aiMessages.length; msgIdx++) {
        const msg = aiMessages[msgIdx];
        const isUserMsg = msg.type === 'user';
        const maxBubbleWidth = width - padding.left - padding.right;
        const bubbleX = padding.left;
        const bubbleWidth = maxBubbleWidth;

        const styledSegments = getPreparedStyledSegments(msg);
        const layout = getLayout(styledSegments, bubbleWidth - 80);
        const bubbleHeight = layout.height + 12;
        const bubbleY = y;

        // 绘制标签 [你 14:06] 或 [AI 14:06]
        ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace';
        const label = `[${isUserMsg ? '你' : 'AI'} ${formatTime(msg.time)}]`;
        ctx.fillStyle = isUserMsg ? '#57c7ff' : '#bd93f9';
        ctx.fillText(label, bubbleX, bubbleY + 4);

        let contentY = bubbleY + 4;
        let labelWidth = ctx.measureText(label).width + 8;
        let isFirstLine = true;

        let inCodeBlock = false;
        let codeBlockY = 0;
        let codeBlockHeight = 0;
        const codeBlocks = [];
        let tempY = contentY + LINE_HEIGHT;

        for (const line of layout.lines) {
            if (line.isCodeBlock && !inCodeBlock) {
                inCodeBlock = true;
                codeBlockY = tempY - 4;
                codeBlockHeight = 0;
            }
            if (inCodeBlock) {
                codeBlockHeight += 20;
            }
            if (!line.isCodeBlock && inCodeBlock) {
                inCodeBlock = false;
                codeBlocks.push({y: codeBlockY, height: codeBlockHeight});
            }
            if (line.isCodeBlock) {
                tempY += 20;
            } else if (line.isHeader) {
                tempY += line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
            } else {
                tempY += LINE_HEIGHT;
            }
        }
        if (inCodeBlock) {
            codeBlocks.push({y: codeBlockY, height: codeBlockHeight});
        }

        // 绘制代码块背景
        for (const block of codeBlocks) {
            ctx.fillStyle = '#282a36';
            ctx.beginPath();
            ctx.roundRect(bubbleX, block.y, bubbleWidth, block.height + 8, 4);
            ctx.fill();
        }

        contentY = bubbleY + 4;
        inCodeBlock = false;
        isFirstLine = true;

        ctx.textBaseline = 'top';

        for (const line of layout.lines) {
            if (line.isCodeBlock && !inCodeBlock) {
                inCodeBlock = true;
            }
            if (!line.isCodeBlock && inCodeBlock) {
                inCodeBlock = false;
            }

            let lineX = bubbleX + (isFirstLine ? labelWidth : 0);
            
            if (line.isCodeBlock) {
                ctx.font = line.font;
                let x = bubbleX + 8;
                for (const token of line.highlightedCode) {
                    ctx.fillStyle = token.color;
                    ctx.fillText(token.text, x, contentY + LINE_HEIGHT - 2);
                    x += ctx.measureText(token.text).width;
                }
                contentY += 20;
                isFirstLine = false;
                continue;
            }

            if (line.isCode) {
                ctx.fillStyle = line.background || 'rgba(255, 121, 198, 0.1)';
                ctx.font = line.font;
                const textWidth = line.width || ctx.measureText(line.text).width;
                ctx.beginPath();
                ctx.roundRect(lineX, contentY + LINE_HEIGHT - 4, textWidth + 8, 20, 4);
                ctx.fill();
            }

            if (line.isHeader) {
                ctx.font = line.font;
                ctx.fillStyle = line.color;
                ctx.fillText(line.text, lineX, contentY + LINE_HEIGHT - 2);
                contentY += line.style === 'h1' ? 32 : line.style === 'h2' ? 28 : 24;
                isFirstLine = false;
                continue;
            }

            if (line.isList) {
                ctx.font = line.font;
                ctx.fillStyle = '#57c7ff';
                ctx.fillText('•', lineX, contentY + LINE_HEIGHT - 2);
                ctx.fillStyle = line.color;
                ctx.fillText(line.text, lineX + 16, contentY + LINE_HEIGHT - 2);
                contentY += LINE_HEIGHT;
                isFirstLine = false;
                continue;
            }

            if (line.url) {
                ctx.font = line.font;
                ctx.fillStyle = line.color;
                ctx.fillText(line.text, lineX, contentY + LINE_HEIGHT - 2);
                ctx.beginPath();
                ctx.strokeStyle = line.color;
                ctx.lineWidth = 1;
                const textWidth = line.width || ctx.measureText(line.text).width;
                ctx.moveTo(lineX, contentY + LINE_HEIGHT + 14);
                ctx.lineTo(lineX + textWidth, contentY + LINE_HEIGHT + 14);
                ctx.stroke();
            } else {
                ctx.font = line.font;
                ctx.fillStyle = line.color;
                ctx.fillText(line.text, lineX, contentY + LINE_HEIGHT - 2);
            }

            contentY += LINE_HEIGHT;
            isFirstLine = false;
        }

        y += bubbleHeight + 8;
    }

    if (isAiTyping) {
        ctx.font = 'bold 12px "Cascadia Code", "Consolas", monospace';
        ctx.fillStyle = '#bd93f9';
        ctx.fillText('[AI ...]', padding.left, y + 4);
        
        const time = Date.now() / 400;
        for (let i = 0; i < 3; i++) {
            const alpha = 0.3 + 0.7 * (Math.sin(time + i) * 0.5 + 0.5);
            ctx.fillStyle = `rgba(189, 147, 249, ${Math.max(0.3, alpha)})`;
            ctx.beginPath();
            ctx.arc(padding.left + 55 + i * 8, y + 10, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (textSelection.active && selectionVisual.rects.length > 0) {
        ctx.fillStyle = 'rgba(87, 199, 255, 0.3)';
        for (const rect of selectionVisual.rects) {
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 3);
            ctx.fill();
        }
    }

    const contentHeight = calculateContentHeight();
    if (contentHeight > height) {
        const scrollbarWidth = 6;
        const scrollbarX = width - scrollbarWidth - 4;
        const scrollbarHeight = (height / contentHeight) * height;
        const scrollbarY = (scrollY / contentHeight) * height;

        ctx.fillStyle = 'rgba(68, 71, 90, 0.6)';
        ctx.beginPath();
        ctx.roundRect(scrollbarX, scrollbarY + padding.top, scrollbarWidth, Math.max(20, scrollbarHeight), 3);
        ctx.fill();
    }

    ctx.restore();

    needsRender = false;

    if (isAiTyping) {
        animationFrameId = requestAnimationFrame(renderAICanvas);
    } else {
        animationFrameId = null;
    }
}

export function addMessage(type, text) {
    aiMessages.push({ type, text, time: new Date() });
    requestRender();
}

export function updateLastAIMessage(text) {
    if (aiMessages.length > 0 && aiMessages[aiMessages.length - 1].type === 'ai') {
        aiMessages[aiMessages.length - 1].text = text;
    } else {
        aiMessages.push({ type: 'ai', text, time: new Date() });
    }
    scrollToBottomIfNeeded();
    requestRender();
}

export function setAiTyping(val) {
    isAiTyping = val;
    scrollToBottomIfNeeded();
    requestRender();
}

function scrollToBottomIfNeeded() {
    if (!userHasScrolledUp) {
        const maxScroll = Math.max(0, calculateContentHeight() - (aiCanvas.height / dpr));
        scrollY = maxScroll;
    }
}

export function clearUserScrollFlag() {
    userHasScrolledUp = false;
    scrollToBottomIfNeeded();
    requestRender();
}
