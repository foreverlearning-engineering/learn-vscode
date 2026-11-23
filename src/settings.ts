// The extension's two settings, checked. Pure: the caller passes a getter.
import { ALLOWED_BASE_URLS, PRODUCTION_BASE_URL } from './constants.ts';

export interface LearnSettings {
  baseUrl: string;
  assignmentId: string | null;
  notes: string[];
}

export function readSettings(get: (name: string) => unknown): LearnSettings {
  const notes: string[] = [];

  const rawBase = get('apiBaseUrl');
  let baseUrl = PRODUCTION_BASE_URL;
  if (typeof rawBase === 'string' && rawBase.trim() !== '') {
    const clean = rawBase.trim().replace(/\/+$/, '');
    if (ALLOWED_BASE_URLS.includes(clean)) baseUrl = clean;
    else notes.push('learn.apiBaseUrl is not a Learn API host, so the production host is used.');
  }

  const rawAssignment = get('assignmentId');
  let assignmentId: string | null = null;
  if (typeof rawAssignment === 'string' && rawAssignment.trim() !== '') {
    const clean = rawAssignment.trim();
    if (clean.length <= 200 && /^[\x21-\x7e]+$/.test(clean)) assignmentId = clean;
    else notes.push('learn.assignmentId is not a valid assignment id, so none is sent.');
  }

  return { baseUrl, assignmentId, notes };
}
