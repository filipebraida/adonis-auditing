import { test } from '@japa/runner'
import Audit from '../src/audit.js'

test.group('Audit JSON column consume — driver compatibility', () => {
  test('hydrates pg/jsonb payload (object) without re-parsing', ({ assert }) => {
    const row = {
      id: 1,
      event: 'updated',
      auditable_type: 'Post',
      auditable_id: 1,
      old_values: { title: 'Old' },
      new_values: { title: 'New' },
      tags: ['a', 'b'],
      metadata: { source: 'test' },
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }

    const audit = Audit.$createFromAdapterResult(row)!

    assert.deepEqual(audit.oldValues, { title: 'Old' })
    assert.deepEqual(audit.newValues, { title: 'New' })
    assert.deepEqual(audit.tags, ['a', 'b'])
    assert.deepEqual(audit.metadata, { source: 'test' })
  })

  test('hydrates sqlite/text payload (string) by parsing JSON', ({ assert }) => {
    const row = {
      id: 1,
      event: 'updated',
      auditable_type: 'Post',
      auditable_id: 1,
      old_values: '{"title":"Old"}',
      new_values: '{"title":"New"}',
      tags: '["a","b"]',
      metadata: '{"source":"test"}',
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }

    const audit = Audit.$createFromAdapterResult(row)!

    assert.deepEqual(audit.oldValues, { title: 'Old' })
    assert.deepEqual(audit.newValues, { title: 'New' })
    assert.deepEqual(audit.tags, ['a', 'b'])
    assert.deepEqual(audit.metadata, { source: 'test' })
  })

  test('null json columns hydrate as null regardless of driver', ({ assert }) => {
    const row = {
      id: 1,
      event: 'created',
      auditable_type: 'Post',
      auditable_id: 1,
      old_values: null,
      new_values: { title: 'New' },
      tags: null,
      metadata: null,
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }

    const audit = Audit.$createFromAdapterResult(row)!

    assert.isNull(audit.oldValues)
    assert.deepEqual(audit.newValues, { title: 'New' })
    assert.isNull(audit.tags)
    assert.isNull(audit.metadata)
  })
})
