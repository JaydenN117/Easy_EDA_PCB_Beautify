/**
 * Width Transition Feature
 * Adds smooth transitions between tracks of different widths on the same net.
 * Uses cubic Bezier curves for smooth width gradients.
 */

import { getSafeSelectedTracks } from './eda_utils';
import { debugLog, logError } from './logger';
import { dist, isClose, smootherStep } from './math';
import { getSettings } from './settings';
import { createSnapshot } from './snapshot';

// Store created transition element IDs and position info
const TRANSITION_STORAGE_KEY = 'width_transition_data';

interface TransitionRecord {
	point: string; // Coordinate key
	ids: string[]; // Corresponding primitive ID list
}

interface TransitionData {
	records: TransitionRecord[];
}

/**
 * Get saved transition data
 */
async function getSavedTransitionData(): Promise<TransitionData> {
	try {
		const stored = await eda.sys_Storage.getExtensionUserConfig(TRANSITION_STORAGE_KEY);
		if (stored) {
			const data = JSON.parse(stored);
			if (data.records && Array.isArray(data.records)) {
				return data;
			}
		}
	}
	catch {
		// Ignore read errors
	}
	return { records: [] };
}

/**
 * Save transition data
 */
async function saveTransitionData(data: TransitionData): Promise<void> {
	try {
		await eda.sys_Storage.setExtensionUserConfig(TRANSITION_STORAGE_KEY, JSON.stringify(data));
	}
	catch {
		// Ignore storage failures
	}
}

/**
 * Add width transitions - process selected tracks (menu call)
 */
export async function addWidthTransitionsSelected() {
	const settings = await getSettings();

	// Show progress bar early
	if (eda.sys_LoadingAndProgressBar?.showLoading) {
		eda.sys_LoadingAndProgressBar.showLoading();
	}

	try {
		// Get selected primitive IDs
		const allSelectedIds = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
		if (!allSelectedIds || allSelectedIds.length === 0) {
			eda.sys_Message?.showToastMessage(eda.sys_I18n.text('请先选择要处理的导线'));
			return; // finally will handle progress bar
		}

		// Read saved transition data
		const savedData = await getSavedTransitionData();

		// Create snapshot (Undo support)
		try {
			await createSnapshot('Width (Selected) Before');
		}
		catch (e: any) {
			logError(`Failed to create snapshot: ${e.message || e}`);
		}

		try {
			// Use safe retrieval function for mixed selections
			const selectedTracks = await getSafeSelectedTracks(allSelectedIds);

			if (selectedTracks.length === 0) {
				eda.sys_Message?.showToastMessage(eda.sys_I18n.text('没有找到导线'));
				return;
			}

			const result = await processWidthTransitions(selectedTracks, savedData, settings);

			// Save data
			await saveTransitionData(result.data);

			eda.sys_Message?.showToastMessage(
				eda.sys_I18n.text(`Width transition completed, processed ${result.count} connection points`),
			);

			// Save post-operation snapshot
			try {
				await createSnapshot('Width (Selected) After');
			}
			catch (e: any) {
				logError(`Failed to create result snapshot: ${e.message || e}`);
			}
		}
		catch (e: any) {
			eda.sys_Dialog?.showInformationMessage(e.message, 'Width Transition Error');
		}
		finally {
			eda.sys_LoadingAndProgressBar?.destroyLoading?.();
		}
	}
	catch { }
}

/**
 * Add width transitions - process all tracks (auto-called during beautify)
 * @param createBackup Whether to create a snapshot (if called from Beautify, snapshot is usually already created)
 */
export async function addWidthTransitionsAll(createBackup: boolean = true) {
	const settings = await getSettings();

	// Read saved transition data
	const savedData = await getSavedTransitionData();

	if (eda.sys_LoadingAndProgressBar?.showLoading) {
		eda.sys_LoadingAndProgressBar.showLoading();
	}

	if (createBackup) {
		try {
			await createSnapshot('Width (All) Before');
		}
		catch (e: any) {
			logError(`Failed to create snapshot: ${e.message || e}`);
		}
	}

	try {
		// Get all tracks
		const allTracks = await eda.pcb_PrimitiveLine.getAll();
		if (!allTracks || allTracks.length === 0) {
			return;
		}

		const result = await processWidthTransitions(allTracks, savedData, settings);

		// Save data
		await saveTransitionData(result.data);

		debugLog(`Auto transition complete, processed ${result.count} connection points`, 'Transitions');

		// If running independently, save post-operation snapshot
		if (createBackup) {
			try {
				await createSnapshot('Width (All) After');
			}
			catch (e: any) {
				logError(`Failed to create result snapshot: ${e.message || e}`);
			}
		}
	}
	catch (e: any) {
		logError(e.message, 'Transitions');
	}
	finally {
		eda.sys_LoadingAndProgressBar?.destroyLoading?.();
	}
}

/**
 * Core logic for processing width transitions
 */
async function processWidthTransitions(
	tracks: any[],
	savedData: TransitionData,
	settings: any,
): Promise<{ data: TransitionData; count: number }> {
	debugLog(`Got ${tracks.length} tracks`, 'Transitions');

	// Group by net and layer
	const netLayerMap = new Map<string, any[]>();

	for (const track of tracks) {
		const net = track.getState_Net?.() || '';
		const layer = track.getState_Layer?.() || 0;

		const groupKey = net ? `net_${net}_layer_${layer}` : `__NO_NET__layer_${layer}`;

		if (!netLayerMap.has(groupKey)) {
			netLayerMap.set(groupKey, []);
		}
		netLayerMap.get(groupKey)!.push(track);
	}

	debugLog(`Total ${netLayerMap.size} groups`, 'Transitions');

	// Build record map for quick lookups
	const recordsMap = new Map<string, TransitionRecord>();
	if (savedData.records) {
		savedData.records.forEach(r => recordsMap.set(r.point, r));
	}

	const processedPointsInCurrentRun = new Set<string>();
	const pointKey = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
	let transitionCount = 0;

	// Process each group
	for (const [groupKey, groupTracks] of netLayerMap) {
		if (groupTracks.length < 2)
			continue;

		const isNoNet = groupKey.startsWith('__NO_NET__');
		const actualNet = isNoNet ? '' : groupKey.replace(/^net_/, '').replace(/_layer_\d+$/, '');

		// Find track pairs with connected endpoints but different widths
		for (let i = 0; i < groupTracks.length; i++) {
			for (let j = i + 1; j < groupTracks.length; j++) {
				const t1 = groupTracks[i];
				const t2 = groupTracks[j];

				const w1 = t1.getState_LineWidth();
				const w2 = t2.getState_LineWidth();

				// Only process cases with different widths
				if (isClose(w1, w2, 0.01))
					continue;

				// Get endpoints
				const t1Start = { x: t1.getState_StartX(), y: t1.getState_StartY() };
				const t1End = { x: t1.getState_EndX(), y: t1.getState_EndY() };
				const t2Start = { x: t2.getState_StartX(), y: t2.getState_StartY() };
				const t2End = { x: t2.getState_EndX(), y: t2.getState_EndY() };

				// Check all possible endpoint connections
				const tolerance = 0.1;
				const connections: Array<{
					point: { x: number; y: number };
					t1Dir: { x: number; y: number };
					t2Dir: { x: number; y: number };
				}> = [];

				if (dist(t1End, t2Start) < tolerance) {
					connections.push({
						point: t1End,
						t1Dir: { x: t1End.x - t1Start.x, y: t1End.y - t1Start.y },
						t2Dir: { x: t2End.x - t2Start.x, y: t2End.y - t2Start.y },
					});
				}
				if (dist(t1End, t2End) < tolerance) {
					connections.push({
						point: t1End,
						t1Dir: { x: t1End.x - t1Start.x, y: t1End.y - t1Start.y },
						t2Dir: { x: t2Start.x - t2End.x, y: t2Start.y - t2End.y },
					});
				}
				if (dist(t1Start, t2Start) < tolerance) {
					connections.push({
						point: t1Start,
						t1Dir: { x: t1Start.x - t1End.x, y: t1Start.y - t1End.y },
						t2Dir: { x: t2End.x - t2Start.x, y: t2End.y - t2Start.y },
					});
				}
				if (dist(t1Start, t2End) < tolerance) {
					connections.push({
						point: t1Start,
						t1Dir: { x: t1Start.x - t1End.x, y: t1Start.y - t1End.y },
						t2Dir: { x: t2Start.x - t2End.x, y: t2Start.y - t2End.y },
					});
				}

				// Process connection points
				for (const conn of connections) {
					const key = pointKey(conn.point);

					// Prevent duplicate processing of the same point in this run
					if (processedPointsInCurrentRun.has(key)) {
						continue;
					}

					// Check for old transition data, clean up if exists
					if (recordsMap.has(key)) {
						const oldRecord = recordsMap.get(key)!;
						if (oldRecord.ids && oldRecord.ids.length > 0) {
							try {
								await eda.pcb_PrimitiveLine.delete(oldRecord.ids);
							}
							catch (e: any) {
								logError(`Failed to delete old transition: ${e.message || e}`);
							}
						}
						recordsMap.delete(key);
					}

					// Check collinearity
					const len1 = Math.sqrt(conn.t1Dir.x ** 2 + conn.t1Dir.y ** 2);
					const len2 = Math.sqrt(conn.t2Dir.x ** 2 + conn.t2Dir.y ** 2);
					if (len1 < 0.001 || len2 < 0.001)
						continue;

					const dot = (conn.t1Dir.x * conn.t2Dir.x + conn.t1Dir.y * conn.t2Dir.y) / (len1 * len2);

					// Angle difference less than 30 degrees
					if (Math.abs(Math.abs(dot) - 1) > 0.13) {
						if (settings.debug) {
							debugLog(`Skipping non-collinear connection: dot=${dot.toFixed(3)}`, 'Transitions');
						}
						continue;
					}

					debugLog(`Found width transition point: w1=${w1.toFixed(2)}, w2=${w2.toFixed(2)}, point=${key}`, 'Transitions');

					// Mark as processed
					processedPointsInCurrentRun.add(key);

					// Determine direction and narrow track length
					let transitionDir: { x: number; y: number };
					let narrowTrackLength: number;

					// Calculate actual lengths of both tracks
					const t1Length = dist(t1Start, t1End);
					const t2Length = dist(t2Start, t2End);

					if (w1 < w2) {
						// t1 is the narrow track
						transitionDir = { x: -conn.t1Dir.x, y: -conn.t1Dir.y };
						narrowTrackLength = t1Length;
					}
					else {
						// t2 is the narrow track
						transitionDir = { x: conn.t2Dir.x, y: conn.t2Dir.y };
						narrowTrackLength = t2Length;
					}

					// Create transition segments
					const ids = await createWidthTransition(
						conn.point,
						transitionDir,
						w1,
						w2,
						t1.getState_Layer(),
						actualNet,
						narrowTrackLength,
						settings,
					);

					if (ids.length > 0) {
						// Record newly created transition
						recordsMap.set(key, {
							point: key,
							ids,
						});
						transitionCount++;
					}

					// Prevent UI freezing
					if (transitionCount % 5 === 0) {
						await new Promise(r => setTimeout(r, 10));
					}
				}
			}
		}
	}

	debugLog(`Complete, created ${transitionCount} transitions`, 'Transitions');

	return {
		data: {
			records: Array.from(recordsMap.values()),
		},
		count: transitionCount,
	};
}

/**
 * Create width transition (using multiple line segments + Bezier curve interpolation for smooth transition).
 * Transition extends toward the narrow track, starting at the wide width and ending at the narrow width.
 * @param point Transition start coordinate
 * @param point.x X coordinate
 * @param point.y Y coordinate
 * @param direction Transition direction vector
 * @param direction.x X component
 * @param direction.y Y component
 * @param width1 Width of the first track
 * @param width2 Width of the second track
 * @param layer PCB layer
 * @param net Net name
 * @param narrowTrackLength Length of the narrow track; transition won't exceed this
 * @param settings Extension settings
 */
async function createWidthTransition(
	point: { x: number; y: number },
	direction: { x: number; y: number },
	width1: number,
	width2: number,
	layer: number,
	net: string,
	narrowTrackLength: number,
	settings: any,
): Promise<string[]> {
	const createdIds: string[] = [];

	// Normalize direction (direction already points toward narrow track)
	const len = Math.sqrt(direction.x ** 2 + direction.y ** 2);
	if (len < 0.001)
		return createdIds;

	// Direction points toward narrow track
	const ux = direction.x / len;
	const uy = direction.y / len;

	// Determine wide and narrow widths
	const wideWidth = Math.max(width1, width2);
	const narrowWidth = Math.min(width1, width2);
	const widthDiff = wideWidth - narrowWidth;

	// Transition length (extends toward narrow track)
	// Calculate ideal length, but don't exceed 90% of narrow track length (leave some margin)
	const idealLength = widthDiff * (settings.widthTransitionRatio || 1.5);
	const maxAllowedLength = narrowTrackLength * 0.9;
	const transitionLength = Math.min(idealLength, maxAllowedLength);

	// If transition length is too short, skip
	if (transitionLength < 1) {
		debugLog(`Skipped: transition length too short (${transitionLength.toFixed(2)})`, 'Transitions');
		return createdIds;
	}

	debugLog(`Ideal length=${idealLength.toFixed(2)}, actual length=${transitionLength.toFixed(2)}`, 'Transitions');

	// Segment count calculation
	// Dynamically calculate needed segments for smoothness
	// Adjusted: avoid overly high density causing API issues
	const minStep = 2; // mil (was 0.5, too dense)

	const segmentsByLen = Math.ceil(transitionLength / minStep);
	const segmentsByWidth = Math.ceil(widthDiff / minStep);

	// Max segments from settings
	const maxSegments = settings.widthTransitionSegments || 30;

	// Final segment count: calculated count, but limited to max
	// Minimum 5 segments, maximum from user settings
	let segments = Math.min(maxSegments, Math.max(5, segmentsByLen, segmentsByWidth));

	// For very short transitions, further reduce segment count
	if (transitionLength < 5) {
		segments = Math.min(segments, 6);
	}

	debugLog(`Creating Bezier transition: length=${transitionLength.toFixed(2)}, segments=${segments}`, 'Transitions');

	// Use Bezier curve interpolation to create gradient segments
	// From connection point (t=0, wideWidth) extending toward narrow track (t=1, narrowWidth)
	// Start width=wide width (covers connection), end width=narrow width (tangent to narrow track)
	for (let i = 0; i < segments; i++) {
		const t1 = i / segments;
		const t2 = (i + 1) / segments;

		// Bezier curve interpolation for width
		// t=0 -> wideWidth, t=1 -> narrowWidth
		// Fix: use t2 (segment end) to calculate width, ensuring last segment ends exactly at narrowWidth
		// This avoids a "step" at the narrow track connection
		const bezierT = smootherStep(t2);
		const w = wideWidth - widthDiff * bezierT;

		// Calculate segment position (extending from connection point toward narrow track)
		const p1 = {
			x: point.x + ux * (t1 * transitionLength),
			y: point.y + uy * (t1 * transitionLength),
		};
		const p2 = {
			x: point.x + ux * (t2 * transitionLength),
			y: point.y + uy * (t2 * transitionLength),
		};

		try {
			const line = await eda.pcb_PrimitiveLine.create(
				net,
				layer,
				p1.x,
				p1.y,
				p2.x,
				p2.y,
				w,
				false,
			);

			if (line?.getState_PrimitiveId) {
				createdIds.push(line.getState_PrimitiveId());
			}
		}
		catch (err) {
			logError(`Failed to create line segment: ${err}`, 'Transitions');
		}
	}

	return createdIds;
}

/**
 * Remove created width transitions
 */
export async function removeWidthTransitions() {
	try {
		const data = await getSavedTransitionData();
		if (data.records && data.records.length > 0) {
			const allIds = data.records.flatMap(r => r.ids);
			if (allIds.length > 0) {
				try {
					await eda.pcb_PrimitiveLine.delete(allIds);
				}
				catch {
					// Ignore deletion failures
				}
			}
			await saveTransitionData({ records: [] });
		}
	}
	catch {
		// Ignore errors
	}
}
