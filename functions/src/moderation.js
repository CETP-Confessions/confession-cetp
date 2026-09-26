const { db, hash } = require('./shared');

async function moderateText(destinationId, text) {
  const normalized = text.toLocaleLowerCase('en');
  const flags = [];
  const words = await db.collection('blockedWords').where('active', '==', true).limit(300).get();
  const blocked = words.docs.some((item) => {
    const word = String(item.data().word || '').trim().toLocaleLowerCase('en');
    return word && normalized.includes(word);
  });
  if (blocked) flags.push('blocked_word');

  const links = text.match(/https?:\/\/|www\./gi) || [];
  if (links.length >= 3) flags.push('excessive_links');
  if (/(.)\1{9,}/u.test(text)) flags.push('repeated_characters');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) flags.push('possible_email');
  if (/(?:\+?\d[\s().-]*){9,}/.test(text)) flags.push('possible_phone');

  const fingerprint = hash(`${destinationId}:${normalized.replace(/\s+/g, ' ').trim()}`);
  const previous = await db.collection('messageFingerprints').doc(fingerprint).get();
  if (previous.exists && Date.now() - previous.data().createdAt.toMillis() < 24 * 60 * 60 * 1000) {
    flags.push('repeated_message');
  }
  return { status: flags.length ? 'needs_review' : 'pending', flags, fingerprint };
}

module.exports = { moderateText };