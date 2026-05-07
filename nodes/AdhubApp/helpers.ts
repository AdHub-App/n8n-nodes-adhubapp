import type {
	IDataObject,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type JsonRecord = IDataObject;

export interface AdhubAppCredentials {
	apiToken: string;
	ignoreSslIssues: boolean;
}

export type ApiConfig = AdhubAppCredentials;

const ADHUB_BASE_URL = 'https://web.adhubapp.com';
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type QueryFieldDefinition = {
	key?: string;
	label?: string;
	type?: string;
	operators?: string[];
	options?: Array<{ value?: string; label?: string }>;
};

// ---------------------------------------------------------------------------
// In-memory query-fields cache (per context + token suffix)
// TTL: 5 min — covers a full loadOptions session without stale data issues.
// ---------------------------------------------------------------------------

type CacheEntry = { fields: QueryFieldDefinition[]; expiresAt: number };
const queryFieldsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface RequestContext {
	helpers: { httpRequest: (options: IHttpRequestOptions) => Promise<unknown> };
}

export async function fetchQueryFields(
	ctx: RequestContext,
	apiConfig: ApiConfig,
	context: 'lead.list' | 'task.list' | 'lead.assignment',
): Promise<QueryFieldDefinition[]> {
	const cacheKey = `${apiConfig.apiToken.slice(-12)}_${context}`;
	const cached = queryFieldsCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.fields;
	}

	const options = buildRequestOptions({
		method: 'GET',
		endpoint: '/query-builder/fields',
		apiConfig,
		qs: { context },
	});

	const response = (await ctx.helpers.httpRequest(options)) as unknown;
	let fields: QueryFieldDefinition[] = [];

	if (Array.isArray(response)) {
		fields = response as QueryFieldDefinition[];
	} else if (response && typeof response === 'object') {
		const payload = response as JsonRecord;
		const candidates = [payload.data, payload.fields, payload.items];
		for (const candidate of candidates) {
			if (Array.isArray(candidate)) {
				fields = candidate as QueryFieldDefinition[];
				break;
			}
		}
	}

	queryFieldsCache.set(cacheKey, { fields, expiresAt: Date.now() + CACHE_TTL_MS });
	return fields;
}

// ---------------------------------------------------------------------------
// Shared rule-value resolver
// ---------------------------------------------------------------------------

export function resolveRuleValue(
	rule: {
		value?: string;
		operator?: string;
		valueSelect?: string;
		valueDate?: string;
		valueText?: string;
	},
	field?: QueryFieldDefinition,
): string {
	const normalizedType = (field?.type ?? '').toString().trim().toLowerCase();
	const optionList = Array.isArray(field?.options) ? field.options : [];
	const hasSelectOptions = optionList.length > 0;
	const normalizedOperator = (rule?.operator ?? '').toString().trim().toLowerCase();
	const usesTextForDateInput =
		normalizedOperator === 'between' ||
		normalizedOperator === 'x days before' ||
		normalizedOperator === 'x days after';

	const directValue = (rule?.value ?? '').toString().trim();
	const selectValue = (rule?.valueSelect ?? '').toString().trim();
	const dateValue = (rule?.valueDate ?? '').toString().trim();
	const textValue = (rule?.valueText ?? '').toString().trim();

	if (directValue) return directValue;
	if (hasSelectOptions) return selectValue || textValue || dateValue;
	if (normalizedType.includes('date') || normalizedType.includes('time')) {
		if (usesTextForDateInput) return textValue || dateValue || selectValue;
		return dateValue || textValue || selectValue;
	}
	return textValue || selectValue || dateValue;
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

export function parseJson(
	value: string | undefined,
	fieldName: string,
	node: INode,
	itemIndex?: number,
): unknown {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		if (parsed !== null && typeof parsed === 'object') return parsed;
		throw new NodeOperationError(node, `${fieldName} must be valid JSON`, {
			itemIndex,
			description: 'Expected a JSON object or array.',
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new NodeOperationError(node, `Invalid JSON in "${fieldName}": ${message}`, {
			itemIndex,
		});
	}
}

// ---------------------------------------------------------------------------
// HTTP request builder
// ---------------------------------------------------------------------------

export function buildRequestOptions(config: {
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
		url: `${ADHUB_BASE_URL}/api/v1${config.endpoint}`,
		qs: config.qs ?? {},
		headers,
		json: true,
		timeout: REQUEST_TIMEOUT_MS,
	};

	if (config.apiConfig.ignoreSslIssues) {
		options.skipSslCertificateValidation = true;
	}

	if (config.body) {
		options.body = config.body;
	}

	return options;
}

export function isTlsCertificateVerificationError(error: unknown): boolean {
	const errorMessage =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: '';

	return (
		errorMessage.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
		errorMessage.includes('unable to verify the first certificate')
	);
}

export async function executeAdhubRequest(
	request: (options: IHttpRequestOptions) => Promise<unknown>,
	options: IHttpRequestOptions,
	node: INode,
	itemIndex?: number,
): Promise<unknown> {
	try {
		return await request(options);
	} catch (error) {
		if (isTlsCertificateVerificationError(error)) {
			throw new NodeOperationError(node, 'TLS certificate verification failed when contacting AdHub API.', {
				itemIndex,
				description:
					'If your environment uses a private root CA, run n8n/Node.js with --use-system-ca. For local test environments only, you can also enable the "Ignore SSL Issues" credential option.',
			});
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new NodeOperationError(node, message, { itemIndex });
	}
}

export function formatAdhubNodeResponse(response: unknown): JsonRecord {
	if (Array.isArray(response)) {
		return { data: response as unknown as IDataObject[] };
	}

	if (response && typeof response === 'object') {
		const payload = response as JsonRecord;

		if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
			return { data: payload.data as JsonRecord['data'] };
		}

		return payload;
	}

	return { data: response as JsonRecord['data'] };
}
