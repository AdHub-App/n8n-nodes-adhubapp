const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const n8nUserFolder = path.join(os.homedir(), '.n8n-node-cli');
const n8nCommand = process.platform === 'win32' ? 'n8n' : 'n8n';
const args = ['start', ...process.argv.slice(2)];

const child = spawn(n8nCommand, args, {
	stdio: 'inherit',
	shell: process.platform === 'win32',
	env: {
		...process.env,
		N8N_DEV_RELOAD: 'true',
		DB_SQLITE_POOL_SIZE: '10',
		N8N_USER_FOLDER: n8nUserFolder,
	},
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 0);
});

child.on('error', (error) => {
	console.error(`Failed to start n8n: ${error.message}`);
	process.exit(1);
});
