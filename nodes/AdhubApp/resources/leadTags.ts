import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, parseJson, JsonRecord } from '../helpers';

type LeadTagOperations =
	| 'listLeadTags'
	| 'createLeadTag'
	| 'getLeadTag'
	| 'updateLeadTag'
	| 'deleteLeadTag';

async function handleLeadTags(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadTagOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const tagId = ctx.getNodeParameter('tagId', itemIndex, '') as string;
	const bodyType = ctx.getNodeParameter('tagBodyType', itemIndex, 'form') as string;
	const tagName = ctx.getNodeParameter('tagName', itemIndex, '') as string;
	const tagOrder = ctx.getNodeParameter('tagOrder', itemIndex, 0) as number;
	const tagColor = ctx.getNodeParameter('tagColor', itemIndex, '') as string;
	const bodyRaw = ctx.getNodeParameter('tagBody', itemIndex, '') as string;

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;

	switch (operation) {
		case 'listLeadTags':
			method = 'GET';
			endpoint = '/lead-tags';
			break;
		case 'createLeadTag':
			method = 'POST';
			endpoint = '/lead-tags';
			includeBody = true;
			break;
		case 'getLeadTag':
			method = 'GET';
			endpoint = `/lead-tags/${tagId}`;
			break;
		case 'updateLeadTag':
			method = 'PUT';
			endpoint = `/lead-tags/${tagId}`;
			includeBody = true;
			break;
		case 'deleteLeadTag':
			method = 'DELETE';
			endpoint = `/lead-tags/${tagId}`;
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
			if (tagName) formBody.name = tagName;
			if (tagOrder !== 0 && !Number.isNaN(tagOrder)) formBody.order = tagOrder;
			if (tagColor) formBody.color = tagColor;
			body = formBody;
		} else {
			body = parseJson(bodyRaw, 'Body');
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

export { handleLeadTags };
