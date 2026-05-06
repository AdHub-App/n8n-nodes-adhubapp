#!/usr/bin/env node
'use strict';

/**
 * start-dev-server.js
 *
 * Development helper. Prints instructions for running this node package
 * against a local n8n instance.
 */

console.log('');
console.log('  AdHub n8n Node — Development Server');
console.log('');
console.log('  To test this node against a local n8n instance:');
console.log('');
console.log('  1. Build the nodes:');
console.log('       npm run build');
console.log('');
console.log('  2. Link the package globally:');
console.log('       npm link');
console.log('');
console.log('  3. In your n8n installation directory:');
console.log('       npm link n8n-nodes-adhubapp');
console.log('');
console.log('  4. Start n8n:');
console.log('       n8n start');
console.log('');
console.log(
	'  The AdHub nodes will appear in the n8n node palette under "AdHub App".',
);
console.log('');
