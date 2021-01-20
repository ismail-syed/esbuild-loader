import webpack = require("webpack");
import { getOptions } from "loader-utils";
import { BuildOptions } from "esbuild";
import { existsSync } from "fs";
import { Compiler } from "./interfaces";

interface LoaderOptions {
	buildOptions: BuildOptions;
}

async function ESBuildLoader(
	this: webpack.loader.LoaderContext,
	source: string
) {
	const done = this.async()!;
	const options = getOptions(this);
	const service = (this._compiler as Compiler).$esbuildService;

	if (!service) {
		done(
			new Error(
				"[esbuild-loader] You need to add ESBuildPlugin to your webpack config first"
			)
		);
		return;
	}

	// webpack-virtual-modules react-server/webpack-plugin
	// if we hit a virutal file, we need to use s

	const fileExists = existsSync(this.resourcePath);
	const baseOptions = {
		...(fileExists
			? { entryPoints: [this.resourcePath] }
			: {
					stdin: {
						contents: source,
						sourcefile: this.resourcePath,
						loader: "js",
					},
			  }),
		loader: {
			".esnext": "js",
		},
		target: "es2015",
		write: false,
		format: "cjs",
		sourcemap: this.sourceMap,
	};

	try {
		const result = await service.build({
			...baseOptions,
			...(options.buildOptions as LoaderOptions["buildOptions"]),
		} as BuildOptions);

		if (!result.outputFiles) {
			throw Error(`ESBuild loader failed on: ${this.resourcePath}`);
		}

		done(null, result.outputFiles[0].text);
	} catch (error: unknown) {
		done(error as Error);
	}
}

export default ESBuildLoader;
