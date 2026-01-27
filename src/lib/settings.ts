export interface SmoothSettings {
	replaceOriginal: boolean;
	syncTeardrops: boolean; // 平滑时同步生成泪滴
	smoothRatio: number;
	teardropSize: number;
	iterations: number;
	cornerRadius: number;
	unit: 'mm' | 'mil'; // 单位设置
	debug: boolean; // 调试模式
}

const DEFAULT_SETTINGS: SmoothSettings = {
	replaceOriginal: true,
	syncTeardrops: true,
	smoothRatio: 0.2,
	teardropSize: 0.8,
	iterations: 1,
	cornerRadius: 0.5, // 默认 0.5mm
	unit: 'mm',
	debug: false,
};

export async function getSettings(): Promise<SmoothSettings> {
	try {
		const configs = await eda.sys_Storage.getExtensionAllUserConfigs();
		return { ...DEFAULT_SETTINGS, ...configs };
	}
	catch {
		return DEFAULT_SETTINGS;
	}
}

export async function saveSettings(settings: SmoothSettings): Promise<void> {
	await eda.sys_Storage.setExtensionAllUserConfigs(settings as any);
}
