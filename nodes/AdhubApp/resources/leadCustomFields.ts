import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	type ApiConfig,
	buildRequestOptions,
	executeAdhubRequest,
	formatAdhubNodeResponse,
	parseJson,
	JsonRecord,
} from '../helpers';

type LeadCustomFieldOperations =
	| 'listLeadCustomFields'
	| 'createLeadCustomField'
	| 'getLeadCustomField'
	| 'updateLeadCustomField'
	| 'deleteLeadCustomField';

async function handleLeadCustomFields(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadCustomFieldOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const customFieldId = ctx.getNodeParameter('customFieldId', itemIndex, '') as string;
	const bodyRaw = ctx.getNodeParameter('customFieldBody', itemIndex, '') as string;
	const bodyType = ctx.getNodeParameter('customFieldBodyType', itemIndex, 'form') as string;
	const label = ctx.getNodeParameter('customFieldLabel', itemIndex, '') as string;
	const name = ctx.getNodeParameter('customFieldName', itemIndex, '') as string;
	const type = ctx.getNodeParameter('customFieldType', itemIndex, '') as string;
	const optionsParam = ctx.getNodeParameter('customFieldOptions', itemIndex, {}) as {
		values?: Array<{ value?: string }>;
	};
	const isRequired = ctx.getNodeParameter('customFieldRequired', itemIndex, false) as boolean;
	const defaultValue = ctx.getNodeParameter('customFieldDefaultValue', itemIndex, '') as string;
	const updatedAt = ctx.getNodeParameter('customFieldUpdatedAt', itemIndex, '') as string;

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;

	switch (operation) {
		case 'listLeadCustomFields':
			method = 'GET';
			endpoint = '/lead-custom-fields';
			break;
		case 'createLeadCustomField':
			method = 'POST';
			endpoint = '/lead-custom-fields';
			includeBody = true;
			break;
		case 'getLeadCustomField':
			method = 'GET';
			endpoint = `/lead-custom-fields/${customFieldId}`;
			break;
		case 'updateLeadCustomField':
			method = 'PUT';
			endpoint = `/lead-custom-fields/${customFieldId}`;
			includeBody = true;
			break;
		case 'deleteLeadCustomField':
			method = 'DELETE';
			endpoint = `/lead-custom-fields/${customFieldId}`;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	let body;
	if (includeBody) {
		if (bodyType === 'form') {
			const formBody: JsonRecord = {};
			if (label) formBody.label = label;
			if (name) formBody.name = name;
			if (type) {
				const normalizedType = type.trim().toLowerCase().replace(/\s+/g, '_');
				formBody.type = normalizedType;
			}
			if (optionsParam?.values?.length) {
				const options = optionsParam.values
					.map((entry) => (entry?.value ?? '').toString().trim())
					.filter((entry) => entry.length > 0);
				if (options.length) formBody.options = options;
			}
			if (isRequired) {
				formBody.rules = ['required'];
			}
			if (defaultValue) formBody.default_value = defaultValue;
			if (updatedAt) formBody.updated_at = updatedAt;
			body = formBody;
		} else {
			body = parseJson(bodyRaw, 'Body', ctx.getNode(), itemIndex) as JsonRecord;
		}
	}

	const options = buildRequestOptions({
		method,
		endpoint,
		apiConfig,
		body,
	});

	try {
		const response = await executeAdhubRequest(
			ctx.helpers.httpRequest,
			options,
			ctx.getNode(),
			itemIndex,
		);
		return { json: formatAdhubNodeResponse(response) as JsonObject };
	} catch (error) {
		throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject, { itemIndex });
	}
}

export { handleLeadCustomFields };
