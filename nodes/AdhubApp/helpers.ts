import type { IDataObject, IHttpRequestMethods, IHttpRequestOptions } from 'n8n-workflow';

type JsonRecord = IDataObject;
type ApiConfig = {
	apiToken: string;
	serverUrl?: string;
	ignoreSslIssues?: boolean;
};

const DEFAULT_SERVER_URL = 'https://adhub-main-d1fcap.laravel.cloud';

function normalizeServerUrl(serverUrl: string | undefined): string {
	const value = serverUrl?.trim() || DEFAULT_SERVER_URL;
	return value.replace(/\/+$/, '');
}

function parseJson(value: string | undefined, fieldName: string): JsonRecord {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonRecord;
		throw new Error(`${fieldName} must be a JSON object`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in "${fieldName}": ${message}`);
	}
}

function buildRequestOptions(config: {
	method: IHttpRequestMethods;
	endpoint: string;
	apiConfig: ApiConfig;
	qs?: JsonRecord;
	body?: JsonRecord;
}): IHttpRequestOptions {
	const headers: JsonRecord = {
		Authorization: `Bearer ${config.apiConfig.apiToken}`,
		'Content-Type': 'application/json',
	};

	const options: IHttpRequestOptions = {
		method: config.method,
		url: `${normalizeServerUrl(config.apiConfig.serverUrl)}/api/v1${config.endpoint}`,
		qs: config.qs ?? {},
		headers,
		json: true,
	};

	if (config.apiConfig.ignoreSslIssues) {
		options.skipSslCertificateValidation = true;
	}

	if (config.body) {
		options.body = config.body;
	}

	return options;
}

export { DEFAULT_SERVER_URL, type ApiConfig, JsonRecord, buildRequestOptions, normalizeServerUrl, parseJson };
