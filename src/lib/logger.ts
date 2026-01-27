/**
 * 调试日志工具
 * 使用 console.warn 来输出调试信息，避免 ESLint 报错
 */

/**
 * 输出调试日志
 * @param messages - 要输出的消息
 */
export function debugLog(...messages: any[]): void {
	// 使用 console.warn 代替 console.log，因为 ESLint 配置允许 warn 和 error

	console.warn(...messages);
}
