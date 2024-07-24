import { relative, resolve } from 'node:path';
import process from 'node:process';
import { defineConfig } from 'tsup';

export default defineConfig({
	clean: true,
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	minify: false,
	skipNodeModulesBundle: true,
	sourcemap: true,
	target: 'es2022',
	// eslint-disable-next-line unicorn/prefer-module
	tsconfig: relative(__dirname, resolve(process.cwd(), 'tsconfig.json')),
	keepNames: true,
});
