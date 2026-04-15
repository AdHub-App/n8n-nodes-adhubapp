import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, JsonRecord } from './helpers';
import { handleLeadSources } from './resources/leadSources';
import { handleLeadStatuses } from './resources/leadStatuses';
import { handleLeads } from './resources/leads';
import { handleLeadActivities } from './resources/leadActivities';
import { handleLeadCustomFields } from './resources/leadCustomFields';
import { handleLeadNotes } from './resources/leadNotes';
import { handleLeadTags } from './resources/leadTags';
import { handleTasks } from './resources/tasks';

type QueryField = {
	key?: string;
	label?: string;
	type?: string;
	operators?: string[];
	options?: Array<{ value?: string; label?: string }>;
};

type LeadSourceOperation = Parameters<typeof handleLeadSources>[2];
type LeadStatusOperation = Parameters<typeof handleLeadStatuses>[2];
type LeadTagOperation = Parameters<typeof handleLeadTags>[2];
type LeadOperation = Parameters<typeof handleLeads>[2];
type LeadActivityOperation = Parameters<typeof handleLeadActivities>[2];
type LeadNoteOperation = Parameters<typeof handleLeadNotes>[2];
type LeadCustomFieldOperation = Parameters<typeof handleLeadCustomFields>[2];
type TaskOperation = Parameters<typeof handleTasks>[2];

async function fetchQueryFields(
	ctx: ILoadOptionsFunctions,
	context: 'lead.list' | 'task.list',
): Promise<QueryField[]> {
	const credentials = await ctx.getCredentials('adhubAppApi');
	const apiConfig: ApiConfig = {
		apiToken: credentials.apiToken as string,
		serverUrl: credentials.serverUrl as string,
		ignoreSslIssues: credentials.ignoreSslIssues as boolean,
	};
	const options = buildRequestOptions({
		method: 'GET',
		endpoint: '/query-builder/fields',
		apiConfig,
		qs: { context } as JsonRecord,
	});
	const response = (await ctx.helpers.request(options)) as unknown;
	const asList = (value: unknown): QueryField[] => {
		if (!Array.isArray(value)) return [];
		return value.flat() as QueryField[];
	};
	if (Array.isArray(response)) {
		return response.flat() as QueryField[];
	}
	if (response && typeof response === 'object') {
		const payload = response as JsonRecord;
		const nestedData = payload.data as JsonRecord | QueryField[] | undefined;
		const candidates = [
			payload.data,
			payload.fields,
			payload.items,
			(nestedData as JsonRecord | undefined)?.data,
			(nestedData as JsonRecord | undefined)?.items,
		];
		for (const candidate of candidates) {
			const list = asList(candidate);
			if (list.length > 0) return list;
		}
	}
	return [];
}

export class AdhubApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Adhub App',
		name: 'adhubApp',
		group: ['output'],
		version: 1,
		subtitle: 'API v1',
		description: 'Manage Adhub leads, activities, sources, statuses, tags, and custom fields',
		defaults: {
			name: 'Adhub App',
		},
		icon: 'file:adhubapp.svg',
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'adhubAppApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{ name: 'Lead', value: 'leads' },
					{ name: 'Lead Activity', value: 'leadActivities' },
					{ name: 'Lead Custom Field', value: 'leadCustomFields' },
					{ name: 'Lead Note', value: 'leadNotes' },
					{ name: 'Lead Source', value: 'leadSources' },
					{ name: 'Lead Status', value: 'leadStatuses' },
					{ name: 'Lead Tag', value: 'leadTags' },
					{ name: 'Task', value: 'tasks' },
				],
				default: 'leadSources',
				required: true,
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadSources'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadSource', action: 'Lead sources create' },
					{ name: 'Delete', value: 'deleteLeadSource', action: 'Lead sources delete' },
					{ name: 'Get', value: 'getLeadSource', action: 'Lead sources get' },
					{ name: 'List', value: 'listLeadSources', action: 'Lead sources list' },
					{ name: 'Update', value: 'updateLeadSource', action: 'Lead sources update' },
				],
				default: 'listLeadSources',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadStatus', action: 'Lead statuses create' },
					{ name: 'Delete', value: 'deleteLeadStatus', action: 'Lead statuses delete' },
					{ name: 'Get', value: 'getLeadStatus', action: 'Lead statuses get' },
					{ name: 'List', value: 'listLeadStatuses', action: 'Lead statuses list' },
					{ name: 'Update', value: 'updateLeadStatus', action: 'Lead statuses update' },
				],
				default: 'listLeadStatuses',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadTags'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadTag', action: 'Lead tags create' },
					{ name: 'Delete', value: 'deleteLeadTag', action: 'Lead tags delete' },
					{ name: 'Get', value: 'getLeadTag', action: 'Lead tags get' },
					{ name: 'List', value: 'listLeadTags', action: 'Lead tags list' },
					{ name: 'Update', value: 'updateLeadTag', action: 'Lead tags update' },
				],
				default: 'listLeadTags',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leads'],
					},
				},
				options: [
					{ name: 'Bulk Create', value: 'bulkCreateLeads', action: 'Leads bulk create' },
					{ name: 'Bulk Delete', value: 'bulkDeleteLeads', action: 'Leads bulk delete' },
					{ name: 'Bulk Sync Tags', value: 'bulkSyncLeadTags', action: 'Leads bulk sync tags' },
					{
						name: 'Bulk Update Custom Fields',
						value: 'bulkUpdateLeadCustomFields',
						action: 'Leads bulk update custom fields',
					},
					{
						name: 'Bulk Update Fields',
						value: 'bulkUpdateLeadFields',
						action: 'Leads bulk update fields',
					},
					{ name: 'Create', value: 'createLead', action: 'Leads create' },
					{ name: 'Delete', value: 'deleteLead', action: 'Leads delete' },
					{ name: 'Entries', value: 'listLeadEntries', action: 'Leads entries' },
					{ name: 'Get', value: 'getLead', action: 'Leads get' },
					{ name: 'List', value: 'listLeads', action: 'Leads list' },
					{
						name: 'List Query Fields',
						value: 'listLeadQueryFields',
						action: 'Leads list query fields',
					},
					{ name: 'Timeline', value: 'getLeadTimeline', action: 'Leads timeline' },
					{ name: 'Update', value: 'updateLead', action: 'Leads update' },
				],
				default: 'listLeads',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadActivities'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadActivity', action: 'Lead activities create' },
					{ name: 'Delete', value: 'deleteLeadActivity', action: 'Lead activities delete' },
					{ name: 'Get', value: 'getLeadActivity', action: 'Lead activities get' },
					{ name: 'List', value: 'listLeadActivities', action: 'Lead activities list' },
					{
						name: 'List Types',
						value: 'listLeadActivityTypes',
						action: 'Lead activity types list',
					},
					{ name: 'Update', value: 'updateLeadActivity', action: 'Lead activities update' },
				],
				default: 'listLeadActivities',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadNotes'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadNote', action: 'Lead notes create' },
					{ name: 'Delete', value: 'deleteLeadNote', action: 'Lead notes delete' },
					{ name: 'Get', value: 'getLeadNote', action: 'Lead notes get' },
					{ name: 'List', value: 'listLeadNotes', action: 'Lead notes list' },
					{ name: 'Update', value: 'updateLeadNote', action: 'Lead notes update' },
				],
				default: 'listLeadNotes',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
					},
				},
				options: [
					{ name: 'Create', value: 'createLeadCustomField', action: 'Lead custom fields create' },
					{ name: 'Delete', value: 'deleteLeadCustomField', action: 'Lead custom fields delete' },
					{ name: 'Get', value: 'getLeadCustomField', action: 'Lead custom fields get' },
					{ name: 'List', value: 'listLeadCustomFields', action: 'Lead custom fields list' },
					{ name: 'Update', value: 'updateLeadCustomField', action: 'Lead custom fields update' },
				],
				default: 'listLeadCustomFields',
				noDataExpression: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['tasks'],
					},
				},
				options: [
					{ name: 'Bulk Complete', value: 'bulkCompleteTasks', action: 'Tasks bulk complete' },
					{ name: 'Bulk Delete', value: 'bulkDeleteTasks', action: 'Tasks bulk delete' },
					{ name: 'Complete', value: 'completeTask', action: 'Tasks complete' },
					{ name: 'Create', value: 'createTask', action: 'Tasks create' },
					{ name: 'Delete', value: 'deleteTask', action: 'Tasks delete' },
					{ name: 'Get', value: 'getTask', action: 'Tasks get' },
					{ name: 'List', value: 'listTasks', action: 'Tasks list' },
					{ name: 'Update', value: 'updateTask', action: 'Tasks update' },
				],
				default: 'listTasks',
				noDataExpression: true,
			},
			{
				displayName: 'Source ID',
				name: 'sourceId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadSources'],
						operation: ['getLeadSource', 'updateLeadSource', 'deleteLeadSource'],
					},
				},
				description: 'Lead source identifier',
			},
			{
				displayName: 'Status ID',
				name: 'statusId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['getLeadStatus', 'updateLeadStatus', 'deleteLeadStatus'],
					},
				},
				description: 'Lead status identifier',
			},
			{
				displayName: 'Tag ID',
				name: 'tagId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['getLeadTag', 'updateLeadTag', 'deleteLeadTag'],
					},
				},
				description: 'Lead tag identifier',
			},
			{
				displayName: 'Lead ID',
				name: 'leadId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leads', 'leadActivities'],
						operation: [
							'getLead',
							'updateLead',
							'deleteLead',
							'getLeadTimeline',
							'listLeadEntries',
							'listLeadActivities',
							'createLeadActivity',
							'getLeadActivity',
							'updateLeadActivity',
							'deleteLeadActivity',
							'listLeadNotes',
							'createLeadNote',
							'getLeadNote',
							'updateLeadNote',
							'deleteLeadNote',
						],
					},
				},
				description: 'Lead identifier',
			},
			{
				displayName: 'Activity ID',
				name: 'activityId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['getLeadActivity', 'updateLeadActivity', 'deleteLeadActivity'],
					},
				},
				description: 'Lead activity identifier',
			},
			{
				displayName: 'Note ID',
				name: 'noteId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadNotes'],
						operation: ['getLeadNote', 'updateLeadNote', 'deleteLeadNote'],
					},
				},
				description: 'Lead note identifier',
			},
			{
				displayName: 'Custom Field ID',
				name: 'customFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['getLeadCustomField', 'updateLeadCustomField', 'deleteLeadCustomField'],
					},
				},
				description: 'Lead custom field identifier',
			},
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['getTask', 'updateTask', 'deleteTask', 'completeTask'],
					},
				},
				description: 'Task identifier',
			},
			{
				displayName: 'Limit',
				name: 'activityLimit',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 100,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['listLeadActivities'],
					},
				},
				description: 'Maximum number of activities to return (1-100). Set 0 to omit.',
			},
			{
				displayName: 'Limit',
				name: 'noteLimit',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 100,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leadNotes'],
						operation: ['listLeadNotes'],
					},
				},
				description: 'Maximum number of notes to return (1-100). Set 0 to omit.',
			},
			{
				displayName: 'Limit',
				name: 'leadTimelineLimit',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 100,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['getLeadTimeline'],
					},
				},
				description: 'Maximum number of timeline items to return (1-100). Set 0 to omit.',
			},
			{
				displayName: 'Limit',
				name: 'leadEntriesLimit',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 100,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeadEntries'],
					},
				},
				description: 'Maximum number of entries to return (1-100). Set 0 to omit.',
			},
			{
				displayName: 'Context',
				name: 'queryContext',
				type: 'options',
				options: [
					{ name: 'Lead Assignment', value: 'lead.assignment' },
					{ name: 'Lead List', value: 'lead.list' },
					{ name: 'Task List', value: 'task.list' },
				],
				default: 'lead.list',
				required: true,
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeadQueryFields'],
					},
				},
				description: 'Context key for query builder fields',
			},
			{
				displayName: 'Body Type',
				name: 'leadBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'body',
				type: 'string',
				default: '',
				placeholder: '{"name":"Example"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadSources'],
						operation: ['createLeadSource', 'updateLeadSource'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'leadListBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'json',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'body',
				type: 'string',
				default: '',
				placeholder:
					'{"per_page":50,"page":2,"search":"john","filter":{"mode":"and","rules":[{"field":"lead.status","operator":"Equals To","value":"New"}]}}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Per Page',
				name: 'leadListPerPage',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 200,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Number of leads per page. Set 0 to omit.',
			},
			{
				displayName: 'Page',
				name: 'leadListPage',
				type: 'number',
				typeOptions: {
					minValue: 0,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Page number. Set 0 to omit.',
			},
			{
				displayName: 'Search',
				name: 'leadListSearch',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Search term to filter leads',
			},
			{
				displayName: 'Filter Mode',
				name: 'leadListFilterMode',
				type: 'options',
				options: [
					{ name: 'AND', value: 'and' },
					{ name: 'OR', value: 'or' },
				],
				default: 'and',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'How filter rules are combined',
			},
			{
				displayName: 'Filter Rules',
				name: 'leadListFilterRules',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add filter rule',
				options: [
					{
						name: 'values',
						displayName: 'Rule',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadFilterFields',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Operator Name or ID',
								name: 'operator',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadFilterOperators',
									loadOptionsDependsOn: ['field'],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value (Date)',
								name: 'valueDate',
								type: 'dateTime',
								default: '',
							},
							{
								displayName: 'Value (Select) Name or ID',
								name: 'valueSelect',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadFilterFieldOptions',
									loadOptionsDependsOn: ['field'],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value (Text)',
								name: 'valueText',
								type: 'string',
								default: '',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Filter rules for the list query',
			},
			{
				displayName: 'Bulk Create Body (JSON)',
				name: 'bulkCreateBody',
				type: 'string',
				default: '',
				placeholder:
					'{"leads":[{"first_name":"Jane","last_name":"Doe","email":"jane.doe@example.com","mobile_number":null,"status_id":"550e8400-e29b-41d4-a716-446655440000","source_id":null,"owner_id":null,"tag_ids":[]},{"first_name":"John","last_name":"Smith","email":null,"mobile_number":"+12025551234","status_id":"550e8400-e29b-41d4-a716-446655440000","source_id":null,"owner_id":null,"tag_ids":[]}]}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkCreateLeads'],
					},
				},
			},
			{
				displayName: 'Bulk Delete Body (JSON)',
				name: 'bulkDeleteBody',
				type: 'string',
				default: '',
				placeholder: '{"lead_ids":["0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f10"],"filter":[]}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads'],
					},
				},
			},
			{
				displayName: 'Bulk Update Fields Body (JSON)',
				name: 'bulkUpdateFieldsBody',
				type: 'string',
				default: '',
				placeholder:
					'{"lead_ids":["0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f10"],"filter":{"mode":"and","rules":[{"field":"email","operator":"Contains","value":"@example.com"},{"field":"status","operator":"Equals To","value":"New"}]},"status_id":1,"source_id":2,"owner_id":3}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadFields'],
					},
				},
			},
			{
				displayName: 'Bulk Sync Tags Body (JSON)',
				name: 'bulkSyncTagsBody',
				type: 'string',
				default: '',
				placeholder:
					'{"lead_ids":["0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f10"],"filter":[],"add_tag_ids":[1,2],"remove_tag_ids":[3]}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkSyncLeadTags'],
					},
				},
			},
			{
				displayName: 'Bulk Update Custom Fields Body (JSON)',
				name: 'bulkUpdateCustomFieldsBody',
				type: 'string',
				default: '',
				placeholder:
					'{"lead_ids":["0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f10"],"filter":[],"company":"n","job_title":"g","service_interest":"Content Marketing","monthly_budget":"$5k+","timeline":"This quarter","internal_notes":"z"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadCustomFields'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'body',
				type: 'string',
				default: '',
				placeholder: '{"first_name":"Jane"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'activityBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['createLeadActivity', 'updateLeadActivity'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'noteBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leadNotes'],
						operation: ['createLeadNote', 'updateLeadNote'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'activityBody',
				type: 'string',
				default: '',
				placeholder: '{"type":"call","body":"Follow-up","occurred_at":"2026-03-16T10:15:30+05:00"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['createLeadActivity', 'updateLeadActivity'],
						activityBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'noteBody',
				type: 'string',
				default: '',
				placeholder: '{"body":"Called the lead, left a voicemail."}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadNotes'],
						operation: ['createLeadNote', 'updateLeadNote'],
						noteBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Type',
				name: 'activityType',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['createLeadActivity', 'updateLeadActivity'],
						activityBodyType: ['form'],
					},
				},
				description: 'Activity type key like call, meeting, email',
			},
			{
				displayName: 'Body',
				name: 'activityBodyText',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['createLeadActivity', 'updateLeadActivity'],
						activityBodyType: ['form'],
					},
				},
				description: 'Activity details or notes',
			},
			{
				displayName: 'Body',
				name: 'noteBodyText',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadNotes'],
						operation: ['createLeadNote', 'updateLeadNote'],
						noteBodyType: ['form'],
					},
				},
				description: 'Note text',
			},
			{
				displayName: 'Occurred At',
				name: 'activityOccurredAt',
				type: 'string',
				default: '',
				placeholder: '2026-03-16T10:15:30+05:00',
				displayOptions: {
					show: {
						resource: ['leadActivities'],
						operation: ['createLeadActivity', 'updateLeadActivity'],
						activityBodyType: ['form'],
					},
				},
				description: 'ISO 8601 timestamp with timezone',
			},
			{
				displayName: 'Body Type',
				name: 'statusBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['createLeadStatus', 'updateLeadStatus'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'tagBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['createLeadTag', 'updateLeadTag'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'statusBody',
				type: 'string',
				default: '',
				placeholder: '{"name":"Example"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['createLeadStatus', 'updateLeadStatus'],
						statusBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'tagBody',
				type: 'string',
				default: '',
				placeholder: '{"name":"VIP","order":39,"color":"#f97316"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['createLeadTag', 'updateLeadTag'],
						tagBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'customFieldBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField', 'deleteLeadCustomField'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'customFieldBody',
				type: 'string',
				default: '',
				placeholder:
					'{"label":"Industry","name":"industry","type":"select","options":["Retail"],"rules":["required"],"default_value":"Retail","key":"industry"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField', 'deleteLeadCustomField'],
						customFieldBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Label',
				name: 'customFieldLabel',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Name',
				name: 'customFieldName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Type',
				name: 'customFieldType',
				type: 'options',
				options: [
					{ name: 'Checkbox', value: 'checkbox' },
					{ name: 'Date', value: 'date' },
					{ name: 'Email', value: 'email' },
					{ name: 'Multi Select', value: 'multi_select' },
					{ name: 'Phone', value: 'phone' },
					{ name: 'Radio', value: 'radio' },
					{ name: 'Select', value: 'select' },
					{ name: 'Text Input', value: 'text_input' },
					{ name: 'Textarea', value: 'textarea' },
				],
				default: 'text_input',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
				description: 'Field type',
			},
			{
				displayName: 'Options',
				name: 'customFieldOptions',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add option values',
				options: [
					{
						name: 'values',
						displayName: 'Option',
						values: [
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
						customFieldType: ['select', 'multi_select', 'checkbox', 'radio'],
					},
				},
				description: 'Option values for select, multi select, radio, or checkbox fields',
			},
			{
				displayName: 'Required',
				name: 'customFieldRequired',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
				description: 'Whether to mark this custom field as required',
			},
			{
				displayName: 'Default Value',
				name: 'customFieldDefaultValue',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Key',
				name: 'customFieldKey',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['createLeadCustomField', 'updateLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
				description: 'Unique key for the custom field',
			},
			{
				displayName: 'Updated At',
				name: 'customFieldUpdatedAt',
				type: 'string',
				default: '',
				required: true,
				placeholder: '2026-03-16T10:15:30+00:00',
				displayOptions: {
					show: {
						resource: ['leadCustomFields'],
						operation: ['updateLeadCustomField', 'deleteLeadCustomField'],
						customFieldBodyType: ['form'],
					},
				},
				description: 'ISO 8601 timestamp with timezone',
			},
			{
				displayName: 'First Name',
				name: 'leadFirstName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Last Name',
				name: 'leadLastName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Email',
				name: 'leadEmail',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Mobile Number',
				name: 'leadMobileNumber',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Status ID',
				name: 'leadStatusId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Source ID',
				name: 'leadSourceId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Owner ID',
				name: 'leadOwnerId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Tag IDs',
				name: 'leadTagIds',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add tag ID',
				options: [
					{
						name: 'values',
						displayName: 'Tag',
						values: [
							{
								displayName: 'Tag ID',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
				description: 'Tags to assign to the lead',
			},
			{
				displayName: 'Company',
				name: 'leadCompany',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Job Title',
				name: 'leadJobTitle',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Service Interest',
				name: 'leadServiceInterest',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Monthly Budget',
				name: 'leadMonthlyBudget',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Timeline',
				name: 'leadTimeline',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Internal Notes',
				name: 'leadInternalNotes',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Updated At',
				name: 'leadUpdatedAt',
				type: 'string',
				default: '',
				placeholder: '2026-03-18T00:30:24+00:00',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['updateLead'],
						leadBodyType: ['form'],
					},
				},
				description: 'ISO 8601 timestamp with timezone',
			},
			{
				displayName: 'Include Empty Fields',
				name: 'leadIncludeEmpty',
				type: 'boolean',
				default: true,
				description: 'Whether to send empty strings for blank fields instead of omitting them',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Additional Fields (JSON)',
				name: 'leadAdditionalFields',
				type: 'string',
				default: '',
				placeholder: '{"company":"Acme","job_title":"Owner"}',
				description: 'Optional extra fields as a JSON object',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Name',
				name: 'statusName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['createLeadStatus', 'updateLeadStatus'],
						statusBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Name',
				name: 'tagName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['createLeadTag', 'updateLeadTag'],
						tagBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Order',
				name: 'tagOrder',
				type: 'number',
				default: 0,
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['createLeadTag', 'updateLeadTag'],
						tagBodyType: ['form'],
					},
				},
				description: 'Display order. Set 0 to omit.',
			},
			{
				displayName: 'Color',
				name: 'tagColor',
				type: 'color',
				default: '',
				placeholder: '#f97316',
				displayOptions: {
					show: {
						resource: ['leadTags'],
						operation: ['createLeadTag', 'updateLeadTag'],
						tagBodyType: ['form'],
					},
				},
				description: 'Hex color like #f97316',
			},
			{
				displayName: 'Color',
				name: 'statusColor',
				type: 'color',
				default: '',
				placeholder: '#22c55e',
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['createLeadStatus', 'updateLeadStatus'],
						statusBodyType: ['form'],
					},
				},
				description: 'Hex color like #22c55e',
			},
			{
				displayName: 'Is Protected',
				name: 'statusIsProtected',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['leadStatuses'],
						operation: ['createLeadStatus', 'updateLeadStatus'],
						statusBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Body Type',
				name: 'taskBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'taskBody',
				type: 'string',
				default: '',
				placeholder:
					'{"lead_id":"abc123","title":"Follow up","type":"email","due_date":"2026-03-25T09:18:49","due_time":"09:18","notes":"Call notes"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Lead ID',
				name: 'taskLeadId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Lead identifier for the task',
			},
			{
				displayName: 'Title',
				name: 'taskTitle',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Task title',
			},
			{
				displayName: 'Type',
				name: 'taskType',
				type: 'options',
				options: [
					{ name: 'Call', value: 'call' },
					{ name: 'Email', value: 'email' },
					{ name: 'Meeting', value: 'meeting' },
					{ name: 'Other', value: 'other' },
				],
				default: 'other',
				required: true,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Task type',
			},
			{
				displayName: 'Due Date',
				name: 'taskDueDate',
				type: 'string',
				default: '',
				placeholder: '2026-03-25T09:18:49',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Due date in ISO 8601 format',
			},
			{
				displayName: 'Due Time',
				name: 'taskDueTime',
				type: 'string',
				default: '',
				placeholder: '09:18',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Due time in HH:mm format',
			},
			{
				displayName: 'Notes',
				name: 'taskNotes',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Task notes',
			},
			{
				displayName: 'Version',
				name: 'taskVersion',
				type: 'number',
				default: 0,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['updateTask', 'completeTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Task version for optimistic locking',
			},
			{
				displayName: 'Task IDs',
				name: 'taskIds',
				type: 'string',
				default: '',
				placeholder: 'task1,task2,task3',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['bulkCompleteTasks', 'bulkDeleteTasks'],
					},
				},
				description: 'Comma-separated list of task IDs',
			},
			{
				displayName: 'Body Type',
				name: 'taskListBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'json',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'taskListBody',
				type: 'string',
				default: '',
				placeholder:
					'{"per_page":50,"page":1,"search":"follow","status":"scheduled","sort_by":"due_date","sort_dir":"asc"}',
				description: 'Request body as a JSON object',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['json'],
					},
				},
			},
			{
				displayName: 'Per Page',
				name: 'taskListPerPage',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 200,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Number of tasks per page. Set 0 to omit.',
			},
			{
				displayName: 'Page',
				name: 'taskListPage',
				type: 'number',
				typeOptions: {
					minValue: 0,
				},
				default: 0,
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Page number. Set 0 to omit.',
			},
			{
				displayName: 'Search',
				name: 'taskListSearch',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Search term',
			},
			{
				displayName: 'Status',
				name: 'taskListStatus',
				type: 'options',
				options: [
					{ name: 'Completed', value: 'completed' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'scheduled',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Filter Mode',
				name: 'taskListFilterMode',
				type: 'options',
				options: [
					{ name: 'AND', value: 'and' },
					{ name: 'OR', value: 'or' },
				],
				default: 'and',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'How filter rules are combined',
			},
			{
				displayName: 'Filter Rules',
				name: 'taskListFilterRules',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add filter rule',
				options: [
					{
						name: 'values',
						displayName: 'Rule',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getTaskFilterFields',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Operator Name or ID',
								name: 'operator',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getTaskFilterOperators',
									loadOptionsDependsOn: ['field'],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value (Date)',
								name: 'valueDate',
								type: 'dateTime',
								default: '',
							},
							{
								displayName: 'Value (Select) Name or ID',
								name: 'valueSelect',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getTaskFilterFieldOptions',
									loadOptionsDependsOn: ['field'],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value (Text)',
								name: 'valueText',
								type: 'string',
								default: '',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Filter rules for the list query',
			},
		],
	};

	methods = {
		loadOptions: {
			async getLeadFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await fetchQueryFields(this, 'lead.list');
				return fields
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getTaskFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await fetchQueryFields(this, 'task.list');
				return fields
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadFilterOperators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const current = this.getCurrentNodeParameters() as JsonRecord | undefined;
				const fieldKey = (this.getCurrentNodeParameter('field') ?? current?.field ?? '') as string;
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await fetchQueryFields(this, 'lead.list');
				const normalized = fieldKey.toString().trim().toLowerCase();
				const match =
					fields.find((field) => field.key === fieldKey) ??
					fields.find(
						(field) => (field.label ?? '').toString().trim().toLowerCase() === normalized,
					);
				const operators = (match?.operators ?? []).map((op) => ({ name: op, value: op }));
				return [emptyOption, ...operators];
			},
			async getTaskFilterOperators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const current = this.getCurrentNodeParameters() as JsonRecord | undefined;
				const fieldKey = (this.getCurrentNodeParameter('field') ?? current?.field ?? '') as string;
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await fetchQueryFields(this, 'task.list');
				const normalized = fieldKey.toString().trim().toLowerCase();
				const match =
					fields.find((field) => field.key === fieldKey) ??
					fields.find(
						(field) => (field.label ?? '').toString().trim().toLowerCase() === normalized,
					);
				const operators = (match?.operators ?? []).map((op) => ({ name: op, value: op }));
				return [emptyOption, ...operators];
			},
			async getLeadFilterFieldOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const current = this.getCurrentNodeParameters() as JsonRecord | undefined;
				const fieldKey = (this.getCurrentNodeParameter('field') ?? current?.field ?? '') as string;
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await fetchQueryFields(this, 'lead.list');
				const normalized = fieldKey.toString().trim().toLowerCase();
				const match =
					fields.find((field) => field.key === fieldKey) ??
					fields.find(
						(field) => (field.label ?? '').toString().trim().toLowerCase() === normalized,
					);
				const options = (match?.options ?? []).map((opt) => ({
					name: opt.label ?? opt.value ?? '',
					value: opt.value ?? '',
				}));
				return [emptyOption, ...options];
			},
			async getTaskFilterFieldOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const current = this.getCurrentNodeParameters() as JsonRecord | undefined;
				const fieldKey = (this.getCurrentNodeParameter('field') ?? current?.field ?? '') as string;
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await fetchQueryFields(this, 'task.list');
				const normalized = fieldKey.toString().trim().toLowerCase();
				const match =
					fields.find((field) => field.key === fieldKey) ??
					fields.find(
						(field) => (field.label ?? '').toString().trim().toLowerCase() === normalized,
					);
				const options = (match?.options ?? []).map((opt) => ({
					name: opt.label ?? opt.value ?? '',
					value: opt.value ?? '',
				}));
				return [emptyOption, ...options];
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const resource = this.getNodeParameter('resource', itemIndex) as string;
			const operation = this.getNodeParameter('operation', itemIndex) as string;

			const credentials = await this.getCredentials('adhubAppApi', itemIndex);
			const apiConfig: ApiConfig = {
				apiToken: credentials.apiToken as string,
				serverUrl: credentials.serverUrl as string,
				ignoreSslIssues: credentials.ignoreSslIssues as boolean,
			};

			try {
				switch (resource) {
					case 'leadSources':
						returnData.push(
							await handleLeadSources(this, itemIndex, operation as LeadSourceOperation, apiConfig),
						);
						break;
					case 'leadStatuses':
						returnData.push(
							await handleLeadStatuses(
								this,
								itemIndex,
								operation as LeadStatusOperation,
								apiConfig,
							),
						);
						break;
					case 'leadTags':
						returnData.push(
							await handleLeadTags(this, itemIndex, operation as LeadTagOperation, apiConfig),
						);
						break;
					case 'leads':
						returnData.push(
							await handleLeads(this, itemIndex, operation as LeadOperation, apiConfig),
						);
						break;
					case 'leadActivities':
						returnData.push(
							await handleLeadActivities(
								this,
								itemIndex,
								operation as LeadActivityOperation,
								apiConfig,
							),
						);
						break;
					case 'leadNotes':
						returnData.push(
							await handleLeadNotes(this, itemIndex, operation as LeadNoteOperation, apiConfig),
						);
						break;
					case 'leadCustomFields':
						returnData.push(
							await handleLeadCustomFields(
								this,
								itemIndex,
								operation as LeadCustomFieldOperation,
								apiConfig,
							),
						);
						break;
					case 'tasks':
						returnData.push(
							await handleTasks(this, itemIndex, operation as TaskOperation, apiConfig),
						);
						break;
					default:
						throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
