import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	type AdhubAppCredentials,
	buildRequestOptions,
	fetchQueryFields,
} from './helpers';
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
type LeadFilterCategory = 'general' | 'leads' | 'leadCustomFields' | 'tasks';
const VALUE_LESS_FILTER_OPERATORS = [
	'Is Empty',
	'Is Not Empty',
	'Today',
	'Yesterday',
	'This Week',
	'Last Week',
	'This Month',
	'Last Month',
	'This Year',
];
function readCurrentStringParam(
	ctx: ILoadOptionsFunctions,
	parameterName: string,
): string {
	const extractString = (value: unknown): string => {
		if (typeof value === 'string') {
			return value.trim();
		}
		if (!value || typeof value !== 'object') {
			return '';
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				const match = extractString(entry);
				if (match) return match;
			}
			return '';
		}
		const record = value as Record<string, unknown>;
		const directCandidates = [record.value, record.name, record.label];
		for (const candidate of directCandidates) {
			const match = extractString(candidate);
			if (match) return match;
		}
		return '';
	};
	const candidates = [
		parameterName,
		`values.${parameterName}`,
		`filter.${parameterName}`,
		`filter.values.${parameterName}`,
		`leadListFilterRules.values.${parameterName}`,
		`bulkLeadFilterRules.values.${parameterName}`,
		`taskListFilterRules.values.${parameterName}`,
	];
	for (const candidate of candidates) {
		try {
			const value = ctx.getCurrentNodeParameter(candidate);
			const match = extractString(value);
			if (match) return match;
		} catch {
			// Ignore lookup misses and continue with the next candidate.
		}
	}
	const searchNested = (value: unknown, depth = 0): string => {
		if (depth > 6) return '';
		const direct = extractString(value);
		if (direct) return direct;
		if (!value || typeof value !== 'object') {
			return '';
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				const match = searchNested(entry, depth + 1);
				if (match) return match;
			}
			return '';
		}
		const record = value as Record<string, unknown>;
		const parameterValue = record[parameterName];
		const parameterMatch = extractString(parameterValue);
		if (parameterMatch) {
			return parameterMatch;
		}
		for (const entry of Object.values(record)) {
			const match = searchNested(entry, depth + 1);
			if (match) return match;
		}
		return '';
	};
	return searchNested(ctx.getCurrentNodeParameters());
}
function getLeadFilterCategory(ctx: ILoadOptionsFunctions): LeadFilterCategory {
	const rawCategory = (
		readCurrentStringParam(ctx, 'category')
	).toLowerCase();
	switch (rawCategory) {
		case 'general':
		case 'leads':
		case 'leadcustomfields':
		case 'tasks':
			return rawCategory === 'leadcustomfields' ? 'leadCustomFields' : (rawCategory as LeadFilterCategory);
		default:
			return 'leads';
	}
}
function readLeadRuleFieldKey(ctx: ILoadOptionsFunctions): string {
	const candidateKeys = [
		readCurrentStringParam(ctx, 'fieldGeneral'),
		readCurrentStringParam(ctx, 'fieldLeads'),
		readCurrentStringParam(ctx, 'fieldLeadCustomFields'),
		readCurrentStringParam(ctx, 'fieldTasks'),
		readFixedCollectionRuleParam(ctx, 'leadListFilterRules', 'fieldGeneral'),
		readFixedCollectionRuleParam(ctx, 'leadListFilterRules', 'fieldLeads'),
		readFixedCollectionRuleParam(ctx, 'leadListFilterRules', 'fieldLeadCustomFields'),
		readFixedCollectionRuleParam(ctx, 'leadListFilterRules', 'fieldTasks'),
		readFixedCollectionRuleParam(ctx, 'leadListFilterRules', 'field'),
		readFixedCollectionRuleParam(ctx, 'bulkLeadFilterRules', 'fieldGeneral'),
		readFixedCollectionRuleParam(ctx, 'bulkLeadFilterRules', 'fieldLeads'),
		readFixedCollectionRuleParam(ctx, 'bulkLeadFilterRules', 'fieldLeadCustomFields'),
		readFixedCollectionRuleParam(ctx, 'bulkLeadFilterRules', 'fieldTasks'),
		readFixedCollectionRuleParam(ctx, 'bulkLeadFilterRules', 'field'),
		readCurrentStringParam(ctx, 'field'),
	].filter((key) => key.length > 0);
	return candidateKeys[0] ?? '';
}
function isTaskFieldKey(fieldKey: string): boolean {
	const key = fieldKey.trim().toLowerCase();
	return key.startsWith('task');
}
function isLeadCustomFieldKey(fieldKey: string): boolean {
	const key = fieldKey.trim().toLowerCase();
	return key.startsWith('cf_');
}
function isGeneralLeadFieldKey(fieldKey: string): boolean {
	const key = fieldKey.trim().toLowerCase();
	return key === 'lead.tag' || key === 'lead.segment';
}
function filterLeadFieldsByCategory(
	fields: QueryField[],
	category: LeadFilterCategory,
): QueryField[] {
	return fields.filter((field) => {
		const key = (field.key ?? '').toString().trim();
		if (!key) return false;
		switch (category) {
			case 'general':
				return isGeneralLeadFieldKey(key);
			case 'leadCustomFields':
				return isLeadCustomFieldKey(key);
			case 'tasks':
				return isTaskFieldKey(key);
			case 'leads':
			default:
				return !isGeneralLeadFieldKey(key) && !isLeadCustomFieldKey(key) && !isTaskFieldKey(key);
		}
	});
}
function getAvailableLeadFilterCategories(fields: QueryField[]): LeadFilterCategory[] {
	const categories: LeadFilterCategory[] = ['general', 'leads', 'leadCustomFields', 'tasks'];
	return categories.filter((category) => filterLeadFieldsByCategory(fields, category).length > 0);
}
function findQueryField(fields: QueryField[], fieldKey: string): QueryField | undefined {
	const normalized = fieldKey.toString().trim().toLowerCase();
	return (
		fields.find((field) => field.key === fieldKey) ??
		fields.find((field) => (field.key ?? '').toString().trim().toLowerCase() === normalized) ??
		fields.find((field) => (field.label ?? '').toString().trim().toLowerCase() === normalized)
	);
}
function mapOptions(values: string[]): INodePropertyOptions[] {
	return values.map((value) => ({ name: value, value }));
}
function mapFieldValueOptions(field?: QueryField): INodePropertyOptions[] {
	const options = Array.isArray(field?.options) ? field.options : [];
	return options
		.filter((option) => (option.value ?? '').toString().trim().length > 0)
		.map((option) => ({
			name: option.label ?? option.value ?? '',
			value: option.value ?? '',
		}));
}
function mapScopedOperatorOptions(fields: QueryField[]): INodePropertyOptions[] {
	const operators = new Set<string>();
	for (const field of fields) {
		for (const operator of field.operators ?? []) {
			const operatorName = operator.toString().trim();
			if (!operatorName) continue;
			operators.add(operatorName);
		}
	}
	return Array.from(operators).map((operator) => ({ name: operator, value: operator }));
}
function mapScopedFieldValueOptions(fields: QueryField[]): INodePropertyOptions[] {
	const options = new Map<string, INodePropertyOptions>();
	for (const field of fields) {
		for (const option of field.options ?? []) {
			const value = (option.value ?? '').toString().trim();
			if (!value) continue;
			options.set(value, {
				name: option.label ?? option.value ?? '',
				value,
			});
		}
	}
	return Array.from(options.values());
}
function readFixedCollectionRuleParam(
	ctx: ILoadOptionsFunctions,
	collectionName: string,
	paramName: string,
): string {
	const nodeParams = ctx.getCurrentNodeParameters() as Record<string, unknown>;
	const collection = nodeParams[collectionName] as { values?: Array<Record<string, unknown>> } | undefined;
	const values = Array.isArray(collection?.values) ? collection.values : [];
	for (let i = values.length - 1; i >= 0; i--) {
		const rawValue = values[i]?.[paramName];
		if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
			return rawValue.trim();
		}
	}
	return '';
}
type LeadSourceOperation = Parameters<typeof handleLeadSources>[2];
type LeadStatusOperation = Parameters<typeof handleLeadStatuses>[2];
type LeadTagOperation = Parameters<typeof handleLeadTags>[2];
type LeadOperation = Parameters<typeof handleLeads>[2];
type LeadActivityOperation = Parameters<typeof handleLeadActivities>[2];
type LeadNoteOperation = Parameters<typeof handleLeadNotes>[2];
type LeadCustomFieldOperation = Parameters<typeof handleLeadCustomFields>[2];
type TaskOperation = Parameters<typeof handleTasks>[2];
async function loadQueryFields(
	ctx: ILoadOptionsFunctions,
	context: 'lead.list' | 'task.list',
): Promise<QueryField[]> {
	const credentials = await ctx.getCredentials<AdhubAppCredentials>('adhubAppApi');
	return fetchQueryFields(ctx, credentials, context) as Promise<QueryField[]>;
}
export class AdhubApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AdHub App',
		name: 'adhubApp',
		group: ['output'],
		version: [1],
		defaultVersion: 1,
		subtitle: '',
		description: 'Manage AdHub leads, activities, sources, statuses, tags, and custom fields',
		defaults: {
			name: 'AdHub App',
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
					{ name: 'Create', value: 'createLeadSource', action: 'Create a lead source' },
					{ name: 'Delete', value: 'deleteLeadSource', action: 'Delete a lead source' },
					{ name: 'Get', value: 'getLeadSource', action: 'Get a lead source' },
					{ name: 'List', value: 'listLeadSources', action: 'Get all lead sources' },
					{ name: 'Update', value: 'updateLeadSource', action: 'Update a lead source' },
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
					{ name: 'Create', value: 'createLeadStatus', action: 'Create a lead status' },
					{ name: 'Delete', value: 'deleteLeadStatus', action: 'Delete a lead status' },
					{ name: 'Get', value: 'getLeadStatus', action: 'Get a lead status' },
					{ name: 'List', value: 'listLeadStatuses', action: 'Get all lead statuses' },
					{ name: 'Update', value: 'updateLeadStatus', action: 'Update a lead status' },
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
					{ name: 'Create', value: 'createLeadTag', action: 'Create a lead tag' },
					{ name: 'Delete', value: 'deleteLeadTag', action: 'Delete a lead tag' },
					{ name: 'Get', value: 'getLeadTag', action: 'Get a lead tag' },
					{ name: 'List', value: 'listLeadTags', action: 'Get all lead tags' },
					{ name: 'Update', value: 'updateLeadTag', action: 'Update a lead tag' },
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
					{ name: 'Bulk Create', value: 'bulkCreateLeads', action: 'Bulk create leads' },
					{ name: 'Bulk Delete', value: 'bulkDeleteLeads', action: 'Bulk delete leads' },
					{ name: 'Bulk Sync Tags', value: 'bulkSyncLeadTags', action: 'Bulk sync lead tags' },
					{
						name: 'Bulk Update Custom Fields',
						value: 'bulkUpdateLeadCustomFields',
						action: 'Bulk update lead custom fields',
					},
					{
						name: 'Bulk Update Fields',
						value: 'bulkUpdateLeadFields',
						action: 'Bulk update lead fields',
					},
					{ name: 'Create', value: 'createLead', action: 'Create a lead' },
					{ name: 'Delete', value: 'deleteLead', action: 'Delete a lead' },
					{ name: 'Get', value: 'getLead', action: 'Get a lead' },
					{ name: 'Get Entries', value: 'listLeadEntries', action: 'Get lead entries' },
					{ name: 'Get Timeline', value: 'getLeadTimeline', action: 'Get lead timeline' },
					{ name: 'List', value: 'listLeads', action: 'Get all leads' },
					{ name: 'Update', value: 'updateLead', action: 'Update a lead' },
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
					{ name: 'Create', value: 'createLeadActivity', action: 'Create a lead activity' },
					{ name: 'Delete', value: 'deleteLeadActivity', action: 'Delete a lead activity' },
					{ name: 'Get', value: 'getLeadActivity', action: 'Get a lead activity' },
					{ name: 'List', value: 'listLeadActivities', action: 'Get all lead activities' },
					{
						name: 'List Types',
						value: 'listLeadActivityTypes',
						action: 'List lead activity types',
					},
					{ name: 'Update', value: 'updateLeadActivity', action: 'Update a lead activity' },
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
					{ name: 'Create', value: 'createLeadNote', action: 'Create a lead note' },
					{ name: 'Delete', value: 'deleteLeadNote', action: 'Delete a lead note' },
					{ name: 'Get', value: 'getLeadNote', action: 'Get a lead note' },
					{ name: 'List', value: 'listLeadNotes', action: 'Get all lead notes' },
					{ name: 'Update', value: 'updateLeadNote', action: 'Update a lead note' },
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
					{ name: 'Create', value: 'createLeadCustomField', action: 'Create a lead custom field' },
					{ name: 'Delete', value: 'deleteLeadCustomField', action: 'Delete a lead custom field' },
					{ name: 'Get', value: 'getLeadCustomField', action: 'Get a lead custom field' },
					{ name: 'List', value: 'listLeadCustomFields', action: 'Get all lead custom fields' },
					{ name: 'Update', value: 'updateLeadCustomField', action: 'Update a lead custom field' },
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
					{ name: 'Bulk Complete', value: 'bulkCompleteTasks', action: 'Bulk complete tasks' },
					{ name: 'Bulk Delete', value: 'bulkDeleteTasks', action: 'Bulk delete tasks' },
					{ name: 'Complete', value: 'completeTask', action: 'Complete a task' },
					{ name: 'Create', value: 'createTask', action: 'Create a task' },
					{ name: 'Delete', value: 'deleteTask', action: 'Delete a task' },
					{ name: 'Get', value: 'getTask', action: 'Get a task' },
					{ name: 'List', value: 'listTasks', action: 'Get all tasks' },
					{ name: 'Update', value: 'updateTask', action: 'Update a task' },
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
					'{"per_page":50,"cursor":"opaque-cursor","page":2,"search":"john","sort_by":"created_at","sort_dir":"desc","filter":{"mode":"and","rules":[{"field":"lead.status","operator":"Equals To","value":"New"}]}}',
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
				displayName: 'Cursor',
				name: 'leadListCursor',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Cursor for fetching the next page. Leave blank to omit.',
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
				displayName: 'Sort By',
				name: 'leadListSortBy',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Field to sort by. Leave blank to omit.',
			},
			{
				displayName: 'Sort Direction',
				name: 'leadListSortDir',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
					{ name: 'Select', value: '' },
				],
				default: '',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['listLeads'],
						leadListBodyType: ['form'],
					},
				},
				description: 'Sort direction. Leave blank to omit.',
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
								displayName: 'Category Name or ID',
								name: 'category',
								type: 'options',
								default: 'leads',
								typeOptions: {
									loadOptionsMethod: 'getLeadFilterCategories',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldGeneral',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadGeneralFilterFields',
								},
								displayOptions: {
									show: {
										category: ['general'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldLeads',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadMainFilterFields',
								},
								displayOptions: {
									show: {
										category: ['leads'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldLeadCustomFields',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadCustomFilterFields',
								},
								displayOptions: {
									show: {
										category: ['leadCustomFields'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldTasks',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadTaskFilterFields',
								},
								displayOptions: {
									show: {
										category: ['tasks'],
									},
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
									loadOptionsDependsOn: [
										'category',
										'values.category',
										'fieldGeneral',
										'values.fieldGeneral',
										'fieldLeads',
										'values.fieldLeads',
										'fieldLeadCustomFields',
										'values.fieldLeadCustomFields',
										'fieldTasks',
										'values.fieldTasks',
										'leadListFilterRules',
										'leadListFilterRules.values.category',
										'leadListFilterRules.values.fieldGeneral',
										'leadListFilterRules.values.fieldLeads',
										'leadListFilterRules.values.fieldLeadCustomFields',
										'leadListFilterRules.values.fieldTasks',
									],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								displayOptions: {
									hide: {
										operator: VALUE_LESS_FILTER_OPERATORS,
									},
								},
								description: 'Filter value for the selected field',
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
				displayName: 'Body Type',
				name: 'bulkLeadBodyType',
				type: 'options',
				options: [
					{ name: 'Form', value: 'form' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'form',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads', 'bulkUpdateLeadFields', 'bulkSyncLeadTags', 'bulkUpdateLeadCustomFields'],
					},
				},
			},
			{
				displayName: 'Target Type',
				name: 'bulkLeadTargetType',
				type: 'options',
				options: [
					{ name: 'Filter', value: 'filter' },
					{ name: 'IDs', value: 'ids' },
				],
				default: 'ids',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads', 'bulkUpdateLeadFields', 'bulkSyncLeadTags', 'bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description: 'Choose whether to target specific lead IDs or use filter rules',
			},
			{
				displayName: 'Lead IDs',
				name: 'bulkLeadIds',
				type: 'string',
				default: '[]',
				placeholder: '["0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f10","0190c6e2-e4b0-7c83-a6f9-5e3c9b2a4f11"]',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads', 'bulkUpdateLeadFields', 'bulkSyncLeadTags', 'bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
						bulkLeadTargetType: ['ids'],
					},
				},
				description: 'Lead IDs as a JSON array of strings',
			},
			{
				displayName: 'Filter Mode',
				name: 'bulkLeadFilterMode',
				type: 'options',
				options: [
					{ name: 'AND', value: 'and' },
					{ name: 'OR', value: 'or' },
				],
				default: 'and',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads', 'bulkUpdateLeadFields', 'bulkSyncLeadTags', 'bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
						bulkLeadTargetType: ['filter'],
					},
				},
				description: 'How filter rules are combined',
			},
			{
				displayName: 'Filter Rules',
				name: 'bulkLeadFilterRules',
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
								displayName: 'Category Name or ID',
								name: 'category',
								type: 'options',
								default: 'leads',
								typeOptions: {
									loadOptionsMethod: 'getLeadFilterCategories',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldGeneral',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadGeneralFilterFields',
								},
								displayOptions: {
									show: {
										category: ['general'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldLeads',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadMainFilterFields',
								},
								displayOptions: {
									show: {
										category: ['leads'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldLeadCustomFields',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadCustomFilterFields',
								},
								displayOptions: {
									show: {
										category: ['leadCustomFields'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Field Name or ID',
								name: 'fieldTasks',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadTaskFilterFields',
								},
								displayOptions: {
									show: {
										category: ['tasks'],
									},
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
									loadOptionsDependsOn: [
										'category',
										'values.category',
										'fieldGeneral',
										'values.fieldGeneral',
										'fieldLeads',
										'values.fieldLeads',
										'fieldLeadCustomFields',
										'values.fieldLeadCustomFields',
										'fieldTasks',
										'values.fieldTasks',
										'bulkLeadFilterRules',
										'bulkLeadFilterRules.values.category',
										'bulkLeadFilterRules.values.fieldGeneral',
										'bulkLeadFilterRules.values.fieldLeads',
										'bulkLeadFilterRules.values.fieldLeadCustomFields',
										'bulkLeadFilterRules.values.fieldTasks',
									],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								displayOptions: {
									hide: {
										operator: VALUE_LESS_FILTER_OPERATORS,
									},
								},
								description: 'Filter value for the selected field',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkDeleteLeads', 'bulkUpdateLeadFields', 'bulkSyncLeadTags', 'bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
						bulkLeadTargetType: ['filter'],
					},
				},
				description: 'Filter rules to target leads',
			},
			{
				displayName: 'Status Name or ID',
				name: 'bulkLeadStatusId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadStatusOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Source Name or ID',
				name: 'bulkLeadSourceId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadSourceOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Owner Name or ID',
				name: 'bulkLeadOwnerId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadOwnerOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Add Tag IDs',
				name: 'bulkAddTagIds',
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
								displayName: 'Tag Name or ID',
								name: 'value',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadTagOptions',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkSyncLeadTags'],
						bulkLeadBodyType: ['form'],
					},
				},
				description: 'Tags to add',
			},
			{
				displayName: 'Remove Tag IDs',
				name: 'bulkRemoveTagIds',
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
								displayName: 'Tag Name or ID',
								name: 'value',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadTagOptions',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkSyncLeadTags'],
						bulkLeadBodyType: ['form'],
					},
				},
				description: 'Tags to remove',
			},
			{
				displayName: 'Custom Fields',
				name: 'bulkLeadCustomFieldValues',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Custom Field',
				options: [
					{
						name: 'values',
						displayName: 'Custom Field',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'key',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadCustomFieldOptions',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'Plain text value for the selected custom field',
							},
						],
					},
				],
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description: 'Custom field values to update',
			},
			{
				displayName: 'Additional / Undocumented Fields (JSON)',
				name: 'bulkUpdateCustomFieldsAdditionalFields',
				type: 'string',
				default: '',
				placeholder: '{"undocumented_field":"value"}',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['bulkUpdateLeadCustomFields'],
						bulkLeadBodyType: ['form'],
					},
				},
				description: 'Additional custom field payload as raw JSON object',
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
						bulkLeadBodyType: ['json'],
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
						bulkLeadBodyType: ['json'],
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
						bulkLeadBodyType: ['json'],
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
						bulkLeadBodyType: ['json'],
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
					'{"label":"Industry","name":"industry","type":"select","options":["saas","ecommerce"],"rules":["required"],"default_value":"saas"}',
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
					{ name: 'Input', value: 'input' },
					{ name: 'Multi Select', value: 'multi_select' },
					{ name: 'Phone', value: 'phone' },
					{ name: 'Radio', value: 'radio' },
					{ name: 'Select', value: 'select' },
					{ name: 'Text Input (Legacy)', value: 'text_input' },
					{ name: 'Textarea', value: 'textarea' },
				],
				default: 'input',
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
								displayName: 'Value Name or ID',
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
				displayName: 'Status Name or ID',
				name: 'leadStatusId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadStatusOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Source Name or ID',
				name: 'leadSourceId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadSourceOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Owner Name or ID',
				name: 'leadOwnerId',
				type: 'options',
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getLeadOwnerOptions',
				},
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
								displayName: 'Tag Name or ID',
								name: 'value',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadTagOptions',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
				displayName: 'Custom Fields',
				name: 'leadCustomFieldValues',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Custom Field',
				options: [
					{
						name: 'values',
						displayName: 'Custom Field',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'key',
								type: 'options',
								default: '',
								typeOptions: {
									loadOptionsMethod: 'getLeadCustomFieldOptions',
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'Plain text value for the selected custom field',
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
				description: 'Custom field values to assign to the lead',
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
				displayName: 'Include Empty Fields (Compatibility)',
				name: 'leadIncludeEmpty',
				type: 'boolean',
				default: false,
				description: 'Whether to send empty strings for blank fields instead of omitting them for compatibility',
				displayOptions: {
					show: {
						resource: ['leads'],
						operation: ['createLead', 'updateLead'],
						leadBodyType: ['form'],
					},
				},
			},
			{
				displayName: 'Additional / Undocumented Fields (JSON)',
				name: 'leadAdditionalFields',
				type: 'string',
				default: '',
				placeholder: '{"undocumented_field":"value"}',
				description: 'Fields not covered by the form above, sent as a raw JSON object. Use Custom Fields above for known custom fields.',
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
					'{"lead_id":"abc123","title":"Follow up","type":"email","due_date":"2026-03-25","due_time":"09:18","notes":"Call notes"}',
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
					{ name: 'Share', value: 'share' },
					{ name: 'SMS', value: 'sms' },
					{ name: 'To Do', value: 'to_do' },
					{ name: 'WhatsApp', value: 'whatsapp' },
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
				placeholder: '2026-03-25',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['createTask', 'updateTask'],
						taskBodyType: ['form'],
					},
				},
				description: 'Due date in YYYY-MM-DD format',
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
				displayName: 'Updated At',
				name: 'taskVersion',
				type: 'string',
				default: '',
				placeholder: '2026-05-03T09:30:00+05:00',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['updateTask', 'completeTask'],
					},
				},
				description: 'Optional optimistic lock timestamp. Legacy numeric values are ignored.',
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
					'{"per_page":50,"cursor":"opaque-cursor","page":1,"search":"follow","status":"scheduled","sort_by":"due_date","sort_dir":"asc"}',
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
				displayName: 'Cursor',
				name: 'taskListCursor',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Cursor for fetching the next page. Leave blank to omit.',
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
				displayName: 'Sort By',
				name: 'taskListSortBy',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Field to sort by. Leave blank to omit.',
			},
			{
				displayName: 'Sort Direction',
				name: 'taskListSortDir',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
					{ name: 'Select', value: '' },
				],
				default: '',
				displayOptions: {
					show: {
						resource: ['tasks'],
						operation: ['listTasks'],
						taskListBodyType: ['form'],
					},
				},
				description: 'Sort direction. Leave blank to omit.',
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
									loadOptionsDependsOn: [
										'field',
										'values.field',
										'taskListFilterRules',
										'taskListFilterRules.values.field',
									],
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								displayOptions: {
									hide: {
										operator: VALUE_LESS_FILTER_OPERATORS,
									},
								},
								description: 'Filter value for the selected field',
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
			async getLeadStatusOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
				const reqOptions = buildRequestOptions({
					method: 'GET',
					endpoint: '/lead-statuses',
					apiConfig: credentials,
				});
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this as never,
					'adhubAppApi',
					reqOptions,
				)) as
					| { data?: Array<Record<string, unknown>> }
					| Array<Record<string, unknown>>;
				const items = Array.isArray(response) ? response : (response?.data ?? []);
				return [
					{ name: '(None)', value: '' },
					...items
						.filter((item) => (item.id ?? '').toString().trim().length > 0)
						.map((item) => ({
							name: (item.name ?? item.id ?? '').toString(),
							value: (item.id ?? '').toString(),
						})),
				];
			},
			async getLeadSourceOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
				const reqOptions = buildRequestOptions({
					method: 'GET',
					endpoint: '/lead-sources',
					apiConfig: credentials,
				});
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this as never,
					'adhubAppApi',
					reqOptions,
				)) as
					| { data?: Array<Record<string, unknown>> }
					| Array<Record<string, unknown>>;
				const items = Array.isArray(response) ? response : (response?.data ?? []);
				return [
					{ name: '(None)', value: '' },
					...items
						.filter((item) => (item.id ?? '').toString().trim().length > 0)
						.map((item) => ({
							name: (item.name ?? item.id ?? '').toString(),
							value: (item.id ?? '').toString(),
						})),
				];
			},
			async getLeadOwnerOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
				const reqOptions = buildRequestOptions({
					method: 'GET',
					endpoint: '/users',
					apiConfig: credentials,
				});
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this as never,
					'adhubAppApi',
					reqOptions,
				)) as
					| { data?: Array<{ id?: string; name?: string; email?: string; role?: string }> }
					| Array<{ id?: string; name?: string; email?: string; role?: string }>;
				const items = Array.isArray(response) ? response : (response?.data ?? []);
				return [
					{ name: '(None)', value: '' },
					...items
						.filter((item) => (item.id ?? '').toString().trim().length > 0)
						.map((item) => ({
							name: (item.name ?? item.email ?? item.id ?? '').toString(),
							value: (item.id ?? '').toString(),
						})),
				];
			},
			async getLeadTagOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
				const reqOptions = buildRequestOptions({
					method: 'GET',
					endpoint: '/lead-tags',
					apiConfig: credentials,
				});
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this as never,
					'adhubAppApi',
					reqOptions,
				)) as
					| { data?: Array<Record<string, unknown>> }
					| Array<Record<string, unknown>>;
				const items = Array.isArray(response) ? response : (response?.data ?? []);
				return items
					.filter((item) => (item.id ?? '').toString().trim().length > 0)
					.map((item) => ({
						name: (item.name ?? item.id ?? '').toString(),
						value: (item.id ?? '').toString(),
					}));
			},
			async getLeadCustomFieldOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const hasRequiredRule = (rules: unknown): boolean => {
					if (!Array.isArray(rules)) return false;
					return rules.some((rule) => {
						if (typeof rule === 'string') {
							return rule.toLowerCase() === 'required';
						}
						if (!rule || typeof rule !== 'object') return false;
						const record = rule as Record<string, unknown>;
						return ['rule', 'name', 'type', 'value'].some(
							(key) => (record[key] ?? '').toString().trim().toLowerCase() === 'required',
						);
					});
				};
				const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
				const reqOptions = buildRequestOptions({
					method: 'GET',
					endpoint: '/lead-custom-fields',
					apiConfig: credentials,
				});
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this as never,
					'adhubAppApi',
					reqOptions,
				)) as
					| { data?: Array<{ id?: string; key?: string; name?: string; label?: string; rules?: unknown[] }> }
					| Array<{ id?: string; key?: string; name?: string; label?: string; rules?: unknown[] }>;
				const fields = Array.isArray(response) ? response : (response?.data ?? []);
				return fields
					.filter(
						(field) =>
							(field.name ?? field.key ?? field.id ?? '').toString().trim().length > 0,
					)
					.map((field) => ({
						name: `${field.label ?? field.name ?? field.key ?? ''}${
							hasRequiredRule(field.rules) ? ' (required)' : ''
						}`,
						value: field.name ?? field.key ?? field.id ?? '',
					}));
			},
			async getLeadFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				const category = getLeadFilterCategory(this);
				const scopedFields = filterLeadFieldsByCategory(fields, category);
				return scopedFields
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadGeneralFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				return filterLeadFieldsByCategory(fields, 'general')
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadMainFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				return filterLeadFieldsByCategory(fields, 'leads')
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadCustomFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				return filterLeadFieldsByCategory(fields, 'leadCustomFields')
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadTaskFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				return filterLeadFieldsByCategory(fields, 'tasks')
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadFilterCategories(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'lead.list');
				const available = getAvailableLeadFilterCategories(fields);
				const labelMap: Record<LeadFilterCategory, string> = {
					general: 'General Filters',
					leads: 'Leads',
					leadCustomFields: 'Lead Custom Fields',
					tasks: 'Task',
				};
				return available.map((category) => ({
					name: labelMap[category],
					value: category,
				}));
			},
			async getTaskFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const fields = await loadQueryFields(this, 'task.list');
				return fields
					.filter((field) => field.key)
					.map((field) => ({
						name: field.label ?? field.key ?? '',
						value: field.key ?? '',
						description: field.type ? `Type: ${field.type}` : undefined,
					}));
			},
			async getLeadFilterOperators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const emptyOption = { name: 'Select', value: '' };
				const fields = await loadQueryFields(this, 'lead.list');
				const category = getLeadFilterCategory(this);
				const scopedFields = filterLeadFieldsByCategory(fields, category);
				const candidateKeys = [readLeadRuleFieldKey(this)].filter((key) => key.length > 0);
				const match = candidateKeys
					.map((key) => findQueryField(scopedFields, key))
					.find((field): field is QueryField => field !== undefined);
				if (!match) {
					return [emptyOption, ...mapScopedOperatorOptions(scopedFields)];
				}
				const operators = mapOptions(match?.operators ?? []);
				return [emptyOption, ...operators];
			},
			async getTaskFilterOperators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const emptyOption = { name: 'Select', value: '' };
				const fields = await loadQueryFields(this, 'task.list');
				const candidateKeys = [
					readFixedCollectionRuleParam(this, 'taskListFilterRules', 'field'),
					readCurrentStringParam(this, 'field'),
				].filter((key) => key.length > 0);
				const match = candidateKeys
					.map((key) => findQueryField(fields, key))
					.find((field): field is QueryField => field !== undefined);
				if (!match) {
					return [emptyOption, ...mapScopedOperatorOptions(fields)];
				}
				const operators = mapOptions(match?.operators ?? []);
				return [emptyOption, ...operators];
			},
			async getLeadFilterFieldOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const fieldKey = readLeadRuleFieldKey(this);
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await loadQueryFields(this, 'lead.list');
				const category = getLeadFilterCategory(this);
				const scopedFields = filterLeadFieldsByCategory(fields, category);
				const match = findQueryField(scopedFields, fieldKey);
				const options = (match?.options ?? []).map((opt) => ({
					name: opt.label ?? opt.value ?? '',
					value: opt.value ?? '',
				}));
				return [emptyOption, ...options];
			},
			async getLeadFilterValues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const emptyOption = { name: 'Select', value: '' };
				const fields = await loadQueryFields(this, 'lead.list');
				const category = getLeadFilterCategory(this);
				const scopedFields = filterLeadFieldsByCategory(fields, category);
				const candidateKeys = [readLeadRuleFieldKey(this)].filter((key) => key.length > 0);
				const match = candidateKeys
					.map((key) => findQueryField(scopedFields, key))
					.find((field): field is QueryField => field !== undefined);
				if (!match) {
					return [emptyOption, ...mapScopedFieldValueOptions(scopedFields)];
				}
				return [emptyOption, ...mapFieldValueOptions(match)];
			},
			async getTaskFilterFieldOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const fieldKey = readCurrentStringParam(this, 'field');
				const emptyOption = { name: 'Select', value: '' };
				if (!fieldKey) return [emptyOption];
				const fields = await loadQueryFields(this, 'task.list');
				const match = findQueryField(fields, fieldKey);
				const options = (match?.options ?? []).map((opt) => ({
					name: opt.label ?? opt.value ?? '',
					value: opt.value ?? '',
				}));
				return [emptyOption, ...options];
			},
			async getTaskFilterValues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const emptyOption = { name: 'Select', value: '' };
				const fields = await loadQueryFields(this, 'task.list');
				const candidateKeys = [
					readFixedCollectionRuleParam(this, 'taskListFilterRules', 'field'),
					readCurrentStringParam(this, 'field'),
				].filter((key) => key.length > 0);
				const match = candidateKeys
					.map((key) => findQueryField(fields, key))
					.find((field): field is QueryField => field !== undefined);
				if (!match) {
					return [emptyOption, ...mapScopedFieldValueOptions(fields)];
				}
				return [emptyOption, ...mapFieldValueOptions(match)];
			},
		},
	};
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		// Fetch credentials once — not per item.
		const credentials = await this.getCredentials<AdhubAppCredentials>('adhubAppApi');
		const apiConfig = credentials;
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const resource = this.getNodeParameter('resource', itemIndex) as string;
			const operation = this.getNodeParameter('operation', itemIndex) as string;
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
						{
							const leadResult = await handleLeads(
								this,
								itemIndex,
								operation as LeadOperation,
								apiConfig,
							);
							if (Array.isArray(leadResult)) {
								returnData.push(...leadResult);
							} else {
								returnData.push(leadResult);
							}
						}
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
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
				}
			}
		}
		return [returnData];
	}
}
