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

async function handleTasks(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: TaskOperations,
	apiConfig: ApiConfig,
): Promise<INodeExecutionData> {
	const normalizeFilterMode = (mode: string): 'AND' | 'OR' => {
		const normalized = (mode ?? '').toString().trim().toLowerCase();
		return normalized === 'or' ? 'OR' : 'AND';
	};

	const taskId = ctx.getNodeParameter('taskId', itemIndex, '') as string;
	const taskBodyRaw = ctx.getNodeParameter('taskBody', itemIndex, '') as string;
	const taskBodyType = ctx.getNodeParameter('taskBodyType', itemIndex, 'form') as string;
	const taskTitle = ctx.getNodeParameter('taskTitle', itemIndex, '') as string;
	const taskType = ctx.getNodeParameter('taskType', itemIndex, '') as string;
	const taskLeadId = ctx.getNodeParameter('taskLeadId', itemIndex, '') as string;
	const taskDueDate = ctx.getNodeParameter('taskDueDate', itemIndex, '') as string;
	const taskDueTime = ctx.getNodeParameter('taskDueTime', itemIndex, '') as string;
	const taskNotes = ctx.getNodeParameter('taskNotes', itemIndex, '') as string;
	const taskVersion = ctx.getNodeParameter('taskVersion', itemIndex, 0) as number;
	const taskIds = ctx.getNodeParameter('taskIds', itemIndex, '') as string;
	const taskListBodyRaw = ctx.getNodeParameter('taskListBody', itemIndex, '') as string;
	const taskListBodyType = ctx.getNodeParameter('taskListBodyType', itemIndex, 'json') as string;
	const taskListPerPage = ctx.getNodeParameter('taskListPerPage', itemIndex, 0) as number;
	const taskListPage = ctx.getNodeParameter('taskListPage', itemIndex, 0) as number;
	const taskListSearch = ctx.getNodeParameter('taskListSearch', itemIndex, '') as string;
	const taskListStatus = ctx.getNodeParameter('taskListStatus', itemIndex, '') as string;
	const taskListFilterMode = ctx.getNodeParameter('taskListFilterMode', itemIndex, 'and') as string;
	const taskListFilterRulesParam = ctx.getNodeParameter('taskListFilterRules', itemIndex, {}) as {
		values?: Array<{
			field?: string;
			operator?: string;
			valueText?: string;
			valueDate?: string;
			valueSelect?: string;
		}>;
	};

	let method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	let endpoint: string;
	let includeBody = false;
	const qs: JsonRecord = {};

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
				if (taskListPage) formBody.page = taskListPage;
				if (taskListSearch) formBody.search = taskListSearch;
				if (taskListStatus) formBody.status = taskListStatus;
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
				const filterRules = (taskListFilterRulesParam?.values ?? [])
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
				if (operation === 'updateTask' && taskVersion) formBody.version = taskVersion;
				body = formBody;
			} else {
				body = parseJson(taskBodyRaw, 'Body');
			}
		} else if (operation === 'completeTask') {
			if (taskVersion) {
				body = { version: taskVersion };
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
