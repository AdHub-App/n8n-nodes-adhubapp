import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { LoggerProxy, NodeConnectionTypes } from 'n8n-workflow';

import {
	buildPayloadHash,
	firstNonEmptyString,
	matchesEventType,
	type JsonRecord,
} from './trigger/sharedServices';

const PROVIDER = 'adhubapp';
const EVENT_HEADER_NAME = 'X-AdHub-Event';
const EVENT_ID_HEADER_NAME = 'X-AdHub-Event-ID';
const DELIVERY_ID_HEADER_NAME = 'X-AdHub-Delivery-ID';
const TIMESTAMP_HEADER_NAME = 'X-AdHub-Timestamp';
const SIGNATURE_HEADER_NAME = 'X-AdHub-Signature';

export class AdhubAppTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AdHub App Trigger',
		name: 'adhubAppTrigger',
		group: ['trigger'],
		version: 1,
		subtitle: 'Webhook',
		description: 'Triggers workflows when AdHub sends subscribed webhook events',
		defaults: {
			name: 'AdHub App Trigger',
		},
		icon: 'file:adhubapp.svg',
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'adhubAppApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'events',
			},
		],
		properties: [
			{
				displayName:
					'Due to some limitations, you can use just one AdHub trigger webhook URL for each AdHub integration.',
				name: 'webhookUrlLimitNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Trigger On',
				name: 'eventTypes',
				type: 'multiOptions',
				options: [
					{ name: 'All Events', value: '*' },
					{ name: 'Lead Created', value: 'lead.created' },
					{ name: 'Lead Deleted', value: 'lead.deleted' },
					{ name: 'Lead Events', value: 'lead.*' },
					{ name: 'Lead Updated', value: 'lead.updated' },
					{ name: 'Task Created', value: 'task.created' },
					{ name: 'Task Deleted', value: 'task.deleted' },
					{ name: 'Task Events', value: 'task.*' },
					{ name: 'Task Updated', value: 'task.updated' },
				],
				default: ['lead.created'],
				required: true,
				description: 'Only run the workflow for matching AdHub webhook event types',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headers = this.getHeaderData() as Record<string, string | string[] | undefined>;
		const body = (this.getBodyData() ?? {}) as JsonRecord;
		const event = extractWebhookEvent(body, headers);
		const eventId = event.eventId ?? buildPayloadHash(body);
		const eventType = event.eventType ?? '';
		const selectedEventTypes = this.getNodeParameter('eventTypes') as string[];

		logInfo('webhook_received', {
			workflowId: this.getWorkflow().id ?? 'unknown',
			nodeId: this.getNode().id,
			eventId,
			eventType,
			tenantId: event.tenantId,
			deliveryId: event.deliveryId,
		});

		if (eventType === '') {
			return buildAckResponse('ignored', 'Missing AdHub event type.');
		}

		if (!matchesEventType(eventType, selectedEventTypes)) {
			return buildAckResponse('ignored', 'Event type did not match this trigger configuration.');
		}

		const payload = buildWebhookPayload({
			body,
			eventId,
			eventType,
			timestamp: event.timestamp,
			tenantId: event.tenantId,
			provider: PROVIDER,
			headers: headers as JsonRecord,
		});

		const workflowData: INodeExecutionData[][] = [this.helpers.returnJsonArray(payload)];

		return {
			workflowData,
			webhookResponse: {
				status: 'ok',
				event: eventType,
				event_id: eventId,
			},
			noWebhookResponse: false,
		};
	}
}

type ExtractedEvent = {
	eventId?: string;
	eventType?: string;
	timestamp: string;
	tenantId?: string;
	deliveryId?: string;
};

function extractWebhookEvent(
	body: JsonRecord,
	headers: Record<string, string | string[] | undefined>,
): ExtractedEvent {
	return {
		eventId: firstNonEmptyString([
			getHeaderValue(headers, EVENT_ID_HEADER_NAME),
			pickString(body, ['event_id', 'event.id', 'eventId', 'id']),
		]),
		eventType: firstNonEmptyString([
			getHeaderValue(headers, EVENT_HEADER_NAME),
			pickString(body, ['event', 'event.type', 'event_type', 'eventType', 'type']),
		]),
		timestamp:
			firstNonEmptyString([
				getHeaderValue(headers, TIMESTAMP_HEADER_NAME),
				pickString(body, ['timestamp', 'event.timestamp', 'created_at']),
			]) ?? new Date().toISOString(),
		tenantId: pickString(body, ['tenant_id', 'tenantId', 'account_id', 'accountId']),
		deliveryId: getHeaderValue(headers, DELIVERY_ID_HEADER_NAME),
	};
}

function pickString(body: JsonRecord, paths: string[]): string | undefined {
	return firstNonEmptyString(paths.map((path) => getValueAtPath(body, path)));
}

function getValueAtPath(body: JsonRecord, path: string): string | undefined {
	const value = path.includes('.') ? getNestedValue(body, path) : body[path];
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	return undefined;
}

function getNestedValue(body: JsonRecord, path: string): unknown {
	return path.split('.').reduce<unknown>((current, segment) => {
		if (!current || typeof current !== 'object') return undefined;
		return (current as JsonRecord)[segment];
	}, body);
}

function getHeaderValue(
	headers: Record<string, string | string[] | undefined>,
	headerName: string,
): string | undefined {
	const normalizedHeader = headerName.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== normalizedHeader) continue;
		return Array.isArray(value) ? value[0] : value;
	}

	return undefined;
}

function buildWebhookPayload(input: {
	body: JsonRecord;
	eventId: string;
	eventType: string;
	timestamp: string;
	tenantId?: string;
	provider: string;
	headers: JsonRecord;
}): JsonRecord {
	return {
		event_id: input.eventId,
		event: input.eventType,
		timestamp: input.timestamp,
		changes: (input.body.changes as JsonRecord | undefined) ?? {},
		data: (input.body.data as JsonRecord | undefined) ?? input.body,
		meta: {
			provider: input.provider,
			tenant_id: input.tenantId,
			headers: input.headers,
			signature: getHeaderValue(
				input.headers as Record<string, string | string[] | undefined>,
				SIGNATURE_HEADER_NAME,
			),
		},
		raw: input.body,
	};
}

function buildAckResponse(status: 'ignored', reason: string): IWebhookResponseData {
	return {
		webhookResponse: {
			status,
			reason,
		},
		noWebhookResponse: false,
	};
}

function logInfo(message: string, payload: Record<string, unknown>) {
	LoggerProxy.info(`[AdhubAppTrigger] ${message}`, payload);
}
