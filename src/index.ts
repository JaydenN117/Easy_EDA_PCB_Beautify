/**
 * Entry file
 *
 * This is the default extension entry file. To use a different entry,
 * modify the `entry` field in `extension.json`.
 *
 * Use `export` here to expose all methods referenced in `headerMenus`.
 * Methods are associated with `headerMenus` by their function name.
 *
 * For more development details, see:
 * https://prodocs.lceda.cn/cn/api/guide/
 */

import { beautifyRouting as beautifyTask } from './lib/beautify';
import { debugLog, debugWarn, logError } from './lib/logger';
import { getDefaultSettings, getSettings } from './lib/settings';
import { undoLastOperation as undoTask } from './lib/snapshot';
import * as Snapshot from './lib/snapshot';
import { addWidthTransitionsAll, addWidthTransitionsSelected } from './lib/widthTransition';

export function activate(_status?: 'onStartupFinished', _arg?: string): void {
	// Initialize settings (load into cache)
	getSettings();

	// Mount features onto the eda global object for settings.html to call
	(eda as any).jlc_eda_beautify_snapshot = Snapshot;
	(eda as any).jlc_eda_beautify_refreshSettings = getSettings;
	(eda as any).jlc_eda_beautify_getDefaultSettings = getDefaultSettings;

	// Dynamically refresh header menus to ensure they display correctly
	try {
		if (eda.sys_HeaderMenu && typeof eda.sys_HeaderMenu.replaceHeaderMenus === 'function') {
			eda.sys_HeaderMenu.replaceHeaderMenus({
				pcb: [
					{
						id: 'BeautifyPCB',
						title: eda.sys_I18n ? eda.sys_I18n.text('美化PCB') : 'Beautify PCB',
						menuItems: [
							{
								id: 'BeautifySelected',
								title: eda.sys_I18n ? eda.sys_I18n.text('圆滑布线（选中）') : 'Smooth Routing (Selected)',
								registerFn: 'beautifySelected',
							},
							{
								id: 'BeautifyAll',
								title: eda.sys_I18n ? eda.sys_I18n.text('圆滑布线（全部）') : 'Smooth Routing (All)',
								registerFn: 'beautifyAll',
							},
							{
								id: 'WidthSelected',
								title: eda.sys_I18n ? eda.sys_I18n.text('过渡线宽（选中）') : 'Width Transition (Selected)',
								registerFn: 'widthTransitionSelected',
							},
							{
								id: 'WidthAll',
								title: eda.sys_I18n ? eda.sys_I18n.text('过渡线宽（全部）') : 'Width Transition (All)',
								registerFn: 'widthTransitionAll',
							},
							{
								id: 'Undo',
								title: eda.sys_I18n ? eda.sys_I18n.text('撤销') : 'Undo',
								registerFn: 'undoOperation',
							},
							{
								id: 'Settings',
								title: eda.sys_I18n ? eda.sys_I18n.text('设置') : 'Settings',
								registerFn: 'openSettings',
							},
						],
					},
				],
			});
			debugLog('Header menus registered successfully', 'PCB');
		}
		else {
			debugWarn('sys_HeaderMenu not available', 'PCB');
		}
	}
	catch (e: any) {
		debugWarn(`Failed to register header menus dynamically: ${e.message || e}`, 'PCB');
	}
}

/**
 * Smooth selected routing
 */
export async function beautifySelected() {
	try {
		await beautifyTask('selected');
	}
	catch (e: any) {
		handleError(e);
	}
}

/**
 * Smooth all routing
 */
export async function beautifyAll() {
	try {
		await beautifyTask('all');
	}
	catch (e: any) {
		handleError(e);
	}
}

function handleError(e: any) {
	logError(`Beautify Routing Error: ${e.message || e}`);
	if (
		eda.sys_Dialog
		&& typeof eda.sys_Dialog.showInformationMessage === 'function'
	) {
		eda.sys_Dialog.showInformationMessage(
			e.message || 'Error',
			'Beautify Error',
		);
	}
}

/**
 * Undo operation
 */
export async function undoOperation() {
	try {
		await undoTask();
	}
	catch (e: any) {
		logError(`Undo Error: ${e.message || e}`);
	}
}

/**
 * Width Transition - Selected
 */
export async function widthTransitionSelected() {
	try {
		await addWidthTransitionsSelected();
	}
	catch (e: any) {
		logError(`Width Transition Error: ${e.message || e}`);
		if (
			eda.sys_Dialog
			&& typeof eda.sys_Dialog.showInformationMessage === 'function'
		) {
			eda.sys_Dialog.showInformationMessage(
				e.message || 'Error',
				'Width Transition Error',
			);
		}
	}
}

/**
 * Width Transition - All
 */
export async function widthTransitionAll() {
	try {
		await addWidthTransitionsAll();
		eda.sys_Message?.showToastMessage(eda.sys_I18n ? eda.sys_I18n.text('线宽过渡完成') : 'Width transition completed');
	}
	catch (e: any) {
		logError(`Width Transition Error: ${e.message || e}`);
		if (
			eda.sys_Dialog
			&& typeof eda.sys_Dialog.showInformationMessage === 'function'
		) {
			eda.sys_Dialog.showInformationMessage(
				e.message || 'Error',
				'Width Transition Error',
			);
		}
	}
}

/**
 * Open settings
 */
export async function openSettings() {
	// Open settings window using an iframe
	// Window size: 540px width, 600px height
	eda.sys_IFrame.openIFrame('/iframe/settings.html', 540, 600, 'settings');
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('圆滑布线 & 线宽过渡工具'),
		eda.sys_I18n.text('About'),
	);
}
