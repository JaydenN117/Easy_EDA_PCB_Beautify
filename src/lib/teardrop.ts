import { debugLog, logError } from './logger';
import { cubicBezier, dist, lerp } from './math';
import { getSettings } from './settings';
import { createSnapshot } from './snapshot';

export async function addTeardrops() {
	const settings = await getSettings();

	if (
		eda.sys_LoadingAndProgressBar
		&& typeof eda.sys_LoadingAndProgressBar.showLoading === 'function'
	) {
		eda.sys_LoadingAndProgressBar.showLoading();
	}

	let scopeLabel = '(All)';
	try {
		const selectedIds = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();
		if (selectedIds && selectedIds.length > 0) {
			scopeLabel = '(Selected)';
		}
	}
	catch {
		// ignore
	}

	// Create pre-operation snapshot
	try {
		await createSnapshot(`Teardrop ${scopeLabel} Before`);
	}
	catch (e: any) {
		logError(`Failed to create snapshot: ${e.message || e}`);
	}

	try {
		await removeExistingTeardrops(); // Remove existing first

		let pins: any[] = [];
		const selected = await eda.pcb_SelectControl.getAllSelectedPrimitives();

		if (selected && Array.isArray(selected) && selected.length > 0) {
			// Process selected
			let primitives: any[] = [];
			if (typeof selected[0] === 'string') {
				for (const id of selected as unknown as string[]) {
					const p
						= (await eda.pcb_PrimitivePad.get(id))
							|| (await eda.pcb_PrimitiveVia.get(id))
							|| (await eda.pcb_PrimitiveComponent.get(id));
					if (p)
						primitives.push(p);
				}
			}
			else {
				primitives = selected;
			}
			pins = primitives.filter(
				(p: any) =>
					p
					&& typeof p.getState_PrimitiveType === 'function'
					&& (p.getState_PrimitiveType() === 'Pad'
						|| p.getState_PrimitiveType() === 'Via'
						|| p.getState_PrimitiveType() === 'ComponentPad'),
			);
		}

		// If no valid selection, process entire board
		if (pins.length === 0) {
			debugLog('No objects selected, fetching all board pads and vias', 'Teardrop');
			// Get all board pad and via IDs, then fetch objects individually
			const padIds = await eda.pcb_PrimitivePad.getAllPrimitiveId();
			const viaIds = await eda.pcb_PrimitiveVia.getAllPrimitiveId();

			debugLog(`Found ${padIds.length} pads, ${viaIds.length} vias`, 'Teardrop');

			for (const id of padIds) {
				const pad = await eda.pcb_PrimitivePad.get(id);
				if (pad)
					pins.push(pad);
			}
			for (const id of viaIds) {
				const via = await eda.pcb_PrimitiveVia.get(id);
				if (via)
					pins.push(via);
			}
		}

		debugLog(`Processing ${pins.length} pads/vias`, 'Teardrop');

		let processedCount = 0;
		for (const pin of pins) {
			const net = pin.getState_Net();
			if (!net) {
				continue;
			}

			const px = pin.getState_X();
			const py = pin.getState_Y();

			processedCount++;

			// Get tracks connected to this pad (across all layers)
			const allTracks = await eda.pcb_PrimitiveLine.getAll(net);
			const connectedTracks = allTracks.filter(
				(p: any) =>
					dist(
						{ x: p.getState_StartX(), y: p.getState_StartY() },
						{ x: px, y: py },
					) < 0.1
					|| dist(
						{ x: p.getState_EndX(), y: p.getState_EndY() },
						{ x: px, y: py },
					) < 0.1,
			);

			for (const track of connectedTracks) {
				await createTeardropForTrack(pin, track, settings);
			}
		}

		debugLog(`Processing complete, processed ${processedCount} pads/vias`, 'Teardrop');

		if (
			eda.sys_Message
			&& typeof eda.sys_Message.showToastMessage === 'function'
		) {
			eda.sys_Message.showToastMessage(eda.sys_I18n.text(`Teardrop processing complete (processed ${processedCount})`));
		}

		// Create post-operation snapshot
		try {
			await createSnapshot(`Teardrop ${scopeLabel} After`);
		}
		catch (e: any) {
			logError(`Failed to create result snapshot: ${e.message || e}`);
		}
	}
	catch (e: any) {
		if (
			eda.sys_Dialog
			&& typeof eda.sys_Dialog.showInformationMessage === 'function'
		) {
			eda.sys_Dialog.showInformationMessage(e.message, 'Teardrop Error');
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

async function removeExistingTeardrops() {
	try {
		const regions = await eda.pcb_PrimitiveRegion.getAll();
		const toDelete: string[] = [];

		if (regions && Array.isArray(regions)) {
			for (const region of regions) {
				let name = '';
				if (typeof region.getState_RegionName === 'function') {
					name = region.getState_RegionName() ?? '';
				}

				if (name === 'Teardrop') {
					if (typeof region.getState_PrimitiveId === 'function') {
						const id = region.getState_PrimitiveId();
						if (id) {
							toDelete.push(id);
						}
					}
				}
			}
		}

		if (toDelete.length > 0) {
			await eda.pcb_PrimitiveRegion.delete(toDelete);
		}
	}
	catch (e) {
		console.error('Failed to remove existing teardrops', e);
	}
}

async function createTeardropForTrack(pin: any, track: any, settings: any) {
	const px = pin.getState_X();
	const py = pin.getState_Y();
	const trackWidth = track.getState_LineWidth();

	// Determine which end connects to the pad
	const isStart
		= dist(
			{ x: track.getState_StartX(), y: track.getState_StartY() },
			{ x: px, y: py },
		) < 0.1;
	const pFar = isStart
		? { x: track.getState_EndX(), y: track.getState_EndY() }
		: { x: track.getState_StartX(), y: track.getState_StartY() };
	const pNear = { x: px, y: py };

	// Direction vector
	const dx = pFar.x - pNear.x;
	const dy = pFar.y - pNear.y;
	const d = Math.sqrt(dx * dx + dy * dy);
	const ux = dx / d;
	const uy = dy / d;

	// Perpendicular vector (90 degree rotation)
	const vx = -uy;
	const vy = ux;

	// Teardrop length and width (based on settings)
	const length = trackWidth * 3 * settings.teardropSize;
	const widthAtPad = trackWidth * 2 * settings.teardropSize;

	const pTrack = lerp(pNear, pFar, length / d);
	const pEdge1 = {
		x: pNear.x + (vx * widthAtPad) / 2,
		y: pNear.y + (vy * widthAtPad) / 2,
	};
	const pEdge2 = {
		x: pNear.x - (vx * widthAtPad) / 2,
		y: pNear.y - (vy * widthAtPad) / 2,
	};

	// Generate Bezier curve point set to simulate smooth teardrop curves
	const polyPoints: any[] = [];

	// Connect P1 -> P_Track -> P2 -> P_Near -> P1
	// Use Bezier interpolation for P1 -> P_Track and P2 -> P_Track
	const steps = 10;

	// Curve from P1 to P_Track
	const cp1 = lerp(pEdge1, pTrack, 0.5); // Control point 1
	const cp2 = lerp(pEdge1, pTrack, 0.8); // Control point 2
	for (let i = 0; i <= steps; i++) {
		const pt = cubicBezier(pEdge1, cp1, cp2, pTrack, i / steps);
		polyPoints.push(pt.x, pt.y);
	}

	// Curve from P_Track to P2
	const cp3 = lerp(pEdge2, pTrack, 0.8);
	const cp4 = lerp(pEdge2, pTrack, 0.5);
	for (let i = 0; i <= steps; i++) {
		const pt = cubicBezier(pTrack, cp3, cp4, pEdge2, i / steps);
		polyPoints.push(pt.x, pt.y);
	}

	polyPoints.push(pNear.x, pNear.y);

	const polygon = eda.pcb_MathPolygon.createPolygon(polyPoints);
	if (polygon) {
		await eda.pcb_PrimitiveRegion.create(
			track.getState_Layer(),
			polygon as any,
			undefined,
			'Teardrop',
		);
	}
}
