import type {
	IDataObject,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

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
// Lead custom field value helpers
// ---------------------------------------------------------------------------

export function normalizeCustomFieldType(type: string): string {
	const normalizedType = type.trim().toLowerCase().replace(/\s+/g, '_');
	return normalizedType === 'multi_select' ? 'multiselect' : normalizedType;
}

export function isMultiselectCustomFieldType(type: string | undefined): boolean {
	return normalizeCustomFieldType(type ?? '') === 'multiselect';
}

export function resolveMultiselectCustomFieldValue(
	node: INode,
	rawValue: unknown,
	itemIndex?: number,
	fieldLabel?: string,
): string[] {
	if (Array.isArray(rawValue)) {
		return rawValue
			.map((value) => (value ?? '').toString().trim())
			.filter((value) => value.length > 0);
	}

	const trimmedValue = (rawValue ?? '').toString().trim();
	if (!trimmedValue) return [];

	const multiselectErrorMessage = fieldLabel
		? `Invalid value for custom field "${fieldLabel}"`
		: 'Invalid multiselect value';
	const multiselectErrorDescription =
		'Multiselect value must be a JSON array (e.g. ["option1"]) or comma-separated text.';

	if (trimmedValue.startsWith('[')) {
		let parsedValue: unknown;
		try {
			parsedValue = JSON.parse(trimmedValue);
		} catch {
			throw new NodeOperationError(node, multiselectErrorMessage, {
				itemIndex,
				description: multiselectErrorDescription,
			});
		}
		if (!Array.isArray(parsedValue)) {
			throw new NodeOperationError(node, multiselectErrorMessage, {
				itemIndex,
				description: multiselectErrorDescription,
			});
		}
		return parsedValue
			.map((value) => (value ?? '').toString().trim())
			.filter((value) => value.length > 0);
	}

	return trimmedValue
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

export function resolveLeadCustomFieldValue(
	node: INode,
	fieldType: string | undefined,
	rawValue: unknown,
	itemIndex?: number,
	fieldLabel?: string,
): string | string[] {
	if (!isMultiselectCustomFieldType(fieldType)) {
		return (rawValue ?? '').toString();
	}
	return resolveMultiselectCustomFieldValue(node, rawValue, itemIndex, fieldLabel);
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

/**
 * JSON body from a failed HTTP call (e.g. Axios `response.data` or n8n `NodeApiError.context.data`).
 */
export function getAdhubHttpErrorResponseBody(error: unknown): IDataObject | undefined {
	if (!error || typeof error !== 'object') return undefined;

	const ax = error as { response?: { data?: unknown } };
	if (
		ax.response?.data &&
		typeof ax.response.data === 'object' &&
		!Array.isArray(ax.response.data)
	) {
		return ax.response.data as IDataObject;
	}

	const withContext = error as { context?: { data?: unknown } };
	if (
		withContext.context?.data &&
		typeof withContext.context.data === 'object' &&
		!Array.isArray(withContext.context.data)
	) {
		return withContext.context.data as IDataObject;
	}

	return undefined;
}

function formatLaravelStyleApiErrors(errorsField: unknown): string | undefined {
	if (!errorsField || typeof errorsField !== 'object' || Array.isArray(errorsField)) return undefined;
	const lines: string[] = [];
	for (const [field, val] of Object.entries(errorsField as Record<string, unknown>)) {
		if (Array.isArray(val)) {
			for (const msg of val) lines.push(`${field}: ${String(msg)}`);
		} else if (val != null && String(val).trim() !== '') {
			lines.push(`${field}: ${String(val)}`);
		}
	}
	return lines.length ? lines.join('\n') : undefined;
}

/** Human-readable summary for API validation / error payloads (422, etc.). */
export function formatAdhubApiErrorDescription(body: IDataObject): string | undefined {
	const fromErrors = formatLaravelStyleApiErrors(body.errors);
	if (fromErrors) return fromErrors;
	const msg = body.message;
	if (typeof msg === 'string' && msg.trim()) return msg.trim();
	return undefined;
}

function getHttpStatusFromError(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const e = error as Record<string, unknown>;
	if (typeof e.httpCode === 'string' && e.httpCode.length > 0) return e.httpCode;
	const status = (e.response as { status?: number } | undefined)?.status;
	if (typeof status === 'number') return String(status);
	return undefined;
}

/** Item output when the node uses Continue On Fail — includes API body for 422 etc. */
export function formatAdhubFailedRequestExecutionData(
	error: unknown,
	itemIndex: number,
): INodeExecutionData {
	const json: JsonRecord = {
		error: error instanceof Error ? error.message : String(error),
	};
	const body = getAdhubHttpErrorResponseBody(error);
	if (body) {
		json.apiResponseBody = body;
		const summary = formatAdhubApiErrorDescription(body);
		if (summary) json.errorSummary = summary;
	}
	const httpCode = getHttpStatusFromError(error);
	if (httpCode) json.httpCode = httpCode;
	return { json, pairedItem: { item: itemIndex } };
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
		const body = getAdhubHttpErrorResponseBody(error);
		const description = body ? formatAdhubApiErrorDescription(body) : undefined;
		throw new NodeApiError(node, error as JsonObject, {
			itemIndex,
			...(description ? { description } : {}),
		});
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
