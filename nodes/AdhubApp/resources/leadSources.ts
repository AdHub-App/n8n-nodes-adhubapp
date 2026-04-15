import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, parseJson } from '../helpers';

type LeadSourceOperations =
	| 'listLeadSources'
	| 'createLeadSource'
	| 'getLeadSource'
	| 'updateLeadSource'
	| 'deleteLeadSource';

async function handleLeadSources(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadSourceOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const sourceId = ctx.getNodeParameter('sourceId', itemIndex, '') as string;
	const bodyRaw = ctx.getNodeParameter('body', itemIndex, '') as string;

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;

	switch (operation) {
		case 'listLeadSources':
			method = 'GET';
			endpoint = '/lead-sources';
			break;
		case 'createLeadSource':
			method = 'POST';
			endpoint = '/lead-sources';
			includeBody = true;
			break;
		case 'getLeadSource':
			method = 'GET';
			endpoint = `/lead-sources/${sourceId}`;
			break;
		case 'updateLeadSource':
			method = 'PUT';
			endpoint = `/lead-sources/${sourceId}`;
			includeBody = true;
			break;
		case 'deleteLeadSource':
			method = 'DELETE';
			endpoint = `/lead-sources/${sourceId}`;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	const options = buildRequestOptions({
		method,
		endpoint,
		apiConfig,
		body: includeBody ? parseJson(bodyRaw, 'Body') : undefined,
	});

	try {
		const response = await ctx.helpers.request(options);
		return { json: response };
	} catch (error) {
		throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject, { itemIndex });
	}
}

export { handleLeadSources };
