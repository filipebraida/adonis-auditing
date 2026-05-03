import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number
}

test.group('auditCustom', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('records pure event with no diff', async ({ assert }) => {
    const post = await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
    await post.auditCustom('viewed', { tags: ['view'] })
    const last = await Audit.query()
      .where('auditableId', post.id)
      .where('event', 'viewed')
      .firstOrFail()
    assert.deepEqual(last.tags, ['view'])
    assert.isNull(last.oldValues)
    assert.isNull(last.newValues)
  })

  test('records explicit old/new payload verbatim', async ({ assert }) => {
    const post = await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
    await post.auditCustom('published', {
      old: { status: 'draft' },
      new: { status: 'published' },
      tags: ['state'],
      metadata: { reason: 'editorial' },
    })
    const last = await Audit.query()
      .where('auditableId', post.id)
      .where('event', 'published')
      .firstOrFail()
    assert.deepEqual(last.oldValues, { status: 'draft' })
    assert.deepEqual(last.newValues, { status: 'published' })
    assert.deepEqual(last.tags, ['state'])
    assert.equal(last.metadata!.reason, 'editorial')
  })
})
