import { getArcLineWidthMap, makeArcWidthKey } from './beautify';
import { debugLog, logError, logWarn } from './logger';
import { isClose } from './math';

const SNAPSHOT_STORAGE_KEY_V2 = 'jlc_eda_beautify_snapshots_v2';
// In-memory cache key, mounted on the eda object
const CACHE_KEY_V2 = '_jlc_beautify_snapshots_cache_v2';
// Callback key
const CALLBACK_KEY = '_jlc_beautify_snapshot_callback';
// Last undo restored snapshot ID
const LAST_RESTORED_KEY = '_jlc_beautify_last_restored_id';
// Undo lock key
const UNDO_LOCK_KEY = '_jlc_beautify_undo_lock';

export function getLastRestoredId(): number | null {
	return (eda as any)[LAST_RESTORED_KEY] ?? null;
}

function setLastRestoredId(id: number | null) {
	(eda as any)[LAST_RESTORED_KEY] = id;
}

function isUndoing(): boolean {
	return !!(eda as any)[UNDO_LOCK_KEY];
}

function setUndoing(val: boolean) {
	(eda as any)[UNDO_LOCK_KEY] = val;
}

/**
 * Register snapshot change callback.
 * Note: Callback is stored on the eda global object to support cross-context invocation.
 */
export function registerSnapshotChangeCallback(cb: () => void) {
	(eda as any)[CALLBACK_KEY] = cb;
}

/**
 * Notify the settings UI that the snapshot list has changed
 */
function notifySnapshotChange() {
	// Prefer the callback registered on the eda global object
	const registeredCallback = (eda as any)[CALLBACK_KEY];
	if (typeof registeredCallback === 'function') {
		try {
			registeredCallback();
		}
		catch (e) {
			logError(`UI callback failed: ${e}`, 'Snapshot');
		}
	}
}

export interface RoutingSnapshot {
	id: number;
	name: string;
	timestamp: number;
	pcbId?: string; // Kept for safety
	lines: any[];
	arcs: any[];
	isManual?: boolean;
}

interface PcbSnapshotStorage {
	manual: RoutingSnapshot[];
	auto: RoutingSnapshot[];
}

interface SnapshotStorageV2 {
	[pcbId: string]: PcbSnapshotStorage;
}

export const SNAPSHOT_LIMIT = 20;

/**
 * Get the current snapshot storage structure (complete)
 */
async function getStorageData(): Promise<SnapshotStorageV2> {
	// 1. Try reading from global cache
	const cached = (eda as any)[CACHE_KEY_V2] as SnapshotStorageV2;
	if (cached && typeof cached === 'object') {
		return cached;
	}

	// 2. Read from storage
	try {
		const stored = await eda.sys_Storage.getExtensionUserConfig(SNAPSHOT_STORAGE_KEY_V2);
		if (stored) {
			const data = JSON.parse(stored);
			// Update cache
			(eda as any)[CACHE_KEY_V2] = data;
			return data;
		}
	}
	catch (e: any) {
		logError(`Failed to load snapshots v2: ${e.message || e}`);
	}

	// 3. Return empty object
	const empty = {};
	(eda as any)[CACHE_KEY_V2] = empty;
	return empty;
}

/**
 * Save complete snapshot storage
 */
async function saveStorageData(data: SnapshotStorageV2) {
	try {
		// Update cache
		(eda as any)[CACHE_KEY_V2] = data;
		// Persist
		await eda.sys_Storage.setExtensionUserConfig(SNAPSHOT_STORAGE_KEY_V2, JSON.stringify(data));
	}
	catch (e: any) {
		logError(`Failed to save snapshots v2: ${e.message || e}`);
	}
}

/**
 * Get snapshot list for a specific PCB
 * @param pcbId PCB UUID
 * @param type 'manual' | 'auto' | undefined (undefined returns all flattened)
 */
export async function getSnapshots(pcbId: string, type?: 'manual' | 'auto'): Promise<RoutingSnapshot[]> {
	const data = await getStorageData();
	const pcbData = data[pcbId];

	if (!pcbData)
		return [];

	if (type === 'manual')
		return [...pcbData.manual];
	if (type === 'auto')
		return [...pcbData.auto];

	// If no type specified, merge (not recommended unless for legacy interface compatibility)
	return [...(pcbData.manual || []), ...(pcbData.auto || [])].sort((a, b) => b.timestamp - a.timestamp);
}

// Helper: compare whether two Lines are identical
function isLineEqual(a: any, b: any) {
	if (a.id !== b.id)
		return false; // ID must match
	if (a.layer !== b.layer || a.net !== b.net)
		return false;
	if (!isClose(a.startX, b.startX))
		return false;
	if (!isClose(a.startY, b.startY))
		return false;
	if (!isClose(a.endX, b.endX))
		return false;
	if (!isClose(a.endY, b.endY))
		return false;
	if (!isClose(a.lineWidth, b.lineWidth))
		return false;
	return true;
}

// Helper: compare whether two Arcs are identical
function isArcEqual(a: any, b: any) {
	if (a.id !== b.id)
		return false; // ID must match
	if (a.layer !== b.layer || a.net !== b.net)
		return false;
	if (!isClose(a.startX, b.startX))
		return false;
	if (!isClose(a.startY, b.startY))
		return false;
	if (!isClose(a.endX, b.endX))
		return false;
	if (!isClose(a.endY, b.endY))
		return false;
	if (!isClose(a.arcAngle, b.arcAngle))
		return false;
	if (!isClose(a.lineWidth, b.lineWidth))
		return false;
	return true;
}

// Helper: compare whether two snapshots' data is completely identical (order-independent)
function isSnapshotDataIdentical(snapshotA: RoutingSnapshot, snapshotB: RoutingSnapshot): boolean {
	if (snapshotA.lines.length !== snapshotB.lines.length)
		return false;
	if (snapshotA.arcs.length !== snapshotB.arcs.length)
		return false;

	// Sort by ID for stable comparison
	const sortById = (a: any, b: any) => (a.id > b.id ? 1 : -1);

	const linesA = [...snapshotA.lines].sort(sortById);
	const linesB = [...snapshotB.lines].sort(sortById);

	for (let i = 0; i < linesA.length; i++) {
		if (!isLineEqual(linesA[i], linesB[i]))
			return false;
	}

	const arcsA = [...snapshotA.arcs].sort(sortById);
	const arcsB = [...snapshotB.arcs].sort(sortById);

	for (let i = 0; i < arcsA.length; i++) {
		if (!isArcEqual(arcsA[i], arcsB[i]))
			return false;
	}

	return true;
}

// Helper: extract primitive data
function extractPrimitiveData(items: any[], type: 'line' | 'arc', pcbId: string) {
	return items.map((p) => {
		const base = {
			net: p.getState_Net ? p.getState_Net() : p.net,
			layer: p.getState_Layer ? p.getState_Layer() : p.layer,
			id: p.getState_PrimitiveId ? p.getState_PrimitiveId() : p.primitiveId,
		};

		if (type === 'line') {
			const lineWidth = p.getState_LineWidth ? p.getState_LineWidth() : p.lineWidth;
			return {
				...base,
				startX: p.getState_StartX ? p.getState_StartX() : p.startX,
				startY: p.getState_StartY ? p.getState_StartY() : p.startY,
				endX: p.getState_EndX ? p.getState_EndX() : p.endX,
				endY: p.getState_EndY ? p.getState_EndY() : p.endY,
				lineWidth,
			};
		}
		else if (type === 'arc') {
			const arcAngle = p.getState_ArcAngle ? p.getState_ArcAngle() : p.arcAngle;
			const arcId = base.id;

			// Priority: Global Map -> API -> Property
			const arcWidthMap = getArcLineWidthMap();
			const mapKey = makeArcWidthKey(pcbId, arcId);
			let lineWidth = arcWidthMap.get(mapKey);

			if (lineWidth === undefined) {
				if (p.getState_LineWidth) {
					lineWidth = p.getState_LineWidth();
				}
				else if (p.lineWidth !== undefined) {
					lineWidth = p.lineWidth;
				}
			}

			return {
				...base,
				startX: p.getState_StartX ? p.getState_StartX() : p.startX,
				startY: p.getState_StartY ? p.getState_StartY() : p.startY,
				endX: p.getState_EndX ? p.getState_EndX() : p.endX,
				endY: p.getState_EndY ? p.getState_EndY() : p.endY,
				arcAngle,
				lineWidth: lineWidth ?? 0.254,
			};
		}
		return base;
	});
}

/**
 * Helper: safely get current PCB info
 */
export async function getCurrentPcbInfoSafe() {
	try {
		const pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
		if (pcbInfo) {
			return { id: pcbInfo.uuid, name: pcbInfo.name || '' };
		}
		const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
		if (boardInfo && boardInfo.pcb) {
			return { id: boardInfo.pcb.uuid, name: boardInfo.pcb.name || boardInfo.name || '' };
		}
	}
	catch { /* ignore */ }
	return null;
}

/**
 * Create a snapshot of the current routing state
 * @param name Snapshot name
 * @param isManual Whether this is a manual snapshot (if true, stored in manual list)
 */
export async function createSnapshot(name: string = 'Auto Save', isManual: boolean = false): Promise<RoutingSnapshot | null> {
	try {
		// Temporarily store the undo ID; don't reset now, will be used later for branch truncation
		const lastRestoredId = getLastRestoredId();

		if (eda.sys_LoadingAndProgressBar) {
			// If manually triggered (already has a progress bar), don't show progress tip to avoid flicker
		}

		const currentPcb = await getCurrentPcbInfoSafe();
		if (!currentPcb) {
			logWarn('Cannot create snapshot: No active PCB found.', 'Snapshot');
			return null;
		}

		const pcbId = currentPcb.id;
		const pcbName = currentPcb.name;

		// Auto-prepend PCB name prefix
		let finalName = name;
		if (pcbName) {
			finalName = `[${pcbName}] ${name}`; // Maintain existing naming convention
		}

		// Get all tracks and arcs
		const lines = await eda.pcb_PrimitiveLine.getAll();
		const arcs = await eda.pcb_PrimitiveArc.getAll();

		const snapshot: RoutingSnapshot = {
			id: Date.now(),
			name: finalName,
			timestamp: Date.now(),
			pcbId,
			isManual,
			lines: extractPrimitiveData(lines || [], 'line', pcbId),
			arcs: extractPrimitiveData(arcs || [], 'arc', pcbId),
		};

		// Get existing data
		const data = await getStorageData();
		if (!data[pcbId]) {
			data[pcbId] = { manual: [], auto: [] };
		}
		const pcbStore = data[pcbId];

		// History branch management: if currently in undo state, new operation truncates "future"
		if (lastRestoredId !== null) {
			const idx = pcbStore.auto.findIndex(s => s.id === lastRestoredId);
			if (idx > 0) {
				// Delete all auto snapshots newer than the current restore point
				pcbStore.auto.splice(0, idx);
				debugLog(`Snapshot history truncated: removed ${idx} newer items`, 'Snapshot');
			}
			// Reset pointer
			setLastRestoredId(null);
		}

		// Determine which list to store in
		const targetList = isManual ? pcbStore.manual : pcbStore.auto;

		// Check duplicate against the latest one in the target list
		if (targetList.length > 0) {
			const latest = targetList[0];
			const isIdentical = isSnapshotDataIdentical(latest, snapshot);

			if (isIdentical) {
				debugLog('Snapshot skipped: Identical to the latest one.', 'Snapshot');
				if (isManual && eda.sys_Message) {
					const msg = eda.sys_I18n ? eda.sys_I18n.text('当前布线状态与最新快照一致，无需重复创建') : 'Current state matches the latest snapshot.';
					eda.sys_Message.showToastMessage(msg);
				}
				if (eda.sys_LoadingAndProgressBar) {
					eda.sys_LoadingAndProgressBar.destroyLoading();
				}
				return null;
			}
		}

		// Insert at head
		targetList.unshift(snapshot);

		// Limit size
		if (targetList.length > SNAPSHOT_LIMIT) {
			targetList.length = SNAPSHOT_LIMIT; // Truncate
		}

		// Save
		await saveStorageData(data);

		// Notify settings UI to refresh
		notifySnapshotChange();

		return snapshot;
	}
	catch (e: any) {
		logError(`Create failed: ${e.message || e}`, 'Snapshot');
		if (eda.sys_Message)
			eda.sys_Message.showToastMessage(`Snapshot creation failed: ${e.message}`);
		return null;
	}
	finally {
		if (eda.sys_LoadingAndProgressBar) {
			eda.sys_LoadingAndProgressBar.destroyLoading();
		}
	}
}

/**
 * Restore a snapshot
 */
export async function restoreSnapshot(snapshotId: number, showToast: boolean = true, requireConfirmation: boolean = false): Promise<boolean> {
	try {
		// Since restoreSnapshot only receives an ID, we need to search for it
		const data = await getStorageData();
		let snapshot: RoutingSnapshot | undefined;

		// Brute-force search for ID
		for (const store of Object.values(data)) {
			snapshot = store.manual.find(s => s.id === snapshotId) || store.auto.find(s => s.id === snapshotId);
			if (snapshot) {
				break;
			}
		}

		if (!snapshot) {
			logError(`Snapshot not found with id: ${snapshotId}`, 'Snapshot');
			eda.sys_Message?.showToastMessage('Snapshot not found');
			return false;
		}

		const currentPcb = await getCurrentPcbInfoSafe();
		const currentPcbId = currentPcb?.id || 'unknown';

		// 1. Check PCB ID
		let confirmed = !requireConfirmation;
		let isMismatch = false;

		if (snapshot.pcbId && snapshot.pcbId !== currentPcbId) {
			isMismatch = true;
			// If ID doesn't match, show severe warning
			if (eda.sys_Dialog && typeof eda.sys_Dialog.showConfirmationMessage === 'function') {
				confirmed = await new Promise<boolean>((resolve) => {
					eda.sys_Dialog.showConfirmationMessage(
						eda.sys_I18n.text
							? eda.sys_I18n.text('!!! 警告：快照所属PCB与当前不一致 !!!\n\n可能会导致数据错乱，系统将尝试备份当前状态。是否继续？')
							: '!!! WARNING: PCB ID MISMATCH !!!\n\nSystem will try to backup. Continue?',
						eda.sys_I18n.text ? eda.sys_I18n.text('!!! 危险操作确认 !!!') : '!!! DANGER CONFIRMATION !!!',
						undefined,
						undefined,
						(ok: boolean) => resolve(ok),
					);
				});
			}
			else {
				confirmed = true;
			}
		}
		else if (requireConfirmation) {
			if (eda.sys_Dialog && typeof eda.sys_Dialog.showConfirmationMessage === 'function') {
				confirmed = await new Promise<boolean>((resolve) => {
					eda.sys_Dialog.showConfirmationMessage(
						eda.sys_I18n.text ? eda.sys_I18n.text('确定恢复快照？当前未保存的修改将丢失。') : 'Restore snapshot? Unsaved changes will be lost.',
						eda.sys_I18n.text ? eda.sys_I18n.text('恢复快照') : 'Restore Snapshot',
						undefined,
						undefined,
						(ok: boolean) => resolve(ok),
					);
				});
			}
		}

		if (!confirmed)
			return false;

		// Force backup if mismatch
		if (isMismatch) {
			await createSnapshot(eda.sys_I18n?.text ? eda.sys_I18n.text('强制恢复前备份') : 'Backup (Pre-Force Restore)', false);
		}

		if (eda.sys_LoadingAndProgressBar) {
			eda.sys_LoadingAndProgressBar.showLoading();
		}

		// Restore logic (Diff-based)
		const currentLines = extractPrimitiveData(await eda.pcb_PrimitiveLine.getAll() || [], 'line', currentPcbId);
		const currentArcs = extractPrimitiveData(await eda.pcb_PrimitiveArc.getAll() || [], 'arc', currentPcbId);

		const currentLineMap = new Map(currentLines.map(l => [l.id, l]));
		const linesToDelete: string[] = [];
		const linesToCreate: any[] = [];

		for (const snapLine of snapshot.lines) {
			if (currentLineMap.has(snapLine.id)) {
				if (isLineEqual(snapLine, currentLineMap.get(snapLine.id))) {
					currentLineMap.delete(snapLine.id);
				}
				else {
					linesToDelete.push(snapLine.id);
					linesToCreate.push(snapLine);
					currentLineMap.delete(snapLine.id);
				}
			}
			else {
				linesToCreate.push(snapLine);
			}
		}
		for (const id of currentLineMap.keys()) linesToDelete.push(id);

		const currentArcMap = new Map(currentArcs.map(a => [a.id, a]));
		const arcsToDelete: string[] = [];
		const arcsToCreate: any[] = [];

		for (const snapArc of snapshot.arcs) {
			if (currentArcMap.has(snapArc.id)) {
				if (isArcEqual(snapArc, currentArcMap.get(snapArc.id))) {
					currentArcMap.delete(snapArc.id);
				}
				else {
					arcsToDelete.push(snapArc.id);
					arcsToCreate.push(snapArc);
					currentArcMap.delete(snapArc.id);
				}
			}
			else {
				arcsToCreate.push(snapArc);
			}
		}
		for (const id of currentArcMap.keys()) arcsToDelete.push(id);

		// Execute
		if (linesToDelete.length > 0)
			await eda.pcb_PrimitiveLine.delete(linesToDelete);
		if (arcsToDelete.length > 0)
			await eda.pcb_PrimitiveArc.delete(arcsToDelete);

		for (const l of linesToCreate) {
			try {
				await eda.pcb_PrimitiveLine.create(l.net, l.layer, l.startX, l.startY, l.endX, l.endY, l.lineWidth ?? 0.254);
			}
			catch (e) { logWarn(`Line restore error: ${e}`); }
		}

		for (const a of arcsToCreate) {
			try {
				if (a.startX !== undefined && a.arcAngle !== undefined) {
					await eda.pcb_PrimitiveArc.create(a.net, a.layer, a.startX, a.startY, a.endX, a.endY, a.arcAngle, a.lineWidth ?? 0.254);
				}
			}
			catch (e) { logWarn(`Arc restore error: ${e}`); }
		}

		if (showToast && eda.sys_Message) {
			eda.sys_Message.showToastMessage(`Restored successfully (L:${linesToCreate.length - linesToDelete.length}, A:${arcsToCreate.length - arcsToDelete.length})`);
		}

		setLastRestoredId(snapshot.id);
		notifySnapshotChange();
		return true;
	}
	catch (e: any) {
		logError(`Restore failed: ${e.message || e}`, 'Snapshot');
		if (eda.sys_Message)
			eda.sys_Message.showToastMessage(`Snapshot restore failed: ${e.message}`);
		return false;
	}
	finally {
		if (eda.sys_LoadingAndProgressBar)
			eda.sys_LoadingAndProgressBar.destroyLoading();
	}
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(snapshotId: number) {
	const data = await getStorageData();
	// Global deletion
	for (const pcbId in data) {
		data[pcbId].manual = data[pcbId].manual.filter(s => s.id !== snapshotId);
		data[pcbId].auto = data[pcbId].auto.filter(s => s.id !== snapshotId);
	}
	await saveStorageData(data);
	notifySnapshotChange();
}

/**
 * Clear snapshots (current PCB's manual snapshots)
 * The settings UI only requests clearing its displayed list
 */
export async function clearSnapshots() {
	const currentPcb = await getCurrentPcbInfoSafe();
	if (!currentPcb)
		return;

	const data = await getStorageData();
	if (data[currentPcb.id]) {
		data[currentPcb.id].manual = [];
		await saveStorageData(data);
		notifySnapshotChange();
	}
}

/**
 * Undo the last operation (by restoring a snapshot).
 * Finds the most recent snapshot and restores it.
 */
export async function undoLastOperation() {
	if (isUndoing())
		return;
	setUndoing(true);

	if (eda.sys_LoadingAndProgressBar?.showLoading)
		eda.sys_LoadingAndProgressBar.showLoading();

	try {
		const currentPcb = await getCurrentPcbInfoSafe();
		if (!currentPcb) {
			eda.sys_Message?.showToastMessage('Invalid PCB state');
			return;
		}

		const data = await getStorageData();
		const pcbData = data[currentPcb.id];

		// If no auto snapshots
		if (!pcbData || !pcbData.auto || pcbData.auto.length === 0) {
			eda.sys_Message?.showToastMessage(eda.sys_I18n ? eda.sys_I18n.text('没有可撤销的操作') : 'No undo history');
			return;
		}

		const autoSnapshots = pcbData.auto;

		// Find target snapshot
		let targetSnapshot: RoutingSnapshot | undefined;
		const lastRestoredId = getLastRestoredId();
		let startIndex = 0;

		if (lastRestoredId !== null) {
			const idx = autoSnapshots.findIndex(s => s.id === lastRestoredId);
			if (idx !== -1) {
				startIndex = idx + 1; // Find the older one
			}
		}
		else {
			// If this is the first undo, and the latest snapshot is an "After" type (typically representing current state),
			// skip it and undo to its previous state.
			if (autoSnapshots.length > 0 && autoSnapshots[0].name && /\sAfter$/.test(autoSnapshots[0].name)) {
				startIndex = 1;
			}
		}

		if (startIndex < autoSnapshots.length) {
			targetSnapshot = autoSnapshots[startIndex];
		}

		if (targetSnapshot) {
			const success = await restoreSnapshot(targetSnapshot.id, false, false);
			if (success) {
				const msg = eda.sys_I18n ? eda.sys_I18n.text('已撤销') : 'Undone';
				let dispName = targetSnapshot.name.replace(/^\[.*?\]\s*/, '');
				if (eda.sys_I18n && eda.sys_I18n.text(dispName) !== dispName) {
					dispName = eda.sys_I18n.text(dispName);
				}
				eda.sys_Message?.showToastMessage(`${msg}: ${dispName}`);
			}
		}
		else {
			eda.sys_Message?.showToastMessage(eda.sys_I18n ? eda.sys_I18n.text('已到达撤销记录尽头') : 'End of undo history');
		}
	}
	catch (e: any) {
		if (eda.sys_Dialog)
			eda.sys_Dialog.showInformationMessage(`Undo failed: ${e.message}`, 'Undo Error');
	}
	finally {
		setUndoing(false);
		if (eda.sys_LoadingAndProgressBar?.destroyLoading)
			eda.sys_LoadingAndProgressBar.destroyLoading();
	}
}
