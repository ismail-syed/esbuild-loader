import assert from 'assert';
import { RawSource, SourceMapSource } from 'webpack-sources';
import { matchObject } from 'webpack/lib/ModuleFilenameHelpers.js';
import webpack from 'webpack';
import { Compiler, MinifyPluginOptions } from './interfaces';

type KnownStatsPrinterContext = {
	formatFlag(flag: string): string;
	green(string: string): string;
};

type Tappable = {
	tap(
		name: string,
		callback: (
			minimized: boolean,
			statsPrinterContext: KnownStatsPrinterContext,
		) => void,
	): void;
};

type StatsPrinter = {
	hooks: {
		print: {
			for(name: string): Tappable;
		},
	},
};

// Messes with TypeScript rootDir
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

type Asset = webpack.compilation.Asset;

const isJsFile = /\.js$/i;
const pluginName = 'esbuild-minify';

const flatMap = <T, U>(
	array: T[],
	callback: (value: T) => U[],
): U[] => (
		// eslint-disable-next-line unicorn/no-fn-reference-in-iterator
		Array.prototype.concat(...array.map(callback))
	);

class ESBuildMinifyPlugin {
	private readonly options: MinifyPluginOptions;

	constructor(options?: MinifyPluginOptions) {
		this.options = { ...options };

		const hasMinify = Object.keys(this.options).some(k => k.startsWith('minify'));
		if (!hasMinify) {
			this.options.minify = true;
		}
	}

	apply(compiler: Compiler): void {
		compiler.hooks.compilation.tap(pluginName, (compilation) => {
			assert(compiler.$esbuildService, '[esbuild-loader] You need to add ESBuildPlugin to your webpack config first');

			const meta = JSON.stringify({
				name: 'esbuild-loader',
				version,
				options: this.options,
			});
			compilation.hooks.chunkHash.tap(pluginName, (_, hash) => hash.update(meta));

			type Wp5Compilation = typeof compilation & {
				hooks: typeof compilation.hooks & {
					processAssets: typeof compilation.hooks.optimizeAssets;
					statsPrinter: typeof compilation.hooks.childCompiler; // could be any SyncHook
				};
				constructor: {
					PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: number;
				};
			};

			if ('processAssets' in compilation.hooks) {
				const wp5Compilation = <Wp5Compilation>compilation;
				wp5Compilation.hooks.processAssets.tapPromise(
					{
						name: pluginName,
						stage: wp5Compilation.constructor.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
					},
					async (assets: Asset[]) => await this.transformAssets(compilation, Object.keys(assets)),
				);

				wp5Compilation.hooks.statsPrinter.tap(pluginName, (statsPrinter: StatsPrinter) => {
					statsPrinter.hooks.print
						.for('asset.info.minimized')
						.tap(
							pluginName,
							(minimized, { green, formatFlag }) => (
								minimized
									? green(formatFlag('minimized'))
									: undefined
							),
						);
				});
			} else {
				compilation.hooks.optimizeChunkAssets.tapPromise(
					pluginName,
					async chunks => await this.transformAssets(
						compilation,
						flatMap(chunks, chunk => chunk.files),
					),
				);
			}
		});
	}

	async transformAssets(
		compilation: webpack.compilation.Compilation,
		assetNames: string[],
	): Promise<void> {
		const {
			options: {
				devtool,
			},
			$esbuildService,
		} = compilation.compiler as Compiler;

		assert($esbuildService, '[esbuild-loader] You need to add ESBuildPlugin to your webpack config first');

		const sourcemap = (
			// TODO: drop support for esbuild sourcemap in future so it all goes through WP API
			this.options.sourcemap === undefined
				? devtool && (devtool as string).includes('source-map')
				: this.options.sourcemap
		);

		const { include, exclude, ...transformOptions } = this.options;

		const transforms = assetNames
			.filter(assetName => isJsFile.test(assetName) && matchObject({ include, exclude }, assetName))
			.map((assetName): [string, Asset] => [
				assetName,
				compilation.getAsset(assetName),
			])
			.map(async ([
				assetName,
				{ info, source: assetSource },
			]) => {
				const { source, map } = assetSource.sourceAndMap();
				const result = await $esbuildService.transform(source.toString(), {
					...transformOptions,
					sourcemap,
					sourcefile: assetName,
				});

				compilation.updateAsset(
					assetName,
					sourcemap
						? new SourceMapSource(
							result.code || '',
							assetName,
							<any>result.map,
							source?.toString(),
							map!,
							true,
						)
						: new RawSource(result.code || ''),
					<any>{
						...info,
						minimized: true,
					},
				);
			});

		if (transforms.length > 0) {
			await Promise.all(transforms);
		}
	}
}

export default ESBuildMinifyPlugin;
