import { debugLog, logError } from './logger';

/**
 * Safely get selected track objects.
 * Handles mixed selection (e.g., Track + Arc) that could cause API crashes.
 * @param selectedIds List of selected primitive IDs
 */
export async function getSafeSelectedTracks(selectedIds: string[]): Promise<any[]> {
	let lineObjects: any = null;

	// Filter invalid IDs
	const validIds = selectedIds.filter(id => id && typeof id === 'string');

	if (validIds.length > 0) {
		try {
			// Try batch retrieval
			lineObjects = await eda.pcb_PrimitiveLine.get(validIds);
		}
		catch (err: any) {
			debugLog(`[SafeGet] standard get() failed, trying getAll() fallback: ${err.message}`);
			// Fallback: degrade to getting all lines and filtering in memory
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

	// Ensure return value is an array, filtering out null/undefined
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
