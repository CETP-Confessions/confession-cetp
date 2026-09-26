const test = require('node:test');
const assert = require('node:assert/strict');
const { availableSlug, destinationPath, slugify } = require('../src/destinationLinks');

test('slugifies names into URL-safe lowercase slugs', () => {
  assert.equal(slugify('CET College'), 'cet-college');
  assert.equal(slugify('  CSE & Robotics!  '), 'cse-robotics');
  assert.equal(slugify('École Centrale'), 'ecole-centrale');
  assert.equal(slugify('!!!'), 'new-inbox');
});

test('chooses the next unused suffix without changing available slugs', () => {
  assert.equal(availableSlug('cet', new Set()), 'cet');
  assert.equal(availableSlug('cet', new Set(['cet'])), 'cet-2');
  assert.equal(availableSlug('cet', new Set(['cet', 'cet-2', 'cet-3'])), 'cet-4');
});

test('derives route paths from destination type and scope', () => {
  assert.equal(destinationPath({ type: 'individual', slug: 'shahin' }), '/u/shahin');
  assert.equal(destinationPath({ type: 'organization', slug: 'cet' }), '/c/cet');
  assert.equal(destinationPath({ type: 'department', organizationSlug: 'cet', slug: 'cse' }), '/c/cet/cse');
  assert.equal(destinationPath({ type: 'group', organizationSlug: 'cet', slug: 'union' }), '/c/cet/union');
  assert.throws(() => destinationPath({ type: 'group', slug: 'union' }));
});