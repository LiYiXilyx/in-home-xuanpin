import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTaxonomyPipelineImplementation } from '../../src/modules/catalog-scale/taxonomy-pipeline-capability.mjs';
import { fixtureCategoryProfile } from '../fixtures/initial-category-pool-fixture.mjs';

test('unimplemented new Category never inherits Motorcycle pipeline capability', () => {
  const profile = fixtureCategoryProfile();
  assert.equal(hasTaxonomyPipelineImplementation(profile, 'classify'), false);
  assert.equal(hasTaxonomyPipelineImplementation(profile, 'fine_classify'), false);
  assert.equal(hasTaxonomyPipelineImplementation(profile, 'opportunity'), false);
  const borrowed = { ...profile, taxonomy_bindings: {
    classify: { taxonomy_name: 'week1-motorcycle-accessories', taxonomy_version: null, rule_version: 'week1-rule-v1' }
  } };
  assert.equal(hasTaxonomyPipelineImplementation(borrowed, 'classify'), false);
});
