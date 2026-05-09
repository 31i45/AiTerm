'use strict';

const configService = require('./config');
const SecurityService = require('./security');
const OllamaService = require('./ollama');
const LogReaderService = require('./log-reader');

/**
 * 服务容器 - 统一管理所有服务实例
 * 提供依赖注入，避免模块间直接耦合
 */
class ServiceContainer {
    /**
     * @param {import('../logger')} logger
     */
    constructor(logger) {
        this.logger = logger;
        this.config = configService;
        this.config.load();

        this.security = new SecurityService(this.config, this.logger);
        this.ollama = new OllamaService(this.config, this.logger);
        this.logReader = new LogReaderService(this.logger);

        // 定期清理过期会话
        this._cleanupTimer = setInterval(() => {
            this.security.cleanupExpired();
        }, 5 * 60 * 1000); // 每 5 分钟清理一次
    }

    /**
     * 销毁所有服务资源
     */
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this.security.destroy();
        this.ollama.destroy();
    }
}

module.exports = ServiceContainer;
