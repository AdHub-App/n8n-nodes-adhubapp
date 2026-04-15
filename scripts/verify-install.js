const fs = require('fs');
const path = require('path');

const packageRoot = path.resolve(__dirname, '..');
const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null;
const repoNodeModules = path.join(packageRoot, 'node_modules');

if (!initCwd || initCwd === packageRoot) {
	process.exit(0);
}

// Installing from a local repo path can create a junction to the whole checkout.
// n8n then scans this repo's dev dependencies and mistakes files like
// brotli-wasm/index.node.js for custom n8n node classes.
if (fs.existsSync(repoNodeModules)) {
	console.error(
		[
			'Local install from the repository root is blocked for n8n-nodes-adhubapp.',
			'',
			'Why this fails:',
			'- npm links the whole repository into node_modules',
			"- that includes this repo's dev node_modules",
			'- n8n scans nested *.node.js files and crashes on dependency files such as brotli-wasm/index.node.js',
			'',
			'Install one of these instead:',
			`- ${path.join(packageRoot, 'dist')}`,
			'- a tarball created with `npm pack`',
			'- the published npm package',
		].join('\n'),
	);
	process.exit(1);
}
