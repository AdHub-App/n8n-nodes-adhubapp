import type { ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

export class AdhubAppApi implements ICredentialType {
	name = 'adhubAppApi';
	displayName = 'AdHub App API';
	documentationUrl = 'https://web.adhubapp.com/docs/swagger';
	icon: Icon = 'file:adhubapp.svg';

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
			url: 'https://web.adhubapp.com/api/v1/integrations/n8n/verify',
			skipSslCertificateValidation: '={{$credentials.ignoreSslIssues === true}}',
		},
	};

	properties: INodeProperties[] = [
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
