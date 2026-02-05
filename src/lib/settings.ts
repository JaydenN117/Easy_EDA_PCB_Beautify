export interface BeautifySettings {
	syncWidthTransition: boolean; // Auto-handle width transitions when smoothing
	widthTransitionRatio: number; // Width transition length coefficient
	widthTransitionSegments: number; // Width transition segment count
	cornerRadius: number; // Corner radius
	mergeShortSegments: boolean; // Whether to merge short segments
	unit: 'mm' | 'mil'; // Unit setting
	debug: boolean; // Debug mode
	forceArc: boolean; // Force arc generation (even if segment is too short, causing truncation)
	enableDRC: boolean; // Enable DRC check
	drcClearance: number; // DRC safety clearance (mil)
}

const DEFAULT_SETTINGS: BeautifySettings = {
	syncWidthTransition: false,
	widthTransitionRatio: 3, // Transition length = width difference * 3
	widthTransitionSegments: 25,
	cornerRadius: 20, // Default 20mil
	mergeShortSegments: false,
	unit: 'mil',
	debug: false,
	forceArc: true,
	enableDRC: false,
	drcClearance: 6,
};

const SETTINGS_CACHE_KEY = '_jlc_beautify_settings_cache';

/**
 * Get default settings
 */
export function getDefaultSettings(): BeautifySettings {
	return { ...DEFAULT_SETTINGS };
}

/**
 * Get latest settings
 */
export async function getSettings(): Promise<BeautifySettings> {
	try {
		const configs = await eda.sys_Storage.getExtensionAllUserConfigs();
		const newSettings = { ...DEFAULT_SETTINGS, ...configs };
		(eda as any)[SETTINGS_CACHE_KEY] = newSettings;
		return newSettings;
	}
	catch {
		return getCachedSettings();
	}
}

/**
 * Synchronously get cached settings (no await needed)
 */
export function getCachedSettings(): BeautifySettings {
	return (eda as any)[SETTINGS_CACHE_KEY] || { ...DEFAULT_SETTINGS };
}

/**
 * Save settings and update cache
 */
export async function saveSettings(settings: BeautifySettings): Promise<void> {
	await eda.sys_Storage.setExtensionAllUserConfigs(settings as any);
	(eda as any)[SETTINGS_CACHE_KEY] = { ...settings };
}
