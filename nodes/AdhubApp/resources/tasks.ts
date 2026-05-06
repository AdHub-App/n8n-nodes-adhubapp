import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { type ApiConfig, buildRequestOptions, parseJson, JsonRecord } from '../helpers';

type TaskOperations =
	| 'listTasks'
	| 'createTask'
	| 'getTask'
	| 'updateTask'
	| 'deleteTask'
	| 'completeTask'
	| 'bulkCompleteTasks'
	| 'bulkDeleteTasks';

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

async function handleTasks(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: TaskOperations,
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

	const taskId = ctx.getNodeParameter('taskId', itemIndex, '') as string;
	const taskBodyRaw = ctx.getNodeParameter('taskBody', itemIndex, '') as string;
	const taskBodyType = ctx.getNodeParameter('taskBodyType', itemIndex, 'form') as string;
	const taskTitle = ctx.getNodeParameter('taskTitle', itemIndex, '') as string;
	const taskType = ctx.getNodeParameter('taskType', itemIndex, '') as string;
	const taskLeadId = ctx.getNodeParameter('taskLeadId', itemIndex, '') as string;
	const taskDueDate = ctx.getNodeParameter('taskDueDate', itemIndex, '') as string;
	const taskDueTime = ctx.getNodeParameter('taskDueTime', itemIndex, '') as string;
	const taskNotes = ctx.getNodeParameter('taskNotes', itemIndex, '') as string;
	const taskVersion = ctx.getNodeParameter('taskVersion', itemIndex, '') as string | number;
	const taskIds = ctx.getNodeParameter('taskIds', itemIndex, '') as string;
	const taskListBodyRaw = ctx.getNodeParameter('taskListBody', itemIndex, '') as string;
	const taskListBodyType = ctx.getNodeParameter('taskListBodyType', itemIndex, 'json') as string;
	const taskListPerPage = ctx.getNodeParameter('taskListPerPage', itemIndex, 0) as number;
	const taskListCursor = ctx.getNodeParameter('taskListCursor', itemIndex, '') as string;
	const taskListPage = ctx.getNodeParameter('taskListPage', itemIndex, 0) as number;
	const taskListSearch = ctx.getNodeParameter('taskListSearch', itemIndex, '') as string;
	const taskListStatus = ctx.getNodeParameter('taskListStatus', itemIndex, '') as string;
	const taskListSortBy = ctx.getNodeParameter('taskListSortBy', itemIndex, '') as string;
	const taskListSortDir = ctx.getNodeParameter('taskListSortDir', itemIndex, '') as string;
	const taskListFilterMode = ctx.getNodeParameter('taskListFilterMode', itemIndex, 'and') as string;
	const taskListFilterRulesParam = ctx.getNodeParameter('taskListFilterRules', itemIndex, {}) as {
		values?: Array<{
			field?: string;
			operator?: string;
			value?: string;
			valueText?: string;
			valueDate?: string;
			valueSelect?: string;
		}>;
	};

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;
	const qs: JsonRecord = {};
	const normalizedTaskUpdatedAt =
		typeof taskVersion === 'string' && taskVersion.trim().length > 0 ? taskVersion.trim() : '';

	switch (operation) {
		case 'listTasks':
			method = 'POST';
			endpoint = '/tasks/list';
			includeBody = true;
			break;
		case 'createTask':
			method = 'POST';
			endpoint = '/tasks';
			includeBody = true;
			break;
		case 'getTask':
			method = 'GET';
			endpoint = `/tasks/${taskId}`;
			break;
		case 'updateTask':
			method = 'PUT';
			endpoint = `/tasks/${taskId}`;
			includeBody = true;
			break;
		case 'deleteTask':
			method = 'DELETE';
			endpoint = `/tasks/${taskId}`;
			break;
		case 'completeTask':
			method = 'POST';
			endpoint = `/tasks/${taskId}/complete`;
			includeBody = true;
			break;
		case 'bulkCompleteTasks':
			method = 'POST';
			endpoint = '/tasks/bulk/complete';
			includeBody = true;
			break;
		case 'bulkDeleteTasks':
			method = 'DELETE';
			endpoint = '/tasks/bulk';
			includeBody = true;
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unsupported operation: ${operation}`, {
				itemIndex,
				description: 'Check the selected operation',
			});
	}

	let body;
	if (includeBody) {
		if (operation === 'listTasks') {
			if (taskListBodyType === 'form') {
				const formBody: JsonRecord = {};
				if (taskListPerPage) formBody.per_page = taskListPerPage;
				if (taskListCursor) formBody.cursor = taskListCursor;
				if (taskListPage) formBody.page = taskListPage;
				if (taskListSearch) formBody.search = taskListSearch;
				if (taskListStatus) formBody.status = taskListStatus;
				if (taskListSortBy) formBody.sort_by = taskListSortBy;
				if (taskListSortDir) formBody.sort_dir = taskListSortDir;
				const queryFields = await fetchQueryFields(ctx, apiConfig, 'task.list');
				const filterRules = (taskListFilterRulesParam?.values ?? [])
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
					formBody.filter = {
						mode: normalizeFilterMode(taskListFilterMode),
						rules: filterRules,
					};
				}
				body = formBody;
			} else {
				const listBody = parseJson(taskListBodyRaw, 'Body') as JsonRecord;
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
		} else if (operation === 'createTask' || operation === 'updateTask') {
			if (taskBodyType === 'form') {
				const formBody: JsonRecord = {};
				if (taskLeadId) formBody.lead_id = taskLeadId;
				if (taskTitle) formBody.title = taskTitle;
				if (taskType) formBody.type = taskType;
				if (taskDueDate) formBody.due_date = taskDueDate;
				if (taskDueTime) formBody.due_time = taskDueTime;
				if (taskNotes) formBody.notes = taskNotes;
				if (operation === 'updateTask' && normalizedTaskUpdatedAt) {
					formBody.updated_at = normalizedTaskUpdatedAt;
				}
				body = formBody;
			} else {
				body = parseJson(taskBodyRaw, 'Body');
			}
		} else if (operation === 'completeTask') {
			if (normalizedTaskUpdatedAt) {
				body = { updated_at: normalizedTaskUpdatedAt };
			}
		} else if (operation === 'bulkCompleteTasks' || operation === 'bulkDeleteTasks') {
			const ids = taskIds
				.split(',')
				.map((id: string) => id.trim())
				.filter((id: string) => id);
			if (ids.length > 0) {
				body = { task_ids: ids };
			}
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

export { handleTasks };
