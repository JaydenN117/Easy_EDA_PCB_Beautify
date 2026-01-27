import process from 'node:process';
import esbuild from 'esbuild';
// 引用子模块的基础配置
import common from '../pro-api-sdk/config/esbuild.common';

(async () => {
	// 你可以在这里覆盖子模块的配置
	const config = {
		...common,
		format: 'iife' as const,
		entryPoints: {
			index: './src/index', // 确保指向根目录的 src
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
