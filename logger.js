const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// 自定义日志级别（完整包含所有需要的级别）
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'blue',
    silly: 'gray'
  }
};

// 应用自定义颜色
winston.addColors(customLevels.colors);

// 日志目录配置
const LOG_DIR = path.join(__dirname, 'logs');
const AUDIT_LOG_DIR = path.join(__dirname, 'audit_logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
if (!fs.existsSync(AUDIT_LOG_DIR)) fs.mkdirSync(AUDIT_LOG_DIR);

// ============================================
// 1. 应用调试日志系统（超级详细）
// ============================================
const appLogger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.LOG_LEVEL || 'debug', // 支持的级别: error, warn, info, http, verbose, debug, silly
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }), // 记录错误堆栈
    winston.format.json() // 结构化 JSON 格式
  ),
  defaultMeta: { service: 'aiterm' },
  transports: [
    // 错误日志 - 单独文件
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d' // 保留30天
    }),
    // 警告日志 - 单独文件
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'warn-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'warn',
      maxSize: '20m',
      maxFiles: '30d'
    }),
    // 普通日志 - 合并所有级别（包括 verbose 和 silly）
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'silly', // 记录所有级别！
      maxSize: '50m',
      maxFiles: '30d'
    }),
    // 调试专用日志 - 超级详细
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'debug-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'debug',
      maxSize: '100m',
      maxFiles: '7d'
    })
  ]
});

// 如果不是生产环境，同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
  appLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `[${timestamp}] [${level}] ${message}`;
        if (Object.keys(meta).length > 0) {
          msg += ' ' + JSON.stringify(meta, null, 2);
        }
        return msg;
      })
    )
  }));
}

// ============================================
// 2. 审计日志系统（专业最佳实践）
// ============================================
const auditLogger = winston.createLogger({
  levels: customLevels.levels,
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.json()
  ),
  defaultMeta: { service: 'aiterm' },
  transports: [
    // 按天滚动的审计日志
    new DailyRotateFile({
      filename: path.join(AUDIT_LOG_DIR, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '90d' // 审计日志保留90天
    })
  ]
});

// 审计日志类型常量
const AUDIT_TYPES = {
  SESSION_START: 'session_start',
  SESSION_CLOSE: 'session_close',
  TERMINAL_INPUT: 'terminal_input',
  TERMINAL_OUTPUT: 'terminal_output',
  AI_REQUEST: 'ai_request',
  AI_RESPONSE: 'ai_response',
  AI_ERROR: 'ai_error',
  ERROR: 'error',
  WEBSOCKET_CONNECT: 'websocket_connect',
  WEBSOCKET_DISCONNECT: 'websocket_disconnect',
  API_REQUEST: 'api_request',
  API_RESPONSE: 'api_response'
};

// 审计日志函数 - 完美修复！
function auditLog(sessionId, type, data = {}) {
  // 正确的审计日志格式
  const auditData = {
    sessionId,
    type,
    ...data
  };
  
  auditLogger.info('AUDIT_EVENT', auditData);
  
  // 同时在应用日志中记录审计信息（verbose级别）
  appLogger.verbose('AUDIT_EVENT', auditData);
}

// ============================================
// 3. 导出日志接口
// ============================================
module.exports = {
  // 应用日志
  app: appLogger,
  
  // 审计日志
  audit: auditLog,
  AUDIT_TYPES,
  
  // 便捷方法
  error: (msg, meta) => appLogger.error(msg, meta),
  warn: (msg, meta) => appLogger.warn(msg, meta),
  info: (msg, meta) => appLogger.info(msg, meta),
  http: (msg, meta) => appLogger.http(msg, meta),
  verbose: (msg, meta) => appLogger.verbose(msg, meta),
  debug: (msg, meta) => appLogger.debug(msg, meta),
  silly: (msg, meta) => appLogger.silly(msg, meta),
  
  // 日志目录
  LOG_DIR,
  AUDIT_LOG_DIR
};
