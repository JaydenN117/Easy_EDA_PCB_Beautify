import type { Point } from './math';
import { debugLog } from './logger';
import { dist, getAngleBetween, lerp } from './math';
import { getSettings } from './settings';
import { addTeardrops } from './teardrop';

/**
 * 圆滑布线核心逻辑 (基于圆弧)
 */
export async function smoothRouting() {
	const settings = await getSettings();
	let tracks: any[] = [];

	const selected = await eda.pcb_SelectControl.getAllSelectedPrimitives();

	if (settings.debug) {
		debugLog('[Smooth Debug] 获取选中对象:', selected);
		debugLog('[Smooth Debug] 选中对象数量:', selected ? selected.length : 0);
		if (selected && selected.length > 0) {
			debugLog('[Smooth Debug] 第一个对象类型:', typeof selected[0]);
		}
	}

	if (!selected || !Array.isArray(selected) || selected.length === 0) {
		// 未选中任何对象时，处理全局布线
		if (settings.debug) {
			debugLog('[Smooth Debug] 无选中对象，获取全部导线');
		}
		tracks = await eda.pcb_PrimitiveLine.getAll();
	}
	else {
		// 处理选中的对象
		let primitives: any[] = [];
		if (typeof selected[0] === 'string') {
			for (const id of selected as unknown as string[]) {
				const p = await eda.pcb_PrimitiveLine.get(id);
				if (p)
					primitives.push(p);
			}
		}
		else {
			primitives = selected;
		}

		// 过滤支持的类型：Track, Line, Polyline
		const filtered = primitives.filter(
			(p: any) => {
				if (!p || typeof p.getState_PrimitiveType !== 'function')
					return false;
				const type = p.getState_PrimitiveType();
				return type === 'Line' || type === 'Track' || type === 'Polyline';
			},
		);

		if (settings.debug) {
			debugLog(`[Smooth Debug] 过滤后得到 ${filtered.length} 个对象`);
			if (filtered.length > 0 && filtered.length <= 3) {
				filtered.forEach((t, i) => {
					debugLog(`[Smooth Debug] 对象${i}:`, t.getState_PrimitiveType ? t.getState_PrimitiveType() : 'unknown');
				});
			}
		}

		// 将Polyline转换为Line段
		for (const obj of filtered) {
			const type = obj.getState_PrimitiveType();
			if (type === 'Polyline') {
				// Polyline需要特殊处理：提取多边形点并转换为线段
				const polygon = obj.getState_Polygon?.();
				if (polygon && polygon.polygon && Array.isArray(polygon.polygon)) {
					const coords = polygon.polygon.filter((v: any) => typeof v === 'number');
					const net = obj.getState_Net?.() || '';
					const layer = obj.getState_Layer?.() || 1;
					const lineWidth = obj.getState_LineWidth?.() || 10;

					if (settings.debug) {
						debugLog(`[Smooth Debug] Polyline包含 ${coords.length / 2} 个点，将生成 ${Math.floor(coords.length / 2) - 1} 条线段`);
						debugLog(`[Smooth Debug] Polyline属性: net=${net}, layer=${layer}, width=${lineWidth}`);
					}

					// 将Polyline的点转换为虚拟Track对象
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
							getState_PrimitiveId: () => `${obj.getState_PrimitiveId()}_seg${i / 2}`,
							_isPolylineSegment: true,
							_originalPolyline: obj,
						});
					}
				}
			}
			else {
				// Track 或 Line 直接添加
				tracks.push(obj);
			}
		}
	}

	if (settings.debug) {
		debugLog(`[Smooth Debug] 总共得到 ${tracks.length} 条导线/线段`);
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

	try {
		// 按网络和层分组
		const groups = new Map<string, any[]>();
		for (const track of tracks) {
			const net = track.getState_Net();
			const layer = track.getState_Layer();
			const key = `${net}#@#${layer}`;
			if (!groups.has(key))
				groups.set(key, []);
			groups.get(key)?.push(track);
		}

		if (settings.debug) {
			debugLog(`[Smooth Debug] 分组完成，共 ${groups.size} 个组`);
		}

		let processedPaths = 0;
		let createdArcs = 0;

		for (const [key, group] of groups) {
			const [net, layer] = key.split('#@#');

			if (settings.debug) {
				debugLog(`[Smooth Debug] 处理组: net=${net}, layer=${layer}, 包含 ${group.length} 条导线`);
			}

			// 改进的路径提取逻辑：找到所有连续路径
			const segs = group.map(t => ({
				p1: { x: t.getState_StartX(), y: t.getState_StartY() },
				p2: { x: t.getState_EndX(), y: t.getState_EndY() },
				width: t.getState_LineWidth(),
				id: t.getState_PrimitiveId(),
				track: t,
			}));

			if (settings.debug) {
				debugLog(`[Smooth Debug] 组 net=${net}, layer=${layer}: 提取到 ${segs.length} 个线段`);
			}

			// 构建邻接表
			const connections = new Map<string, typeof segs[0][]>();
			for (const seg of segs) {
				const key1 = `${seg.p1.x},${seg.p1.y}`;
				const key2 = `${seg.p2.x},${seg.p2.y}`;
				if (!connections.has(key1))
					connections.set(key1, []);
				if (!connections.has(key2))
					connections.set(key2, []);
				connections.get(key1)?.push(seg);
				connections.get(key2)?.push(seg);
			}

			// 提取所有连续路径
			const used = new Set<string>();
			const paths: { points: Point[]; ids: string[]; width: number }[] = [];

			for (const startSeg of segs) {
				if (used.has(startSeg.id))
					continue;

				const points: Point[] = [startSeg.p1, startSeg.p2];
				const idsToDelete: string[] = [startSeg.id];
				used.add(startSeg.id);

				// 向两端扩展路径
				let extended = true;
				while (extended) {
					extended = false;

					// 尝试从末端扩展
					const lastKey = `${points[points.length - 1].x},${points[points.length - 1].y}`;
					const lastConns = connections.get(lastKey) || [];
					for (const seg of lastConns) {
						if (used.has(seg.id))
							continue;
						const nextKey1 = `${seg.p1.x},${seg.p1.y}`;
						const nextKey2 = `${seg.p2.x},${seg.p2.y}`;
						if (nextKey1 === lastKey) {
							points.push(seg.p2);
							idsToDelete.push(seg.id);
							used.add(seg.id);
							extended = true;
							break;
						}
						else if (nextKey2 === lastKey) {
							points.push(seg.p1);
							idsToDelete.push(seg.id);
							used.add(seg.id);
							extended = true;
							break;
						}
					}

					// 尝试从起点扩展
					if (!extended) {
						const firstKey = `${points[0].x},${points[0].y}`;
						const firstConns = connections.get(firstKey) || [];
						for (const seg of firstConns) {
							if (used.has(seg.id))
								continue;
							const nextKey1 = `${seg.p1.x},${seg.p1.y}`;
							const nextKey2 = `${seg.p2.x},${seg.p2.y}`;
							if (nextKey1 === firstKey) {
								points.unshift(seg.p2);
								idsToDelete.push(seg.id);
								used.add(seg.id);
								extended = true;
								break;
							}
							else if (nextKey2 === firstKey) {
								points.unshift(seg.p1);
								idsToDelete.push(seg.id);
								used.add(seg.id);
								extended = true;
								break;
							}
						}
					}
				}

				if (points.length >= 3) {
					paths.push({
						points,
						ids: idsToDelete,
						width: startSeg.width,
					});
				}
			}

			if (settings.debug) {
				debugLog(`[Smooth Debug] 提取到 ${paths.length} 条路径`);
			}

			// 处理每条路径
			for (const path of paths) {
				const { points, ids: idsToDelete, width } = path;

				if (settings.debug) {
					debugLog(`[Smooth Debug] 路径包含 ${points.length} 个点`);
				}

				if (points.length >= 3) {
					processedPaths++;
					let radius = settings.cornerRadius;
					if (settings.unit === 'mil') {
						radius = radius * 0.0254;
					}

					// 生成新的几何结构
					const newPath: {
						type: 'line' | 'arc';
						start: Point;
						end: Point;
						angle?: number;
					}[] = [];
					let currentStart = points[0];

					for (let i = 1; i < points.length - 1; i++) {
						const pPrev = points[i - 1];
						const pCorner = points[i];
						const pNext = points[i + 1];

						// 计算导线之间的角度
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

						// 夹角计算
						const dot = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
						const angleRad = Math.acos(
							Math.max(-1, Math.min(1, dot)),
						);
						const angleDeg = (angleRad * 180) / Math.PI;

						// 跳过接近180度的直线（几乎没有拐角）
						if (angleDeg > 170 || angleDeg < 10) {
							if (settings.debug) {
								debugLog(`[Smooth Debug] 跳过角度${angleDeg.toFixed(1)}°的拐点`);
							}
							continue;
						}

						// 计算切点距离：d = R / tan(angle/2)
						const halfAngle = angleRad / 2;
						const tanHalfAngle = Math.tan(halfAngle);
						const d = radius / tanHalfAngle;

						// 限制切点距离不超过线段长度的50%
						const maxD = Math.min(mag1, mag2) * 0.5;
						const actualD = Math.min(d, maxD);

						if (settings.debug) {
							debugLog(
								`[Smooth Debug] 拐点${i}: 角度=${angleDeg.toFixed(1)}°, 半径=${radius.toFixed(2)}mm, 计算距离=${d.toFixed(2)}mm, 实际距离=${actualD.toFixed(2)}mm, 线段长度=(${mag1.toFixed(2)}, ${mag2.toFixed(2)})`,
							);
						}

						if (actualD > 0.01) {
							const pStart = lerp(pCorner, pPrev, actualD / mag1);
							const pEnd = lerp(pCorner, pNext, actualD / mag2);

							// 添加进入角
							newPath.push({
								type: 'line',
								start: currentStart,
								end: pStart,
							});

							// 计算 Arc 角度
							// 使用有符号角度
							const sweptAngle = getAngleBetween(
								{ x: -v1.x, y: -v1.y },
								{ x: v2.x, y: v2.y },
							);

							newPath.push({
								type: 'arc',
								start: pStart,
								end: pEnd,
								angle: sweptAngle,
							});

							createdArcs++;
							currentStart = pEnd;
						}
					}
					newPath.push({
						type: 'line',
						start: currentStart,
						end: points[points.length - 1],
					});

					// 执行删除和创建
					if (settings.replaceOriginal) {
						// 收集原始Polyline对象ID（如果有）
						const polylineIds = new Set<string>();
						const lineIds: string[] = [];

						for (const id of idsToDelete) {
							// 检查是否是Polyline片段
							const seg = segs.find(s => s.id === id);
							if (seg?.track._isPolylineSegment) {
								const originalId = seg.track._originalPolyline?.getState_PrimitiveId();
								if (originalId) {
									polylineIds.add(originalId);
								}
							}
							else {
								lineIds.push(id);
							}
						}

						// 删除Polyline对象
						if (polylineIds.size > 0) {
							await eda.pcb_PrimitivePolyline.delete(Array.from(polylineIds));
						}

						// 删除普通线段
						if (lineIds.length > 0) {
							await eda.pcb_PrimitiveLine.delete(lineIds);
						}
					}

					for (const item of newPath) {
						if (item.type === 'line') {
							if (dist(item.start, item.end) > 0.001) {
								await eda.pcb_PrimitiveLine.create(
									net,
									layer as any,
									item.start.x,
									item.start.y,
									item.end.x,
									item.end.y,
									width,
								);
							}
						}
						else {
							await eda.pcb_PrimitiveArc.create(
								net,
								layer as any,
								item.start.x,
								item.start.y,
								item.end.x,
								item.end.y,
								item.angle!,
								width,
							);
						}
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
					`${eda.sys_I18n.text('圆弧优化完成')}: ${eda.sys_I18n.text('处理路径')} ${processedPaths}, ${eda.sys_I18n.text('创建圆弧')} ${createdArcs}`,
				);
			}
			else {
				eda.sys_Message.showToastMessage(
					eda.sys_I18n.text('未找到可以圆滑的拐角（需要至少2条连续导线形成拐角）'),
				);
			}
		}

		if (settings.syncTeardrops) {
			await addTeardrops();
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
			eda.sys_Dialog.showInformationMessage(e.message, 'Smooth Error');
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
