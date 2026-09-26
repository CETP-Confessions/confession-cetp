function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `${slug || 'new'}-inbox`;
}

function availableSlug(base, usedSlugs) {
  if (!usedSlugs.has(base)) return base;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, 40 - ending.length).replace(/-+$/g, '')}${ending}`;
    if (!usedSlugs.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique destination slug.');
}

function destinationPath(destination) {
  if (destination.type === 'individual') return `/u/${destination.slug}`;
  if (destination.type === 'organization') return `/c/${destination.slug}`;
  if (['department', 'group'].includes(destination.type) && destination.organizationSlug) {
    return `/c/${destination.organizationSlug}/${destination.slug}`;
  }
  throw new Error('Destination route information is incomplete.');
}

module.exports = { slugify, availableSlug, destinationPath };