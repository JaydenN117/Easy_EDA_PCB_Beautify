import type { Point } from './math';
import { runDrcCheckAndParse } from './drc';
import { getSafeSelectedTracks } from './eda_utils';
import { debugLog, debugWarn, logError } from './logger';
import { dist, getAngleBetween, getLineIntersection, lerp } from './math';
import { getSettings } from './settings';
import { createSnapshot } from './snapshot';
import { addWidthTransitionsAll } from './widthTransition';

/**
 * Get the global arc line width Map.
 * The JLC EDA API's getState_LineWidth() may return incorrect values,
 * so we store correct widths on the eda object to avoid circular dependencies.
 * Key format: ${pcbId}_${arcId} to distinguish between different PCBs.
 */
export function getArcLineWidthMap(): Map<string, number> {
	if (!(eda as any)._arcLineWidthMap) {
		(eda as any)._arcLineWidthMap = new Map<string, number>();
	}
	return (eda as any)._arcLineWidthMap;
}

/**
 * Generate a Map key with PCB ID
 * @param pcbId PCB document ID
 * @param arcId Arc primitive ID
 */
export function makeArcWidthKey(pcbId: string, arcId: string): string {
	return `${pcbId}_${arcId}`;
}

/**
 * Core beautify routing logic (arc-based)
 */
/**
 * Beautify routing
 * @param scope 'selected' only process selected tracks, 'all' process all tracks
 */
export async function beautifyRouting(scope: 'selected' | 'all' = 'selected') {
	// await prepareDrcRules(); // Removed
	const settings = await getSettings();
	let tracks: any[] = [];

	// Show progress bar early
	if (
		eda.sys_LoadingAndProgressBar
		&& typeof eda.sys_LoadingAndProgressBar.showLoading === 'function'
	) {
		eda.sys_LoadingAndProgressBar.showLoading();
	}

	try {
		if (scope === 'all') {
			// Process all tracks
			debugLog('Processing all tracks');
			tracks = await eda.pcb_PrimitiveLine.getAll();
		}
		else {
			// Process selected tracks
			const selectedIds = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
			debugLog('Selected object IDs:', selectedIds?.length || 0);

			if (!selectedIds || !Array.isArray(selectedIds) || selectedIds.length === 0) {
				// Nothing selected, prompt user
				eda.sys_Message?.showToastMessage(
					eda.sys_I18n ? eda.sys_I18n.text('请先选择要处理的导线') : 'Please select tracks first',
				);
				return; // Note: progress bar will be cleaned up in finally
			}

			// Get track objects by ID list
			const primitives = await getSafeSelectedTracks(selectedIds);
			debugLog(`Got ${primitives.length} raw objects`);

			// Filter supported types: Track, Line, Polyline, and other possible line types
			// Also include lines without nets
			const supportedTypes = ['Line', 'Track', 'Polyline', 'Wire'];
			const filtered = primitives.filter(
				(p: any) => {
					if (!p)
						return false;
					let type = '';
					if (typeof p.getState_PrimitiveType === 'function') {
						type = p.getState_PrimitiveType();
					}
					else if (p.primitiveType) {
						type = p.primitiveType;
					}

					// Check if it has basic line properties (StartX, EndX, etc.)
					const hasLineProps = (p.getState_StartX || p.startX !== undefined)
						&& (p.getState_EndX || p.endX !== undefined);

					return supportedTypes.includes(type) || hasLineProps;
				},
			);

			debugLog(`Filtered to ${filtered.length} track objects`);

			// Convert Polylines to Line segments
			for (const obj of filtered) {
				let type = '';
				if (typeof obj.getState_PrimitiveType === 'function') {
					type = obj.getState_PrimitiveType();
				}
				else if (obj.primitiveType) {
					type = obj.primitiveType;
				}

				if (type === 'Polyline') {
					// Polyline needs special handling: extract polygon points and convert to segments
					const polygon = obj.getState_Polygon ? obj.getState_Polygon() : (obj.polygon || null);
					if (polygon && polygon.polygon && Array.isArray(polygon.polygon)) {
						const coords = polygon.polygon.filter((v: any) => typeof v === 'number');
						const net = obj.getState_Net ? obj.getState_Net() : (obj.net || '');
						const layer = obj.getState_Layer ? obj.getState_Layer() : (obj.layer || 1);
						const lineWidth = obj.getState_LineWidth ? obj.getState_LineWidth() : (obj.lineWidth || 10);
						const primId = obj.getState_PrimitiveId ? obj.getState_PrimitiveId() : (obj.primitiveId || 'unknown');

						// Convert Polyline points into virtual Track objects
						for (let i = 0; i < coords.length - 2; i += 2) {
							const x1 = coords[i];
							const y1 = coords[i + 1];
							const x2 = coords[i + 2];
							const y2 = coords[i + 3];

							tracks.push({
								getState_PrimitiveType: () => 'Line',
								getState_Net: () => net,
								getState_Layer: () => layer,
								getState_StartX: () => x1,
								getState_StartY: () => y1,
								getState_EndX: () => x2,
								getState_EndY: () => y2,
								getState_LineWidth: () => lineWidth,
								getState_PrimitiveId: () => `${primId}_seg${i / 2}`,
								_isPolylineSegment: true,
								_originalPolyline: obj,
							});
						}
					}
				}
				else {
					// Track or Line - add directly
					tracks.push(obj);
				}
			}
		}

		if (tracks.length < 1) {
			if (
				eda.sys_Message
				&& typeof eda.sys_Message.showToastMessage === 'function'
			) {
				eda.sys_Message.showToastMessage(
					eda.sys_I18n.text('未找到可处理的导线'),
				);
			}
			return;
		}

		if (
			eda.sys_LoadingAndProgressBar
			&& typeof eda.sys_LoadingAndProgressBar.showLoading === 'function'
		) {
			eda.sys_LoadingAndProgressBar.showLoading();
		}

		// Create snapshot (Undo support)
		try {
			const name = scope === 'all' ? 'Beautify (All) Before' : 'Beautify (Selected) Before';
			await createSnapshot(name);
		}
		catch (e: any) {
			logError(`Failed to create snapshot: ${e.message || e}`);
		}

		try {
			// Group by net and layer
			const groups = new Map<string, any[]>();
			for (const track of tracks) {
				const net = track.getState_Net();
				const layer = track.getState_Layer();
				const key = `${net}#@#${layer}`;
				if (!groups.has(key))
					groups.set(key, []);
				groups.get(key)?.push(track);
			}

			let processedPaths = 0;
			let createdArcs = 0;
			let clampedCorners = 0;

			const pathTransactions: { createdIds: string[]; backupPrimitives: any[] }[] = [];

			for (const [key, group] of groups) {
				const [net, layer] = key.split('#@#');

				// Improved path extraction: find all continuous paths
				const segs = group.map(t => ({
					p1: { x: t.getState_StartX(), y: t.getState_StartY() },
					p2: { x: t.getState_EndX(), y: t.getState_EndY() },
					width: t.getState_LineWidth(),
					id: t.getState_PrimitiveId(),
					track: t,
				}));

				// Helper: generate coordinate key
				// Use 3 decimal places, consistent with widthTransition, to avoid floating-point disconnections
				const pointKey = (p: { x: number; y: number }): string => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

				// Build adjacency map
				const connections = new Map<string, typeof segs[0][]>();
				for (const seg of segs) {
					const key1 = pointKey(seg.p1);
					const key2 = pointKey(seg.p2);
					if (!connections.has(key1))
						connections.set(key1, []);
					if (!connections.has(key2))
						connections.set(key2, []);
					connections.get(key1)?.push(seg);
					connections.get(key2)?.push(seg);
				}

				// Extract all continuous paths
				const used = new Set<string>();
				interface PathData {
					points: Point[];
					orderedSegs: typeof segs[0][];
				}
				const paths: PathData[] = [];

				for (const startSeg of segs) {
					if (used.has(startSeg.id))
						continue;

					const points: Point[] = [startSeg.p1, startSeg.p2];
					const orderedSegs: typeof segs[0][] = [startSeg];
					used.add(startSeg.id);

					// Extend path in both directions
					let extended = true;
					while (extended) {
						extended = false;

						// Try extending from the end
						const lastKey = pointKey(points[points.length - 1]);
						const lastConns = connections.get(lastKey) || [];

						// Stop at branch points (connection count > 2)
						if (lastConns.length <= 2) {
							for (const seg of lastConns) {
								if (used.has(seg.id))
									continue;
								const nextKey1 = pointKey(seg.p1);
								const nextKey2 = pointKey(seg.p2);
								if (nextKey1 === lastKey) {
									points.push(seg.p2);
									orderedSegs.push(seg);
									used.add(seg.id);
									extended = true;
									break;
								}
								else if (nextKey2 === lastKey) {
									points.push(seg.p1);
									orderedSegs.push(seg);
									used.add(seg.id);
									extended = true;
									break;
								}
							}
						}

						// Try extending from the start
						if (!extended) {
							const firstKey = pointKey(points[0]);
							const firstConns = connections.get(firstKey) || [];

							// Stop at branch points (connection count > 2)
							if (firstConns.length <= 2) {
								for (const seg of firstConns) {
									if (used.has(seg.id))
										continue;
									const nextKey1 = pointKey(seg.p1);
									const nextKey2 = pointKey(seg.p2);
									if (nextKey1 === firstKey) {
										points.unshift(seg.p2);
										orderedSegs.unshift(seg);
										used.add(seg.id);
										extended = true;
										break;
									}
									else if (nextKey2 === firstKey) {
										points.unshift(seg.p1);
										orderedSegs.unshift(seg);
										used.add(seg.id);
										extended = true;
										break;
									}
								}
							}
						}
					}

					if (points.length >= 3) {
						paths.push({
							points,
							orderedSegs,
						});
					}
				}

				// Process each path
				for (const path of paths) {
					const currentPathCreatedIds: string[] = [];
					const { points, orderedSegs } = path;

					// Check data integrity
					if (!points || points.some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number')) {
						logError('Path contains invalid points, skipping');
						continue;
					}

					if (points.length >= 3) {
						processedPaths++;
						let radius = settings.cornerRadius;

						// JLC EDA API system units are always mil (SYS_Unit.getSystemDataUnit() -> MIL)
						// So all coordinate calculations must be in mil
						if (settings.unit === 'mm') {
							radius = eda.sys_Unit.mmToMil(radius); // mm -> mil
						}

						// Generate new geometry - each element includes its own line width
						const newPath: {
							type: 'line' | 'arc';
							start: Point;
							end: Point;
							angle?: number;
							width: number;
						}[] = [];
						let currentStart = points[0];

						for (let i = 1; i < points.length - 1; i++) {
							const pPrev = points[i - 1];
							const pCorner = points[i];
							const pNext = points[i + 1];

							// Get line widths of previous and next segments
							// orderedSegs[i-1] is the segment from point i-1 to point i
							// orderedSegs[i] is the segment from point i to point i+1
							const prevSegWidth = orderedSegs[i - 1]?.width ?? orderedSegs[0].width;
							const nextSegWidth = orderedSegs[i]?.width ?? prevSegWidth;

							let isMerged = false;

							try {
								// Try short segment merging logic (fixes U-turn middle segments too short to smooth)
								if (settings.mergeShortSegments && i < points.length - 2) {
									const pAfter = points[i + 2];
									// Extra check that pAfter exists
									if (pAfter) {
										const segLen = dist(pCorner, pNext);

										// When middle segment is shorter than 1.5x the corner radius, try merging
										// (Relaxed condition, was previously < radius)
										if (segLen < radius * 1.5) {
											const vIn = { x: pPrev.x - pCorner.x, y: pPrev.y - pCorner.y };
											const vMid = { x: pNext.x - pCorner.x, y: pNext.y - pCorner.y };
											const vOut = { x: pAfter.x - pNext.x, y: pAfter.y - pNext.y }; // Note vector direction

											// Calculate corner directions
											// getAngleBetween returns angle from v1 to v2
											const angle1 = getAngleBetween({ x: -vIn.x, y: -vIn.y }, { x: vMid.x, y: vMid.y });
											// Fix: Angle2 should also use "Forward Incoming" (vMid) and "Forward Outgoing" (vOut)
											const angle2 = getAngleBetween({ x: vMid.x, y: vMid.y }, { x: vOut.x, y: vOut.y });

											// If both corners are in the same direction (product > 0) and angles aren't tiny
											if (angle1 * angle2 > 0 && Math.abs(angle1) > 1 && Math.abs(angle2) > 1) {
												// Calculate intersection of the two long edges (extensions of pPrev->pCorner and pNext->pAfter)
												const intersection = getLineIntersection(pPrev, pCorner, pNext, pAfter);

												if (intersection) {
													// Check if intersection is within reasonable range
													// If too far from pCorner or pNext, lines are nearly parallel - not suitable for merging
													const dInt1 = dist(intersection, pCorner);
													const dInt2 = dist(intersection, pNext);

													// Limit: intersection distance shouldn't exceed 10x segment length
													if (dInt1 < segLen * 10 && dInt2 < segLen * 10) {
														// Found intersection, try building a larger arc centered on it
														const t_v1 = { x: pPrev.x - intersection.x, y: pPrev.y - intersection.y };
														const t_v2 = { x: pAfter.x - intersection.x, y: pAfter.y - intersection.y };
														const t_mag1 = Math.sqrt(t_v1.x ** 2 + t_v1.y ** 2);
														const t_mag2 = Math.sqrt(t_v2.x ** 2 + t_v2.y ** 2);

														// Calculate included angle
														const t_dot = (t_v1.x * t_v2.x + t_v1.y * t_v2.y) / (t_mag1 * t_mag2);
														const t_safeDot = Math.max(-1, Math.min(1, t_dot));
														const t_angleRad = Math.acos(t_safeDot);

														// Calculate geometric limit radius (prevent bulging)
														// Only limit when radius is very large.
														// The previous t_limitRadius based on bridge segment depth was incorrect
														// because we're trying to eliminate that depth during merging.
														// So we remove that limit.

														const t_tanVal = Math.tan(t_angleRad / 2);
														let t_d = 0;
														if (Math.abs(t_tanVal) > 0.0001) {
															t_d = radius / t_tanVal;
														}

														// Limit radius to prevent consuming too much of the segments
														// t_mag1 and t_mag2 are distances from intersection to pPrev/pAfter
														// If the arc is too large, tangent points will exceed segment bounds
														const t_maxAllowedRadius = Math.min(t_mag1 * 0.95, t_mag2 * 0.95);
														const t_actualD = Math.min(t_d, t_maxAllowedRadius);

														let t_limitByWidth = false;

														// Line width check:
														// If merged arc effective radius is less than half the line width, don't generate
														// (prevents self-intersection/sharp angles)
														const t_effectiveRadius = t_actualD * Math.abs(t_tanVal);
														const t_maxLineWidth = Math.max(prevSegWidth, nextSegWidth); // Use larger width as conservative estimate

														if (t_effectiveRadius < (t_maxLineWidth / 2) - 0.05) {
															t_limitByWidth = true;
															debugLog(`Merge skipped on ${net}: Radius too small for width (Radius=${t_effectiveRadius.toFixed(2)}, Width=${t_maxLineWidth})`);
														}

														if (t_actualD > 0.05 && !t_limitByWidth) {
															const pStart = lerp(intersection, pPrev, t_actualD / t_mag1);
															const pEnd = lerp(intersection, pAfter, t_actualD / t_mag2);

															// Add straight line segment
															if (dist(currentStart, pStart) > 0.001) {
																newPath.push({
																	type: 'line',
																	start: currentStart,
																	end: pStart,
																	width: prevSegWidth,
																});
															}

															// Calculate arc angle
															const t_sweptAngle = getAngleBetween(
																{ x: -t_v1.x, y: -t_v1.y },
																{ x: t_v2.x, y: t_v2.y },
															);

															// Use the next segment's line width after merge
															const afterSegWidth = orderedSegs[i + 1]?.width ?? nextSegWidth;

															newPath.push({
																type: 'arc',
																start: pStart,
																end: pEnd,
																angle: t_sweptAngle,
																width: afterSegWidth,
															});

															createdArcs++;
															currentStart = pEnd;

															// Successfully merged, skip the next point
															i++;
															isMerged = true;

															// Log
															debugLog(`Merged short segment on ${net} at index ${i - 1}, segLen: ${segLen.toFixed(2)}, new radius usage: ${t_actualD.toFixed(2)}`);
														}
														else {
															debugLog(`Merge calc failed on ${net}. actualD too small (${t_actualD})`);
														}
													}
													else {
														debugLog(`Merge skipped on ${net}: Intersection too far (dInt1=${dInt1.toFixed(2)}, dInt2=${dInt2.toFixed(2)}, limit=${(segLen * 10).toFixed(2)})`);
													}
												}
												else {
													debugLog(`Merge skipped on ${net}: Lines Parallel or No Intersection`);
												}
											}
											else {
												debugLog(`Merge skipped on ${net}: Angles not suitable for U-turn (angle1=${angle1.toFixed(1)}, angle2=${angle2.toFixed(1)})`);
											}
										}
									}
								}
							}
							catch (err: any) {
								logError(`Merge logic failed at index ${i} on ${net}: ${err.message}`);
								// fall through to normal logic
							}

							if (!isMerged) {
								// Calculate angle between tracks
								const v1 = {
									x: pPrev.x - pCorner.x,
									y: pPrev.y - pCorner.y,
								};
								const v2 = {
									x: pNext.x - pCorner.x,
									y: pNext.y - pCorner.y,
								};

								const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
								const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);

								// Calculate included angle
								const dot = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
								// Clamp dot to prevent numerical errors
								const safeDot = Math.max(-1, Math.min(1, dot));
								const angleRad = Math.acos(safeDot);

								// Calculate tangent point distance
								// d = R / tan(angle / 2)
								// When angle approaches 180deg (PI), tan(PI/2) -> Inf, d -> 0
								// When angle approaches 0deg (0), tan(0) -> 0, d -> Inf
								const tanVal = Math.tan(angleRad / 2);
								let d = 0;
								if (Math.abs(tanVal) > 0.0001) {
									d = radius / tanVal;
								}

								// If segment is too short, shrink radius to fit (max 45% of segment length)
								const maxAllowedRadius = Math.min(mag1 * 0.45, mag2 * 0.45);
								const actualD = Math.min(d, maxAllowedRadius);

								let isSkippedDueToClamp = false;

								// 1. Check segment length limit
								// If actual tangent distance is significantly less than theoretical (< 95%), severe scaling occurred
								// If segment too short for tangent on one side, skip arc generation, only print warning
								// Force Arc option: if enabled, force generation (accept scaled radius), otherwise skip
								if (d > 0.001 && actualD < d * 0.95) {
									if (settings.forceArc) {
										// Force mode: only log debug, don't skip
										debugLog(`Corner at (${pCorner.x.toFixed(2)}, ${pCorner.y.toFixed(2)}) clamped. Req: ${d.toFixed(2)}, Act: ${actualD.toFixed(2)}`);
									}
									else {
										clampedCorners++;
										isSkippedDueToClamp = true;
										debugWarn(`Corner at (${pCorner.x.toFixed(2)}, ${pCorner.y.toFixed(2)}) [Net: ${net || 'No Net'}] skipped. Segment too short for radius. Req: ${d.toFixed(2)}, Act: ${actualD.toFixed(2)}`);
									}
								}

								// 2. Check line width limit (line too wide causes negative inner arc radius)
								if (!isSkippedDueToClamp) {
									const effectiveRadius = actualD * Math.abs(tanVal);
									const maxLineWidth = Math.max(prevSegWidth, nextSegWidth);
									// Inner radius = center radius - lineWidth/2
									// Allow inner radius to be 0 (sharp corner), but not negative
									// Must ensure effectiveRadius >= maxLineWidth / 2
									// Use small tolerance (0.05) to allow "Radius == Width/2" within float precision
									if (effectiveRadius < (maxLineWidth / 2) - 0.05) {
										isSkippedDueToClamp = true;
										debugWarn(`Corner at (${pCorner.x.toFixed(2)}, ${pCorner.y.toFixed(2)}) [Net: ${net || 'No Net'}] skipped. Radius too small for line width. Radius: ${effectiveRadius.toFixed(2)}, Width: ${maxLineWidth}`);
									}
								}

								const finalActualD = actualD;

								// DRC logic removed (moved to post-check)

								// Only generate arc when tangent distance is valid and large enough
								if (finalActualD > 0.05 && !isSkippedDueToClamp) {
									const pStart = lerp(pCorner, pPrev, finalActualD / mag1);
									const pEnd = lerp(pCorner, pNext, finalActualD / mag2);

									// Add line [currentStart -> tangentPoint1], using previous segment width
									newPath.push({
										type: 'line',
										start: currentStart,
										end: pStart,
										width: prevSegWidth,
									});

									// Calculate arc angle (signed)
									const sweptAngle = getAngleBetween(
										{ x: -v1.x, y: -v1.y },
										{ x: v2.x, y: v2.y },
									);

									// Add arc, using next segment width (connects more naturally with next segment)
									const arcWidth = nextSegWidth;
									newPath.push({
										type: 'arc',
										start: pStart,
										end: pEnd,
										angle: sweptAngle,
										width: arcWidth,
									});

									createdArcs++;
									currentStart = pEnd;
								}
								else {
									// Cannot smooth (radius too large or angle unsuitable), keep original corner
									newPath.push({
										type: 'line',
										start: currentStart,
										end: pCorner,
										width: prevSegWidth,
									});
									currentStart = pCorner;

									// Log failure
									if (!isSkippedDueToClamp && actualD > 0.05 && finalActualD > 0.05) {
										debugLog(`Corner at (${pCorner.x.toFixed(2)}, ${pCorner.y.toFixed(2)}) skipped. Angle or Radius invalid. net=${net || 'No Net'} actualD=${actualD.toFixed(3)}`);
									}
								}
							}
						}

						// Last straight segment, using the last segment's line width
						const lastSegWidth = orderedSegs[orderedSegs.length - 1]?.width ?? orderedSegs[0].width;
						newPath.push({
							type: 'line',
							start: currentStart,
							end: points[points.length - 1],
							width: lastSegWidth,
						});

						// Preparation: calculate all IDs to delete
						const polylineIdsToDelete = new Set<string>();
						const lineIdsToDelete = new Set<string>();
						const backupPrimitives: any[] = [];

						// Always perform replacement logic (user expects original lines to be shortened)
						for (const seg of orderedSegs) {
							// Backup data
							backupPrimitives.push({
								type: 'Line',
								net,
								layer,
								startX: seg.p1.x,
								startY: seg.p1.y,
								endX: seg.p2.x,
								endY: seg.p2.y,
								lineWidth: seg.width,
							});

							if (seg.track._isPolylineSegment) {
								let originalId = '';
								if (typeof seg.track._originalPolyline.getState_PrimitiveId === 'function') {
									originalId = seg.track._originalPolyline.getState_PrimitiveId();
								}
								else if (seg.track._originalPolyline.primitiveId) {
									originalId = seg.track._originalPolyline.primitiveId;
								}
								if (originalId) {
									polylineIdsToDelete.add(originalId);
								}
							}
							else {
								// Regular Line / Track
								lineIdsToDelete.add(seg.id);
							}
						}

						// Step 1: Delete old objects first
						// Delete Polylines
						if (polylineIdsToDelete.size > 0) {
							const pIds = Array.from(polylineIdsToDelete);
							try {
								const pcbApi = eda as any;
								if (pcbApi.pcb_PrimitivePolyline && typeof pcbApi.pcb_PrimitivePolyline.delete === 'function') {
									// Try deleting one by one
									for (const pid of pIds) {
										await pcbApi.pcb_PrimitivePolyline.delete([pid]);
									}
								}
								else {
									for (const pid of pIds) {
										await eda.pcb_PrimitiveLine.delete([pid]);
									}
								}
							}
							catch (e: any) {
								debugLog(`Failed to delete Polyline: ${e.message}`);
							}
						}

						// Delete Lines (one by one to ensure success)
						if (lineIdsToDelete.size > 0) {
							const lIds = Array.from(lineIdsToDelete);
							for (const lid of lIds) {
								try {
									// Try passing array with single ID
									await eda.pcb_PrimitiveLine.delete([lid]);
								}
								catch (e: any) {
									debugLog(`Failed to delete Line ${lid}: ${e.message}`);
								}
							}
						}

						// Step 2: Create new objects and record IDs

						for (const item of newPath) {
							if (item.type === 'line') {
								// Only create if length > 0
								if (dist(item.start, item.end) > 0.001) {
									const res = await eda.pcb_PrimitiveLine.create(
										net,
										layer as any,
										item.start.x,
										item.start.y,
										item.end.x,
										item.end.y,
										item.width,
									);

									// Try to get ID
									let newId: string | null = null;
									if (typeof res === 'string')
										newId = res;
									else if (res && typeof (res as any).id === 'string')
										newId = (res as any).id;
									else if (res && typeof (res as any).primitiveId === 'string')
										newId = (res as any).primitiveId;
									else if (res && typeof (res as any).getState_PrimitiveId === 'function')
										newId = (res as any).getState_PrimitiveId();

									if (newId) {
										currentPathCreatedIds.push(newId);
									}
								}
							}
							else {
								// Arc
								const res = await eda.pcb_PrimitiveArc.create(
									net,
									layer as any,
									item.start.x,
									item.start.y,
									item.end.x,
									item.end.y,
									item.angle!,
									item.width,
								);

								// Try to get ID
								let newId: string | null = null;
								if (typeof res === 'string')
									newId = res;
								else if (res && typeof (res as any).id === 'string')
									newId = (res as any).id;
								else if (res && typeof (res as any).primitiveId === 'string')
									newId = (res as any).primitiveId;
								else if (res && typeof (res as any).getState_PrimitiveId === 'function')
									newId = (res as any).getState_PrimitiveId();

								if (newId) {
									currentPathCreatedIds.push(newId);
									// Save arc's correct line width to global Map (with PCB ID distinction)
									let pcbId = 'unknown';
									try {
										const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
										if (boardInfo && boardInfo.pcb && boardInfo.pcb.uuid) {
											pcbId = boardInfo.pcb.uuid;
										}
									}
									catch {
										// ignore
									}
									const mapKey = makeArcWidthKey(pcbId, newId);
									getArcLineWidthMap().set(mapKey, item.width);
								}
							}
						}

						// Record transaction for potential rollback
						if (currentPathCreatedIds.length > 0 && backupPrimitives.length > 0) {
							pathTransactions.push({
								createdIds: currentPathCreatedIds,
								backupPrimitives: [...backupPrimitives],
							});
						}
					}
				}
			}

			// Post-Beautify DRC Check & Revert
			if (settings.enableDRC && pathTransactions.length > 0) {
				if (eda.sys_Message && typeof eda.sys_Message.showToastMessage === 'function') {
					eda.sys_Message.showToastMessage('Running DRC check...');
				}

				const violatedIds = await runDrcCheckAndParse();

				if (violatedIds.size > 0) {
					debugLog(`[DRC] Checking ${pathTransactions.length} transactions against ${violatedIds.size} violations.`);
					let revertedCount = 0;
					for (const trans of pathTransactions) {
						// Check if any IDs from this transaction have violations
						const violatingId = trans.createdIds.find(id => violatedIds.has(id));

						if (violatingId) {
							debugLog(`[DRC] Reverting transaction. Violation found on ID: ${violatingId}`);
							try {
								// Try to delete generated objects
								await eda.pcb_PrimitiveLine.delete(trans.createdIds);
								await eda.pcb_PrimitiveArc.delete(trans.createdIds);

								// Restore original objects
								for (const bp of trans.backupPrimitives) {
									if (bp.type === 'Line') {
										await eda.pcb_PrimitiveLine.create(
											bp.net,
											bp.layer,
											bp.startX,
											bp.startY,
											bp.endX,
											bp.endY,
											bp.lineWidth,
										);
									}
								}
								revertedCount++;
							}
							catch (e: any) {
								console.warn('Revert failed for transaction', e);
							}
						}
					}

					if (revertedCount > 0) {
						debugWarn(`DRC: Reverted ${revertedCount} path modifications due to violations.`);
						if (eda.sys_Message && typeof eda.sys_Message.showToastMessage === 'function') {
							eda.sys_Message.showToastMessage(`DRC check: Found and reverted ${revertedCount} violating modifications`);
						}
					}
				}
			}

			if (
				eda.sys_Message
				&& typeof eda.sys_Message.showToastMessage === 'function'
			) {
				if (createdArcs > 0) {
					eda.sys_Message.showToastMessage(
						`${eda.sys_I18n.text('圆弧美化完成')}: ${eda.sys_I18n.text('处理了')} ${processedPaths} ${eda.sys_I18n.text('条路径')}, ${eda.sys_I18n.text('创建了')} ${createdArcs} ${eda.sys_I18n.text('个圆弧')}`,
					);

					if (clampedCorners > 0) {
						setTimeout(() => {
							if (eda.sys_Message) {
								eda.sys_Message.showToastMessage(
									`Note: ${clampedCorners} corners were automatically scaled down due to short tracks`,
								);
							}
						}, 2000); // Slight delay for the warning
					}
				}
				else {
					eda.sys_Message.showToastMessage(
						eda.sys_I18n.text('未找到可以圆滑的拐角（需要至少2条连续导线形成拐角）'),
					);
				}
			}

			if (settings.syncWidthTransition) {
				// Called within Beautify flow, no extra snapshot needed (Beautify already created one)
				await addWidthTransitionsAll(false);
			}

			// Create snapshot after operation completes (save result)
			try {
				const name = scope === 'all' ? 'Beautify (All) After' : 'Beautify (Selected) After';
				await createSnapshot(name);
			}
			catch (e: any) {
				logError(`Failed to create result snapshot: ${e.message || e}`);
			}
		}
		catch (e: any) {
			if (eda.sys_Log && typeof eda.sys_Log.add === 'function') {
				eda.sys_Log.add(e.message);
			}
			if (
				eda.sys_Dialog
				&& typeof eda.sys_Dialog.showInformationMessage === 'function'
			) {
				eda.sys_Dialog.showInformationMessage(e.message, 'Beautify Error');
			}
		}
		finally {
			if (
				eda.sys_LoadingAndProgressBar
				&& typeof eda.sys_LoadingAndProgressBar.destroyLoading === 'function'
			) {
				eda.sys_LoadingAndProgressBar.destroyLoading();
			}
		}
	}
	catch {}
}
