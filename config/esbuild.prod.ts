import process from 'node:process';
import esbuild from 'esbuild';
// Import base config from submodule
import common from '../pro-api-sdk/config/esbuild.common';

(async () => {
	// You can override submodule config here
	const config = {
		...common,
		format: 'iife' as const,
		entryPoints: {
			index: './src/index', // Ensure this points to root src directory
		},
		footer: {
			js: ';edaEsbuildExportName',
		},
	};

	const ctx = await esbuild.context(config);
	if (process.argv.includes('--watch')) {
		await ctx.watch();
	}
	else {
		await ctx.rebuild();
		process.exit();
	}
})();
