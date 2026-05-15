import type { IExecuteFunctions, INodeExecutionData, IDataObject, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	type ApiConfig,
	buildRequestOptions,
	executeAdhubRequest,
	formatAdhubNodeResponse,
	parseJson,
	fetchQueryFields,
	resolveRuleValue,
	resolveLeadCustomFieldValue,
	isMultiselectCustomFieldType,
	JsonRecord,
} from '../helpers';

type LeadOperations =
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
	type LeadCustomFieldMeta = {
		id?: string;
		name?: string;
		key?: string;
		label?: string;
		type?: string;
		rules?: unknown[];
	};
	const normalizeFilterMode = (mode: string): 'and' | 'or' => {
		const normalized = (mode ?? '').toString().trim().toLowerCase();
		return normalized === 'or' ? 'or' : 'and';
	};
	const normalizeOperator = (operator: string): string =>
		(operator ?? '').toString().trim().toLowerCase();
	const normalizeIdList = (entries: Array<{ value?: string }> = []): string[] =>
		entries
			.map((entry) => (entry?.value ?? '').toString().trim())
			.filter((value) => value.length > 0);
	const parseIdArray = (raw: string, label: string): string[] => {
		const parsed = parseJson(raw, label, ctx.getNode(), itemIndex);
		if (!Array.isArray(parsed)) {
			throw new NodeOperationError(ctx.getNode(), `${label} must be a JSON array`, {
				itemIndex,
				description: 'Example: ["id-1","id-2"]',
			});
		}
		return parsed
			.map((value) => value?.toString().trim())
			.filter((value): value is string => Boolean(value));
	};
	const hasRequiredRule = (rules: unknown): boolean => {
		if (!Array.isArray(rules)) return false;
		return rules.some((rule) => {
			if (typeof rule === 'string') return rule.toLowerCase() === 'required';
			if (!rule || typeof rule !== 'object') return false;
			const record = rule as Record<string, unknown>;
			return ['rule', 'name', 'type', 'value'].some(
				(key) => (record[key] ?? '').toString().trim().toLowerCase() === 'required',
			);
		});
	};
	const fetchLeadCustomFieldMetadata = async (): Promise<LeadCustomFieldMeta[]> => {
		const reqOptions = buildRequestOptions({
			method: 'GET',
			endpoint: '/lead-custom-fields',
			apiConfig,
		});
		const response = (await executeAdhubRequest(
			ctx.helpers.httpRequest,
			reqOptions,
			ctx.getNode(),
			itemIndex,
		)) as
			| { data?: LeadCustomFieldMeta[] }
			| LeadCustomFieldMeta[];
		return Array.isArray(response) ? response : (response?.data ?? []);
	};
	const applyLeadCustomFieldValues = async (
		target: JsonRecord,
		fieldEntries: Array<{ key?: string; value?: string }>,
		errorContext: string,
	): Promise<void> => {
		const normalizeLoose = (value: string): string =>
			value.toLowerCase().replace(/[^a-z0-9]/g, '');
		const fieldDefinitions = await fetchLeadCustomFieldMetadata();
		for (const entry of fieldEntries) {
			const key = (entry?.key ?? '').toString().trim();
			if (!key) continue;
			const normalizedKey = normalizeLoose(key);
			const fieldDef = fieldDefinitions.find(
				(field) => {
					const candidates = [field.name, field.key, field.id, field.label]
						.map((value) => (value ?? '').toString().trim())
						.map((value) => [value.toLowerCase(), normalizeLoose(value)])
						.flat()
						.filter((value) => value.length > 0);
					return candidates.includes(key.toLowerCase()) || candidates.includes(normalizedKey);
				},
			);
			const isFieldRequired = hasRequiredRule(fieldDef?.rules);
			const fieldType = fieldDef?.type;
			const resolvedValue = resolveLeadCustomFieldValue(
				ctx.getNode(),
				fieldType,
				entry?.value,
				itemIndex,
				fieldDef?.label ?? key,
			);
			const isMissingValue = isMultiselectCustomFieldType(fieldType)
				? (resolvedValue as string[]).length === 0
				: resolvedValue.toString().trim().length === 0;
			if (isMissingValue && isFieldRequired) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Value is required for custom field "${fieldDef?.label ?? key}"`,
					{
						itemIndex,
						description: `${errorContext}: provide a value for required custom fields`,
					},
				);
			}
			const apiKey = (fieldDef?.name ?? fieldDef?.key ?? key).toString().trim() || key;
			target[apiKey] = resolvedValue;
		}
	};
	const resolveLeadFilterField = (rule: {
		field?: string;
		fieldGeneral?: string;
		fieldLeads?: string;
		fieldLeadCustomFields?: string;
		fieldTasks?: string;
	}): string =>
		(rule.fieldGeneral ??
			rule.fieldLeads ??
			rule.fieldLeadCustomFields ??
			rule.fieldTasks ??
			rule.field ??
			'')
			.toString()
			.trim();
	const buildLeadFilter = async (
		filterMode: string,
		filterRulesParam:
			| {
					values?: Array<{
						field?: string;
						fieldGeneral?: string;
						fieldLeads?: string;
						fieldLeadCustomFields?: string;
						fieldTasks?: string;
						operator?: string;
						value?: string;
						valueText?: string;
						valueDate?: string;
						valueSelect?: string;
					}>;
			  }
			| undefined,
	): Promise<JsonRecord | undefined> => {
		const queryFields = await fetchQueryFields(ctx, apiConfig, 'lead.list');
		const filterRules = (filterRulesParam?.values ?? [])
			.map((rule) => ({
				field: resolveLeadFilterField(rule ?? {}),
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
		if (!filterRules.length) {
			return undefined;
		}
		return {
			mode: normalizeFilterMode(filterMode),
			rules: filterRules,
		};
	};
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
	const leadCustomFieldValuesParam = ctx.getNodeParameter('leadCustomFieldValues', itemIndex, {}) as {
		values?: Array<{ key?: string; value?: string }>;
	};
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
			category?: string;
			field?: string;
			fieldGeneral?: string;
			fieldLeads?: string;
			fieldLeadCustomFields?: string;
			fieldTasks?: string;
			operator?: string;
			value?: string;
			valueText?: string;
			valueDate?: string;
			valueSelect?: string;
		}>;
	};
	const bulkLeadBodyType = ctx.getNodeParameter('bulkLeadBodyType', itemIndex, 'form') as string;
	const bulkLeadTargetType = ctx.getNodeParameter('bulkLeadTargetType', itemIndex, 'ids') as string;
	const bulkLeadIdsRaw = ctx.getNodeParameter('bulkLeadIds', itemIndex, '[]') as string;
	const bulkLeadFilterMode = ctx.getNodeParameter('bulkLeadFilterMode', itemIndex, 'and') as string;
	const bulkLeadFilterRulesParam = ctx.getNodeParameter('bulkLeadFilterRules', itemIndex, {}) as {
		values?: Array<{
			field?: string;
			fieldGeneral?: string;
			fieldLeads?: string;
			fieldLeadCustomFields?: string;
			fieldTasks?: string;
			operator?: string;
			value?: string;
			valueText?: string;
			valueDate?: string;
			valueSelect?: string;
		}>;
	};
	const bulkLeadStatusId = ctx.getNodeParameter('bulkLeadStatusId', itemIndex, '') as string;
	const bulkLeadSourceId = ctx.getNodeParameter('bulkLeadSourceId', itemIndex, '') as string;
	const bulkLeadOwnerId = ctx.getNodeParameter('bulkLeadOwnerId', itemIndex, '') as string;
	const bulkAddTagIdsParam = ctx.getNodeParameter('bulkAddTagIds', itemIndex, {}) as {
		values?: Array<{ value?: string }>;
	};
	const bulkRemoveTagIdsParam = ctx.getNodeParameter('bulkRemoveTagIds', itemIndex, {}) as {
		values?: Array<{ value?: string }>;
	};
	const bulkLeadCustomFieldValuesParam = ctx.getNodeParameter('bulkLeadCustomFieldValues', itemIndex, {}) as {
		values?: Array<{ key?: string; value?: string }>;
	};
	const bulkUpdateCustomFieldsAdditionalFieldsRaw = ctx.getNodeParameter(
		'bulkUpdateCustomFieldsAdditionalFields',
		itemIndex,
		'',
	) as string;
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
			body = parseJson(bulkCreateBodyRaw, 'Bulk Create Body', ctx.getNode(), itemIndex) as IDataObject;
		} else if (operation === 'bulkDeleteLeads') {
			body = parseJson(bulkDeleteBodyRaw, 'Bulk Delete Body', ctx.getNode(), itemIndex) as IDataObject;
		} else if (operation === 'bulkUpdateLeadFields') {
			body = parseJson(
				bulkUpdateFieldsBodyRaw,
				'Bulk Update Fields Body',
				ctx.getNode(),
				itemIndex,
			) as IDataObject;
		} else if (operation === 'bulkSyncLeadTags') {
			body = parseJson(bulkSyncTagsBodyRaw, 'Bulk Sync Tags Body', ctx.getNode(), itemIndex) as IDataObject;
		} else if (operation === 'bulkUpdateLeadCustomFields') {
			body = parseJson(
				bulkUpdateCustomFieldsBodyRaw,
				'Bulk Update Custom Fields Body',
				ctx.getNode(),
				itemIndex,
			) as IDataObject;
		} else if (operationsUsingJsonBody.has(operation)) {
			body = parseJson(bodyRaw, 'Body', ctx.getNode(), itemIndex) as IDataObject;
		} else if (leadBodyType === 'form') {
			const formBody: JsonRecord = {};
			if (leadFirstName) formBody.first_name = leadFirstName;
			if (leadLastName) formBody.last_name = leadLastName;
			if (leadEmail) formBody.email = leadEmail;
			if (leadMobileNumber) formBody.mobile_number = leadMobileNumber;
			if (leadStatusId) formBody.status_id = leadStatusId;
			if (leadSourceId) formBody.source_id = leadSourceId;
			if (leadOwnerId) formBody.owner_id = leadOwnerId;
			if (leadIncludeEmpty) {
				if (leadFirstName === '') formBody.first_name = '';
				if (leadLastName === '') formBody.last_name = '';
				if (leadEmail === '') formBody.email = '';
				if (leadMobileNumber === '') formBody.mobile_number = '';
				if (leadStatusId === '') formBody.status_id = '';
				if (leadSourceId === '') formBody.source_id = '';
				if (leadOwnerId === '') formBody.owner_id = '';
			}
			if (leadUpdatedAt) formBody.updated_at = leadUpdatedAt;

			if (leadTagIdsParam?.values?.length) {
				const tagIds = leadTagIdsParam.values
					.map((entry) => (entry?.value ?? '').toString().trim())
					.filter((entry) => entry.length > 0);
				if (tagIds.length) formBody.tag_ids = tagIds;
			}

			if (leadCustomFieldValuesParam?.values?.length) {
				await applyLeadCustomFieldValues(
					formBody,
					leadCustomFieldValuesParam.values,
					'Lead custom fields',
				);
			}

			const extraFields = parseJson(
				leadAdditionalFieldsRaw,
				'Additional Fields',
				ctx.getNode(),
				itemIndex,
			) as IDataObject;
			for (const [key, value] of Object.entries(extraFields)) {
				if (formBody[key] === undefined) formBody[key] = value as IDataObject[keyof IDataObject];
			}
			body = formBody;
		} else {
			body = parseJson(bodyRaw, 'Body', ctx.getNode(), itemIndex) as IDataObject;
		}
	}
	if (
		operation === 'bulkDeleteLeads' ||
		operation === 'bulkUpdateLeadFields' ||
		operation === 'bulkSyncLeadTags' ||
		operation === 'bulkUpdateLeadCustomFields'
	) {
		if (bulkLeadBodyType === 'form') {
			const bulkBody: JsonRecord = {};
			if (bulkLeadTargetType === 'ids') {
				const leadIds = parseIdArray(bulkLeadIdsRaw, 'Lead IDs');
				if (!leadIds.length) {
					throw new NodeOperationError(ctx.getNode(), 'At least one Lead ID is required', {
						itemIndex,
						description: 'Provide Lead IDs or switch Target Type to Filter',
					});
				}
				bulkBody.lead_ids = leadIds;
			} else {
				const filter = await buildLeadFilter(bulkLeadFilterMode, bulkLeadFilterRulesParam);
				if (!filter) {
					throw new NodeOperationError(ctx.getNode(), 'At least one filter rule is required', {
						itemIndex,
						description: 'Add filter rules or switch Target Type to IDs',
					});
				}
				bulkBody.filter = filter;
			}
			if (operation === 'bulkUpdateLeadFields') {
				if (bulkLeadStatusId) bulkBody.status_id = bulkLeadStatusId;
				if (bulkLeadSourceId) bulkBody.source_id = bulkLeadSourceId;
				if (bulkLeadOwnerId) bulkBody.owner_id = bulkLeadOwnerId;
			}
			if (operation === 'bulkSyncLeadTags') {
				const addTagIds = normalizeIdList(bulkAddTagIdsParam?.values ?? []);
				const removeTagIds = normalizeIdList(bulkRemoveTagIdsParam?.values ?? []);
				if (addTagIds.length) bulkBody.add_tag_ids = addTagIds;
				if (removeTagIds.length) bulkBody.remove_tag_ids = removeTagIds;
			}
			if (operation === 'bulkUpdateLeadCustomFields') {
				if (bulkLeadCustomFieldValuesParam?.values?.length) {
					await applyLeadCustomFieldValues(
						bulkBody,
						bulkLeadCustomFieldValuesParam.values,
						'Bulk custom fields',
					);
				}
				const extraFields = parseJson(
					bulkUpdateCustomFieldsAdditionalFieldsRaw,
					'Additional Custom Fields',
					ctx.getNode(),
					itemIndex,
				) as IDataObject;
				for (const [key, value] of Object.entries(extraFields)) {
					if (bulkBody[key] === undefined) bulkBody[key] = value as IDataObject[keyof IDataObject];
				}
			}
			body = bulkBody;
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
			const filter = await buildLeadFilter(leadListFilterMode, leadListFilterRulesParam);
			if (filter) listBody.filter = filter;
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

export { handleLeads };
