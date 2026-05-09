'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * 日志读取服务 - 异步文件操作，避免阻塞事件循环
 */
class LogReaderService {
    /**
     * @param {import('../logger')} logger
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * 获取日志文件列表
     * @param {'audit' | 'app'} type
     * @returns {Promise<Array<{name: string, size: number, modified: Date}>>}
     */
    async getLogList(type) {
        const dir = type === 'audit' ? this.logger.AUDIT_LOG_DIR : this.logger.LOG_DIR;

        try {
            const files = await fs.readdir(dir);
            const logFiles = files.filter(f => f.endsWith('.log'));

            const details = await Promise.all(
                logFiles.map(async (name) => {
                    try {
                        const filePath = path.join(dir, name);
                        const stat = await fs.stat(filePath);
                        return { name, size: stat.size, modified: stat.mtime };
                    } catch {
                        return null;
                    }
                })
            );

            return details
                .filter(Boolean)
                .sort((a, b) => b.modified - a.modified);
        } catch (error) {
            this.logger.error('获取日志列表失败', { type, error: error.message });
            throw error;
        }
    }

    /**
     * 获取日志文件内容
     * @param {'audit' | 'app'} type
     * @param {string} filename
     * @param {object} [options]
     * @param {number} [options.maxSize=1048576] - 最大读取大小（默认 1MB）
     * @returns {Promise<{ content: string, filename: string, truncated: boolean }>}
     */
    async getLogContent(type, filename, options = {}) {
        const maxSize = options.maxSize || 1024 * 1024; // 1MB
        const dir = type === 'audit' ? this.logger.AUDIT_LOG_DIR : this.logger.LOG_DIR;

        // 防止路径遍历攻击 + 扩展名验证
        const safeName = path.basename(filename);
        if (safeName !== filename || !safeName.endsWith('.log')) {
            throw new Error('非法的文件名');
        }

        const filePath = path.join(dir, safeName);

        try {
            const stat = await fs.stat(filePath);
            if (stat.size > maxSize) {
                // 读取文件末尾内容
                const buffer = Buffer.alloc(maxSize);
                const fd = await fs.open(filePath, 'r');
                try {
                    await fd.read(buffer, 0, maxSize, stat.size - maxSize);
                    const content = buffer.toString('utf8');
                    return {
                        content: `\n... [文件过大，仅显示末尾 ${(maxSize / 1024).toFixed(0)}KB] ...\n\n${content}`,
                        filename: safeName,
                        truncated: true
                    };
                } finally {
                    await fd.close();
                }
            }

            const content = await fs.readFile(filePath, 'utf8');
            return { content, filename: safeName, truncated: false };
        } catch (error) {
            this.logger.error('获取日志内容失败', { type, filename: safeName, error: error.message });
            throw error;
        }
    }
}

module.exports = LogReaderService;
