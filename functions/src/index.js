const { getPublicDestination, createDestination, ensureDestinationLink } = require('./destinations');
const { startMessageUpload, submitAnonymousMessage, moderateMessage, markMessageRead, deleteMessage, cleanupExpiredUploads } = require('./messages');
const { createReport } = require('./reports');
const { notifyDestinationOwner } = require('./notifications');

exports.getPublicDestination = getPublicDestination;
exports.createDestination = createDestination;
exports.ensureDestinationLink = ensureDestinationLink;
exports.startMessageUpload = startMessageUpload;
exports.submitAnonymousMessage = submitAnonymousMessage;
exports.moderateMessage = moderateMessage;
exports.markMessageRead = markMessageRead;
exports.deleteMessage = deleteMessage;
exports.cleanupExpiredUploads = cleanupExpiredUploads;
exports.createReport = createReport;
exports.notifyDestinationOwner = notifyDestinationOwner;