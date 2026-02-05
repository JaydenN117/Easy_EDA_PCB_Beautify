import { getCachedSettings } from './settings';

/**
 * Debug logging utility
 * Uses eda.sys_Log to output log messages
 */

/**
 * Log type
 */
type LogType = 'info' | 'warn' | 'error';

const BASE_PREFIX = 'Beautify';

/**
 * Format log prefix
 * @param scope Optional scope (e.g., Snapshot, PCB)
 * @param level Optional level (e.g., Error, Warning)
 */
function getPrefix(scope?: string, level?: string): string {
	let prefix = `[${BASE_PREFIX}`;
	if (scope)
		prefix += `-${scope}`;
	if (level)
		prefix += ` ${level}`;
	prefix += ']';
	return prefix;
}

/**
 * Add log entry
 * @param message - Log message
 * @param type - Log type (for eda.sys_Log control)
 * @param scope - Scope
 * @param level - Level string displayed in message
 */
export function log(message: string, type: LogType = 'info', scope?: string, level?: string): void {
	if (eda.sys_Log && typeof eda.sys_Log.add === 'function') {
		const prefix = getPrefix(scope, level);
		eda.sys_Log.add(`${prefix} ${message}`, type as any);
	}
}

/**
 * Output info log
 */
export function logInfo(message: string, scope?: string): void {
	log(message, 'info', scope);
}

/**
 * Output warning log
 */
export function logWarn(message: string, scope?: string): void {
	log(message, 'warn', scope, 'Warning');
}

/**
 * Output error log
 */
export function logError(message: string, scope?: string): void {
	log(message, 'error', scope, 'Error');
}

/**
 * Output debug log (for development debugging)
 * @param messageOrFirst - Log message or first argument
 * @param messages - Other optional arguments
 */
export function debugLog(messageOrFirst: any, ...messages: any[]): void {
	if (!getCachedSettings().debug)
		return;

	// Handle multi-argument case
	let fullMsg = '';
	if (messages.length > 0) {
		const all = [messageOrFirst, ...messages];
		fullMsg = all.map(m => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ');
	}
	else {
		fullMsg = typeof messageOrFirst === 'object' ? JSON.stringify(messageOrFirst) : String(messageOrFirst);
	}

	log(fullMsg, 'info', undefined, 'Debug');
}

/**
 * Output debug warning (only outputs in debug mode)
 */
export function debugWarn(message: string, scope?: string): void {
	if (!getCachedSettings().debug)
		return;
	log(message, 'warn', scope, 'Warning');
}
