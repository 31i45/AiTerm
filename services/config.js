'use strict';

const path = require('path');
const fs = require('fs');

/** @typedef {{ host: string, port: number }} ServerConfig */
/** @typedef {{ baseUrl: string, defaultModel: string }} OllamaConfig */
/** @typedef {{ enabled: boolean, password: string, sessionTimeout: number }} SecurityConfig */
/** @typedef {{ maxReconnectAttempts: number, reconnectDelayMs: number }} WsConfig */
/** @typedef {{ maxSessionsPerUser: number, maxCommandLength: number, rateLimit: { windowMs: number, maxRequests: number } }} LimitsConfig */
/** @typedef {{ server: ServerConfig, ollama: OllamaConfig, security: SecurityConfig, ws: WsConfig, limits: LimitsConfig }} AppConfig */

const DEFAULT_CONFIG = {
    server: { host: '127.0.0.1', port: 3000 },
    ollama: { baseUrl: 'http://127.0.0.1:11434', defaultModel: 'llama3.2' },
    security: { enabled: false, password: '', sessionTimeout: 3600000 },
    maxContextLength: 100,
    ws: { maxReconnectAttempts: 5, reconnectDelayMs: 1000 },
    limits: {
        maxSessionsPerUser: 10,
        maxCommandLength: 10000,
        rateLimit: { windowMs: 60000, maxRequests: 120 }
    },
    ui: {
        maxMessages: 500,
        maxMessagesFallback: 100
    }
};

class ConfigService {
    constructor() {
        /** @type {AppConfig} */
        this.config = { ...DEFAULT_CONFIG };
    }

    /**
     * 加载配置文件，支持环境变量覆盖
     * @param {string} [configPath] - 配置文件路径
     */
    load(configPath) {
        const filePath = configPath || path.join(__dirname, '..', 'config.json');
        try {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            this.config = this._deepMerge(DEFAULT_CONFIG, raw);
        } catch (e) {
            // 使用默认配置
        }
        this._applyEnvOverrides();
        return this.config;
    }

    /**
     * 获取配置值
     * @param {string} key - 配置键（支持点号分隔，如 'server.port'）
     * @returns {*}
     */
    get(key) {
        return key.split('.').reduce((obj, k) => obj?.[k], this.config);
    }

    /**
     * 深度合并对象
     * @private
     */
    _deepMerge(target, source) {
        const result = { ...target };
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this._deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    /**
     * 环境变量覆盖
     * @private
     */
    _applyEnvOverrides() {
        if (process.env.PORT) this.config.server.port = parseInt(process.env.PORT, 10);
        if (process.env.HOST) this.config.server.host = process.env.HOST;
        if (process.env.OLLAMA_BASE_URL) this.config.ollama.baseUrl = process.env.OLLAMA_BASE_URL;
        if (process.env.OLLAMA_MODEL) this.config.ollama.defaultModel = process.env.OLLAMA_MODEL;
        if (process.env.AITERM_PASSWORD) this.config.security.password = process.env.AITERM_PASSWORD;
        if (process.env.AITERM_SECURITY === 'true') this.config.security.enabled = true;
        if (process.env.LOG_LEVEL) this.config.logLevel = process.env.LOG_LEVEL;
    }
}

module.exports = new ConfigService();
