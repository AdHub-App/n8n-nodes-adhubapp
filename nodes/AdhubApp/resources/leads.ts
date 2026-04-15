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

async function handleLeads(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: LeadOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const normalizeFilterMode = (mode: string): 'AND' | 'OR' => {
		const normalized = (mode ?? '').toString().trim().toLowerCase();
		return normalized === 'or' ? 'OR' : 'AND';
	};

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
	const leadIncludeEmpty = ctx.getNodeParameter('leadIncludeEmpty', itemIndex, true) as boolean;
	const leadAdditionalFieldsRaw = ctx.getNodeParameter(
		'leadAdditionalFields',
		itemIndex,
		'',
	) as string;
	const leadTimelineLimit = ctx.getNodeParameter('leadTimelineLimit', itemIndex, 0) as number;
	const leadEntriesLimit = ctx.getNodeParameter('leadEntriesLimit', itemIndex, 0) as number;
	const leadListBodyType = ctx.getNodeParameter('leadListBodyType', itemIndex, 'json') as string;
	const leadListPerPage = ctx.getNodeParameter('leadListPerPage', itemIndex, 0) as number;
	const leadListPage = ctx.getNodeParameter('leadListPage', itemIndex, 0) as number;
	const leadListSearch = ctx.getNodeParameter('leadListSearch', itemIndex, '') as string;
	const leadListFilterMode = ctx.getNodeParameter('leadListFilterMode', itemIndex, 'and') as string;
	const leadListFilterRulesParam = ctx.getNodeParameter('leadListFilterRules', itemIndex, {}) as {
		values?: Array<{
			field?: string;
			operator?: string;
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
			if (leadIncludeEmpty || leadFirstName) formBody.first_name = leadFirstName;
			if (leadIncludeEmpty || leadLastName) formBody.last_name = leadLastName;
			if (leadIncludeEmpty || leadEmail) formBody.email = leadEmail;
			if (leadIncludeEmpty || leadMobileNumber) formBody.mobile_number = leadMobileNumber;
			if (leadIncludeEmpty || leadStatusId) formBody.status_id = leadStatusId;
			if (leadIncludeEmpty || leadSourceId) formBody.source_id = leadSourceId;
			if (leadIncludeEmpty || leadOwnerId) formBody.owner_id = leadOwnerId;
			if (leadIncludeEmpty || leadCompany) formBody.company = leadCompany;
			if (leadIncludeEmpty || leadJobTitle) formBody.job_title = leadJobTitle;
			if (leadIncludeEmpty || leadServiceInterest) formBody.service_interest = leadServiceInterest;
			if (leadIncludeEmpty || leadMonthlyBudget) formBody.monthly_budget = leadMonthlyBudget;
			if (leadIncludeEmpty || leadTimeline) formBody.timeline = leadTimeline;
			if (leadIncludeEmpty || leadInternalNotes) formBody.internal_notes = leadInternalNotes;
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
			if (leadListPage) listBody.page = leadListPage;
			if (leadListSearch) listBody.search = leadListSearch;
			const noValueOperators = new Set([
				'Is Empty',
				'Is Not Empty',
				'Today',
				'Yesterday',
				'This Week',
				'Last Week',
				'This Month',
				'Last Month',
				'This Year',
			]);
			const resolveFilterValue = (rule: {
				valueSelect?: string;
				valueDate?: string;
				valueText?: string;
			}): string => {
				const candidates = [rule?.valueSelect, rule?.valueDate, rule?.valueText];
				for (const candidate of candidates) {
					if (candidate === undefined || candidate === null) continue;
					const trimmed = candidate.toString().trim();
					if (trimmed.length > 0) return trimmed;
				}
				return '';
			};
			const filterRules = (leadListFilterRulesParam?.values ?? [])
				.map((rule) => ({
					field: (rule?.field ?? '').toString().trim(),
					operator: (rule?.operator ?? '').toString().trim(),
					value: resolveFilterValue(rule ?? {}),
				}))
				.filter((rule) => rule.field.length > 0 && rule.operator.length > 0)
				.map((rule) => {
					if (noValueOperators.has(rule.operator)) {
						return { field: rule.field, operator: rule.operator };
					}
					return rule.value.length > 0 ? rule : { field: rule.field, operator: rule.operator };
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
			if (leadListPage) listBody.page = listBody.page ?? leadListPage;
			if (leadListSearch) listBody.search = listBody.search ?? leadListSearch;
			delete listBody.sort_by;
			delete listBody.sort_dir;
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
		if (operation === 'listLeads' && options.body && typeof options.body === 'object') {
			const errorData = (error as { response?: { data?: JsonRecord; status?: number } })?.response
				?.data as JsonRecord | undefined;
			const status = (error as { response?: { status?: number } })?.response?.status;
			const errors = (errorData?.errors ?? {}) as Record<string, unknown>;
			const hasFilterModeError = Boolean(errors['filter.mode']);
			if (status === 422 && hasFilterModeError) {
				const patchedBody = { ...(options.body as JsonRecord) };
				let changed = false;
				if (hasFilterModeError) {
					const filter = patchedBody.filter as JsonRecord | undefined;
					if (filter) {
						filter.mode = normalizeFilterMode((filter.mode as string) ?? '');
						const rules = filter.rules as unknown;
						if (!Array.isArray(rules) || rules.length === 0) {
							delete patchedBody.filter;
						}
						changed = true;
					}
				}
				if (changed) {
					const retryOptions = { ...options, body: patchedBody };
					const response = await ctx.helpers.request(retryOptions);
					return { json: response };
				}
			}
		}
		throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject, { itemIndex });
	}
}

export { handleLeads };
