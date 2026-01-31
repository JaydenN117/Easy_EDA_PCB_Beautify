import { debugLog, logError } from './logger';

/**
 * 安全地获取选中的导线对象
 * 处理了混合选中（如 Track + Arc）导致 API 崩溃的情况
 * @param selectedIds 选中的图元 ID 列表
 */
export async function getSafeSelectedTracks(selectedIds: string[]): Promise<any[]> {
	let lineObjects: any = null;

	// 过滤非法 ID
	const validIds = selectedIds.filter(id => id && typeof id === 'string');

	if (validIds.length > 0) {
		try {
			// 尝试批量获取
			lineObjects = await eda.pcb_PrimitiveLine.get(validIds);
		}
		catch (err: any) {
			debugLog(`[SafeGet] standard get() failed, trying getAll() fallback: ${err.message}`);
			// Fallback: 降级为获取所有线并在内存中过滤
			try {
				const allLines = await eda.pcb_PrimitiveLine.getAll();
				if (Array.isArray(allLines)) {
					const idSet = new Set(validIds);
					lineObjects = allLines.filter((line: any) => {
						let pid = '';
						if (typeof line.getState_PrimitiveId === 'function')
							pid = line.getState_PrimitiveId();
						else if (line.primitiveId)
							pid = line.primitiveId;

						return pid && idSet.has(pid);
					});
					debugLog(`[SafeGet] Fallback recovered ${lineObjects.length} lines`);
				}
			}
			catch (e2: any) {
				logError(`[SafeGet Error] Fallback getAll() also failed: ${e2.message}`);
			}
		}
	}

	// 确保返回的是数组，并过滤掉 null/undefined
	let selectedTracks: any[] = [];
	if (lineObjects) {
		if (Array.isArray(lineObjects)) {
			selectedTracks = lineObjects.filter((p: any) => p !== null && p !== undefined);
		}
		else {
			selectedTracks = [lineObjects];
		}
	}

	return selectedTracks;
}
