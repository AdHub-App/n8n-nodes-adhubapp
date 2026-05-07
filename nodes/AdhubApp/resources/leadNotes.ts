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

type LeadNoteOperations =
	| 'listLeadNotes'
	| 'createLeadNote'
	| 'getLeadNote'
	| 'updateLeadNote'
	| 'deleteLeadNote';

async function handleLeadNotes(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadNoteOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const leadId = ctx.getNodeParameter('leadId', itemIndex, '') as string;
	const noteId = ctx.getNodeParameter('noteId', itemIndex, '') as string;
	const noteBodyRaw = ctx.getNodeParameter('noteBody', itemIndex, '') as string;
	const noteBodyType = ctx.getNodeParameter('noteBodyType', itemIndex, 'form') as string;
	const noteBodyText = ctx.getNodeParameter('noteBodyText', itemIndex, '') as string;
	const noteLimit = ctx.getNodeParameter('noteLimit', itemIndex, 0) as number;

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;
	const qs: JsonRecord = {};

	switch (operation) {
		case 'listLeadNotes':
			method = 'GET';
			endpoint = `/leads/${leadId}/notes`;
			if (noteLimit) qs.limit = noteLimit;
			break;
		case 'createLeadNote':
			method = 'POST';
			endpoint = `/leads/${leadId}/notes`;
			includeBody = true;
			break;
		case 'getLeadNote':
			method = 'GET';
			endpoint = `/leads/${leadId}/notes/${noteId}`;
			break;
		case 'updateLeadNote':
			method = 'PUT';
			endpoint = `/leads/${leadId}/notes/${noteId}`;
			includeBody = true;
			break;
		case 'deleteLeadNote':
			method = 'DELETE';
			endpoint = `/leads/${leadId}/notes/${noteId}`;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	let body;
	if (includeBody) {
		if (noteBodyType === 'form') {
			const formBody: JsonRecord = {};
			if (noteBodyText) formBody.body = noteBodyText;
			body = formBody;
		} else {
			body = parseJson(noteBodyRaw, 'Body', ctx.getNode(), itemIndex) as JsonRecord;
		}
	}

	const options = buildRequestOptions({
		method,
		endpoint,
		apiConfig,
		qs,
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

export { handleLeadNotes };
