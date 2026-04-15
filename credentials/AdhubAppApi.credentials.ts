import type { ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';
import { LoggerProxy } from 'n8n-workflow';

export class AdhubAppApi implements ICredentialType {
	name = 'adhubAppApi';
	displayName = 'Adhub App API';
	documentationUrl = 'https://docs.n8n.io/integrations/creating-nodes/';
	icon: Icon = 'file:adhubapp.svg';

	constructor() {
		LoggerProxy.info('[AdhubAppApi] credential_type_loaded', {
			credentialType: this.name,
			displayName: this.displayName,
		});
	}

	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
				Accept: 'application/json',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			method: 'POST',
			url: '={{($credentials.serverUrl || "").replace(/\\/+$/, "")}}/api/v1/integrations/n8n/verify',
			skipSslCertificateValidation: '={{$credentials.ignoreSslIssues === true}}',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			required: true,
			description: 'Base URL of your AdHub server',
		},
		{
			displayName: 'n8n Integration Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'One-time AdHub n8n integration token. Use this same Bearer token for verification, API actions, and webhook-linked workflows.',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'ignoreSslIssues',
			type: 'boolean',
			default: false,
			description:
				'Whether to skip SSL certificate validation. Enable only for local or test environments with incomplete certificate chains.',
		},
	];
}
