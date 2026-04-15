import crypto from 'crypto';
import type { IDataObject } from 'n8n-workflow';

export type JsonRecord = IDataObject;

export function buildPayloadHash(payload: JsonRecord): string {
	const raw = JSON.stringify(payload);
	return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function firstNonEmptyString(values: Array<string | undefined | null>): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim().length > 0) return value;
	}
	return undefined;
}

export function matchesEventType(eventType: string, patterns: string[]): boolean {
	if (!eventType) return false;
	const normalized = eventType.toLowerCase();
	for (const pattern of patterns) {
		const candidate = pattern.toLowerCase();
		if (candidate === '*') return true;
		if (candidate.endsWith('.*')) {
			const prefix = candidate.slice(0, -2);
			if (normalized.startsWith(`${prefix}.`)) return true;
		}
		if (candidate === normalized) return true;
	}
	return false;
}
