import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, parseJson, JsonRecord } from '../helpers';

type LeadStatusOperations =
	| 'listLeadStatuses'
	| 'createLeadStatus'
	| 'getLeadStatus'
	| 'updateLeadStatus'
	| 'deleteLeadStatus';

async function handleLeadStatuses(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadStatusOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const statusId = ctx.getNodeParameter('statusId', itemIndex, '') as string;
	const statusBodyType = ctx.getNodeParameter('statusBodyType', itemIndex, 'form') as string;
	const statusName = ctx.getNodeParameter('statusName', itemIndex, '') as string;
	const statusColor = ctx.getNodeParameter('statusColor', itemIndex, '') as string;
	const statusIsProtected = ctx.getNodeParameter('statusIsProtected', itemIndex, false) as boolean;
	const statusBodyRaw = ctx.getNodeParameter('statusBody', itemIndex, '') as string;

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;

	switch (operation) {
		case 'listLeadStatuses':
			method = 'GET';
			endpoint = '/lead-statuses';
			break;
		case 'createLeadStatus':
			method = 'POST';
			endpoint = '/lead-statuses';
			includeBody = true;
			break;
		case 'getLeadStatus':
			method = 'GET';
			endpoint = `/lead-statuses/${statusId}`;
			break;
		case 'updateLeadStatus':
			method = 'PUT';
			endpoint = `/lead-statuses/${statusId}`;
			includeBody = true;
			break;
		case 'deleteLeadStatus':
			method = 'DELETE';
			endpoint = `/lead-statuses/${statusId}`;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	let body;
	if (includeBody) {
		if (statusBodyType === 'form') {
			const formBody: JsonRecord = { name: statusName };
			if (statusColor) formBody.color = statusColor;
			formBody.is_protected = statusIsProtected;
			body = formBody;
		} else {
			body = parseJson(statusBodyRaw, 'Body');
		}
	}

	const options = buildRequestOptions({
		method,
		endpoint,
		apiConfig,
		body,
	});

	try {
		const response = await ctx.helpers.request(options);
		return { json: response };
	} catch (error) {
		throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject, { itemIndex });
	}
}

export { handleLeadStatuses };
