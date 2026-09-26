import { httpsCallable } from 'firebase/functions';
import { functions } from './config.js';

async function call(name, data) {
  const result = await httpsCallable(functions, name)(data);
  return result.data;
}

export const getPublicDestination = (data) => call('getPublicDestination', data);
export const createDestination = (data) => call('createDestination', data);
export const ensureDestinationLink = (data) => call('ensureDestinationLink', data);
export const startMessageUpload = (data) => call('startMessageUpload', data);
export const submitAnonymousMessage = (data) => call('submitAnonymousMessage', data);
export const moderateMessage = (data) => call('moderateMessage', data);
export const markMessageRead = (data) => call('markMessageRead', data);
export const deleteMessage = (data) => call('deleteMessage', data);
export const createReport = (data) => call('createReport', data);