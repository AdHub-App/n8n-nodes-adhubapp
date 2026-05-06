import type { IExecuteFunctions, INodeExecutionData, IDataObject, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, parseJson, JsonRecord } from '../helpers';

type LeadOperations =
	| 'listLeadQueryFields'
	| 'listLeads'
	| 'createLead'
	| 'getLead'
	| 'bulkCreateLeads'
	| 'bulkDeleteLeads'
	| 'bulkUpdateLeadFields'
	| 'bulkSyncLeadTags'
	| 'bulkUpdateLeadCustomFields'
	| 'updateLead'
	| 'deleteLead'
	| 'getLeadTimeline'
	| 'listLeadEntries';

type QueryFieldDefinition = {
	key?: string;
	type?: string;
	options?: Array<{ value?: string; label?: string }>;
};

async function fetchQueryFields(
	ctx: IExecuteFunctions,
	apiConfig: ApiConfig,
	context: 'lead.list' | 'task.list',
): Promise<QueryFieldDefinition[]> {
	const options = buildRequestOptions({
		method: 'GET',
		endpoint: '/query-builder/fields',
		apiConfig,
		qs: { context },
	});
	const response = (await ctx.helpers.request(options)) as unknown;
	if (Array.isArray(response)) return response as QueryFieldDefinition[];
	if (response && typeof response === 'object') {
		const payload = response as JsonRecord;
		const direct = payload.data;
		if (Array.isArray(direct)) return direct as QueryFieldDefinition[];
	}
	return [];
}

function resolveRuleValue(
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

	if (directValue) {
		return directValue;
	}

	if (hasSelectOptions) {
		return selectValue || textValue || dateValue;
	}
	if (normalizedType.includes('date') || normalizedType.includes('time')) {
		if (usesTextForDateInput) {
			return textValue || dateValue || selectValue;
		}
		return dateValue || textValue || selectValue;
	}
	return textValue || selectValue || dateValue;
}

async function handleLeads(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const normalizeFilterMode = (mode: string): 'and' | 'or' => {
		const normalized = (mode ?? '').toString().trim().toLowerCase();
		return normalized === 'or' ? 'or' : 'and';
	};
	const normalizeOperator = (operator: string): string =>
		(operator ?? '').toString().trim().toLowerCase();
	const noValueOperators = new Set([
		'is empty',
		'is not empty',
		'today',
		'yesterday',
		'this week',
		'last week',
		'this month',
		'last month',
		'this year',
	]);

	const leadId = ctx.getNodeParameter('leadId', itemIndex, '') as string;
	const queryContext = ctx.getNodeParameter('queryContext', itemIndex, '') as string;
	const bodyRaw = ctx.getNodeParameter('body', itemIndex, '') as string;
	const leadBodyType = ctx.getNodeParameter('leadBodyType', itemIndex, 'form') as string;
	const leadFirstName = ctx.getNodeParameter('leadFirstName', itemIndex, '') as string;
	const leadLastName = ctx.getNodeParameter('leadLastName', itemIndex, '') as string;
	const leadEmail = ctx.getNodeParameter('leadEmail', itemIndex, '') as string;
	const leadMobileNumber = ctx.getNodeParameter('leadMobileNumber', itemIndex, '') as string;
	const leadStatusId = ctx.getNodeParameter('leadStatusId', itemIndex, '') as string;
	const leadSourceId = ctx.getNodeParameter('leadSourceId', itemIndex, '') as string;
	const leadOwnerId = ctx.getNodeParameter('leadOwnerId', itemIndex, '') as string;
	const leadTagIdsParam = ctx.getNodeParameter('leadTagIds', itemIndex, {}) as {
		values?: Array<{ value?: string }>;
	};
	const leadCompany = ctx.getNodeParameter('leadCompany', itemIndex, '') as string;
	const leadJobTitle = ctx.getNodeParameter('leadJobTitle', itemIndex, '') as string;
	const leadServiceInterest = ctx.getNodeParameter('leadServiceInterest', itemIndex, '') as string;
	const leadMonthlyBudget = ctx.getNodeParameter('leadMonthlyBudget', itemIndex, '') as string;
	const leadTimeline = ctx.getNodeParameter('leadTimeline', itemIndex, '') as string;
	const leadInternalNotes = ctx.getNodeParameter('leadInternalNotes', itemIndex, '') as string;
	const leadUpdatedAt = ctx.getNodeParameter('leadUpdatedAt', itemIndex, '') as string;
	const leadIncludeEmpty = ctx.getNodeParameter('leadIncludeEmpty', itemIndex, false) as boolean;
	const leadAdditionalFieldsRaw = ctx.getNodeParameter(
		'leadAdditionalFields',
		itemIndex,
		'',
	) as string;
	const leadTimelineLimit = ctx.getNodeParameter('leadTimelineLimit', itemIndex, 0) as number;
	const leadEntriesLimit = ctx.getNodeParameter('leadEntriesLimit', itemIndex, 0) as number;
	const leadListBodyType = ctx.getNodeParameter('leadListBodyType', itemIndex, 'json') as string;
	const leadListPerPage = ctx.getNodeParameter('leadListPerPage', itemIndex, 0) as number;
	const leadListCursor = ctx.getNodeParameter('leadListCursor', itemIndex, '') as string;
	const leadListPage = ctx.getNodeParameter('leadListPage', itemIndex, 0) as number;
	const leadListSearch = ctx.getNodeParameter('leadListSearch', itemIndex, '') as string;
	const leadListSortBy = ctx.getNodeParameter('leadListSortBy', itemIndex, '') as string;
	const leadListSortDir = ctx.getNodeParameter('leadListSortDir', itemIndex, '') as string;
	const leadListFilterMode = ctx.getNodeParameter('leadListFilterMode', itemIndex, 'and') as string;
	const leadListFilterRulesParam = ctx.getNodeParameter('leadListFilterRules', itemIndex, {}) as {
		values?: Array<{
			field?: string;
			operator?: string;
			value?: string;
			valueText?: string;
			valueDate?: string;
			valueSelect?: string;
		}>;
	};
	const bulkCreateBodyRaw = ctx.getNodeParameter('bulkCreateBody', itemIndex, '') as string;
	const bulkDeleteBodyRaw = ctx.getNodeParameter('bulkDeleteBody', itemIndex, '') as string;
	const bulkUpdateFieldsBodyRaw = ctx.getNodeParameter(
		'bulkUpdateFieldsBody',
		itemIndex,
		'',
	) as string;
	const bulkSyncTagsBodyRaw = ctx.getNodeParameter('bulkSyncTagsBody', itemIndex, '') as string;
	const bulkUpdateCustomFieldsBodyRaw = ctx.getNodeParameter(
		'bulkUpdateCustomFieldsBody',
		itemIndex,
		'',
	) as string;
	const operationsUsingJsonBody = new Set(['listLeads']);

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;
	const qs: JsonRecord = {};

	switch (operation) {
		case 'listLeadQueryFields':
			method = 'GET';
			endpoint = '/query-builder/fields';
			qs.context = queryContext;
			break;
		case 'listLeads':
			method = 'POST';
			endpoint = '/leads/list';
			includeBody = true;
			break;
		case 'createLead':
			method = 'POST';
			endpoint = '/leads';
			includeBody = true;
			break;
		case 'getLead':
			method = 'GET';
			endpoint = `/leads/${leadId}`;
			break;
		case 'bulkCreateLeads':
			method = 'POST';
			endpoint = '/leads/bulk';
			includeBody = true;
			break;
		case 'bulkDeleteLeads':
			method = 'DELETE';
			endpoint = '/leads/bulk';
			includeBody = true;
			break;
		case 'bulkUpdateLeadFields':
			method = 'POST';
			endpoint = '/leads/bulk/fields';
			includeBody = true;
			break;
		case 'bulkSyncLeadTags':
			method = 'POST';
			endpoint = '/leads/bulk/tags';
			includeBody = true;
			break;
		case 'bulkUpdateLeadCustomFields':
			method = 'POST';
			endpoint = '/leads/bulk/custom-fields';
			includeBody = true;
			break;
		case 'updateLead':
			method = 'PUT';
			endpoint = `/leads/${leadId}`;
			includeBody = true;
			break;
		case 'deleteLead':
			method = 'DELETE';
			endpoint = `/leads/${leadId}`;
			break;
		case 'getLeadTimeline':
			method = 'GET';
			endpoint = `/leads/${leadId}/timeline`;
			if (leadTimelineLimit) qs.limit = leadTimelineLimit;
			break;
		case 'listLeadEntries':
			method = 'GET';
			endpoint = `/leads/${leadId}/entries`;
			if (leadEntriesLimit) qs.limit = leadEntriesLimit;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	let body;
	if (includeBody) {
		if (operation === 'bulkCreateLeads') {
			body = parseJson(bulkCreateBodyRaw, 'Bulk Create Body');
		} else if (operation === 'bulkDeleteLeads') {
			body = parseJson(bulkDeleteBodyRaw, 'Bulk Delete Body');
		} else if (operation === 'bulkUpdateLeadFields') {
			body = parseJson(bulkUpdateFieldsBodyRaw, 'Bulk Update Fields Body');
		} else if (operation === 'bulkSyncLeadTags') {
			body = parseJson(bulkSyncTagsBodyRaw, 'Bulk Sync Tags Body');
		} else if (operation === 'bulkUpdateLeadCustomFields') {
			body = parseJson(bulkUpdateCustomFieldsBodyRaw, 'Bulk Update Custom Fields Body');
		} else if (operationsUsingJsonBody.has(operation)) {
			body = parseJson(bodyRaw, 'Body');
		} else if (leadBodyType === 'form') {
			const formBody: JsonRecord = {};
			if (leadFirstName) formBody.first_name = leadFirstName;
			if (leadLastName) formBody.last_name = leadLastName;
			if (leadEmail) formBody.email = leadEmail;
			if (leadMobileNumber) formBody.mobile_number = leadMobileNumber;
			if (leadStatusId) formBody.status_id = leadStatusId;
			if (leadSourceId) formBody.source_id = leadSourceId;
			if (leadOwnerId) formBody.owner_id = leadOwnerId;
			if (leadCompany) formBody.company = leadCompany;
			if (leadJobTitle) formBody.job_title = leadJobTitle;
			if (leadServiceInterest) formBody.service_interest = leadServiceInterest;
			if (leadMonthlyBudget) formBody.monthly_budget = leadMonthlyBudget;
			if (leadTimeline) formBody.timeline = leadTimeline;
			if (leadInternalNotes) formBody.internal_notes = leadInternalNotes;
			if (leadIncludeEmpty) {
				if (leadFirstName === '') formBody.first_name = '';
				if (leadLastName === '') formBody.last_name = '';
				if (leadEmail === '') formBody.email = '';
				if (leadMobileNumber === '') formBody.mobile_number = '';
				if (leadStatusId === '') formBody.status_id = '';
				if (leadSourceId === '') formBody.source_id = '';
				if (leadOwnerId === '') formBody.owner_id = '';
				if (leadCompany === '') formBody.company = '';
				if (leadJobTitle === '') formBody.job_title = '';
				if (leadServiceInterest === '') formBody.service_interest = '';
				if (leadMonthlyBudget === '') formBody.monthly_budget = '';
				if (leadTimeline === '') formBody.timeline = '';
				if (leadInternalNotes === '') formBody.internal_notes = '';
			}
			if (leadUpdatedAt) formBody.updated_at = leadUpdatedAt;

			if (leadTagIdsParam?.values?.length) {
				const tagIds = leadTagIdsParam.values
					.map((entry) => (entry?.value ?? '').toString().trim())
					.filter((entry) => entry.length > 0);
				if (tagIds.length) formBody.tag_ids = tagIds;
			}

			const extraFields = parseJson(leadAdditionalFieldsRaw, 'Additional Fields');
			for (const [key, value] of Object.entries(extraFields)) {
				if (formBody[key] === undefined) formBody[key] = value as IDataObject[keyof IDataObject];
			}
			body = formBody;
		} else {
			body = parseJson(bodyRaw, 'Body');
		}
	}

	if (operation === 'listLeads') {
		if (leadListBodyType === 'form') {
			const listBody: JsonRecord = {};
			if (leadListPerPage) listBody.per_page = leadListPerPage;
			if (leadListCursor) listBody.cursor = leadListCursor;
			if (leadListPage) listBody.page = leadListPage;
			if (leadListSearch) listBody.search = leadListSearch;
			if (leadListSortBy) listBody.sort_by = leadListSortBy;
			if (leadListSortDir) listBody.sort_dir = leadListSortDir;
			const queryFields = await fetchQueryFields(ctx, apiConfig, 'lead.list');
			const filterRules = (leadListFilterRulesParam?.values ?? [])
				.map((rule) => ({
					field: (rule?.field ?? '').toString().trim(),
					operator: (rule?.operator ?? '').toString().trim(),
					value: resolveRuleValue(
						rule ?? {},
						queryFields.find((field) => field.key === (rule?.field ?? '').toString().trim()),
					),
				}))
				.filter((rule) => rule.field.length > 0 && rule.operator.length > 0)
				.map((rule) => {
					if (noValueOperators.has(normalizeOperator(rule.operator))) {
						return { field: rule.field, operator: rule.operator };
					}
					if (!rule.value.length) {
						throw new NodeOperationError(
							ctx.getNode(),
							`Filter value is required for operator "${rule.operator}" on field "${rule.field}"`,
							{ itemIndex, description: 'Provide a value or choose a valueless operator' },
						);
					}
					return rule;
				});
			if (filterRules.length) {
				listBody.filter = {
					mode: normalizeFilterMode(leadListFilterMode),
					rules: filterRules,
				};
			}
			body = listBody;
		} else {
			const listBody: JsonRecord = (body ?? {}) as JsonRecord;
			if (leadListPerPage) listBody.per_page = listBody.per_page ?? leadListPerPage;
			if (leadListCursor) listBody.cursor = listBody.cursor ?? leadListCursor;
			if (leadListPage) listBody.page = listBody.page ?? leadListPage;
			if (leadListSearch) listBody.search = listBody.search ?? leadListSearch;
			if (leadListSortBy) listBody.sort_by = listBody.sort_by ?? leadListSortBy;
			if (leadListSortDir) listBody.sort_dir = listBody.sort_dir ?? leadListSortDir;
			const filter = listBody.filter as JsonRecord | undefined;
			if (filter) {
				const rules = filter.rules as unknown;
				const ruleList = Array.isArray(rules) ? rules : [];
				if (ruleList.length === 0) {
					delete listBody.filter;
				} else {
					filter.mode = normalizeFilterMode((filter.mode as string) ?? '');
				}
			}
			body = listBody;
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
		const response = await ctx.helpers.request(options);
		return { json: response };
	} catch (error) {
		throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject, { itemIndex });
	}
}

export { handleLeads };
