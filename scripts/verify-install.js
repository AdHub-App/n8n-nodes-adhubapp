#!/usr/bin/env node
'use strict';

/**
 * verify-install.js
 *
 * Runs as the `preinstall` hook. Warns if the package is being installed
 * outside of n8n's community node manager, where it won't be picked up
 * correctly by n8n's node loader.
 */

const isN8nInstall =
	process.env.npm_config_global === 'true' ||
	process.env.N8N_CUSTOM_EXTENSIONS !== undefined ||
	process.env.N8N_USER_FOLDER !== undefined;

if (!isN8nInstall) {
	console.warn('');
	console.warn('  ⚠️  AdHub n8n Community Node');
	console.warn('');
	console.warn(
		'  This package is designed to be installed via the n8n community nodes interface,',
	);
	console.warn(
		'  not directly via npm. Installing via npm will not automatically make the nodes',
	);
	console.warn('  available inside n8n.');
	console.warn('');
	console.warn('  To install correctly:');
	console.warn('  1. Open n8n → Settings → Community Nodes');
	console.warn('  2. Click "Install a community node"');
	console.warn('  3. Enter: n8n-nodes-adhubapp');
	console.warn('');
	console.warn(
		'  For self-hosted installs requiring manual npm install, see the README.',
	);
	console.warn('');
}
