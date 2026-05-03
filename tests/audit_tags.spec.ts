import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

class TaggedPost extends compose(BaseModel, Auditable) {
  static table = 'posts'
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number

  override auditTags() {
    return [`workspace:${this.status}`]
  }
}

class AsyncTaggedPost extends compose(BaseModel, Auditable) {
  static table = 'posts'
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number

  override async auditTags() {
    return [`async:${this.id}`]
  }
}

test.group('auditTags', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('appends model tags after the mutation tag on auto create', async ({ assert }) => {
    const post = await TaggedPost.create({ title: 'A', status: 'draft', viewCount: 0 })
    const audit = await Audit.query()
      .where('auditableType', 'TaggedPost')
      .where('auditableId', post.id)
      .where('event', 'created')
      .firstOrFail()
    assert.deepEqual(audit.tags, ['mutation', 'workspace:draft'])
  })

  test('reflects current model state on auto update', async ({ assert }) => {
    const post = await TaggedPost.create({ title: 'A', status: 'draft', viewCount: 0 })
    post.status = 'published'
    await post.save()
    const audit = await Audit.query()
      .where('auditableType', 'TaggedPost')
      .where('event', 'updated')
      .firstOrFail()
    assert.deepEqual(audit.tags, ['mutation', 'workspace:published'])
  })

  test('appends model tags to explicit tags from auditCustom', async ({ assert }) => {
    const post = await TaggedPost.create({ title: 'A', status: 'draft', viewCount: 0 })
    await post.auditCustom('viewed', { tags: ['view'] })
    const audit = await Audit.query()
      .where('auditableType', 'TaggedPost')
      .where('event', 'viewed')
      .firstOrFail()
    assert.deepEqual(audit.tags, ['view', 'workspace:draft'])
  })

  test('contributes the only tags when auditCustom passes none', async ({ assert }) => {
    const post = await TaggedPost.create({ title: 'A', status: 'draft', viewCount: 0 })
    await post.auditCustom('viewed')
    const audit = await Audit.query()
      .where('auditableType', 'TaggedPost')
      .where('event', 'viewed')
      .firstOrFail()
    assert.deepEqual(audit.tags, ['workspace:draft'])
  })

  test('supports async auditTags()', async ({ assert }) => {
    const post = await AsyncTaggedPost.create({ title: 'A', status: 'draft', viewCount: 0 })
    const audit = await Audit.query()
      .where('auditableType', 'AsyncTaggedPost')
      .where('auditableId', post.id)
      .firstOrFail()
    assert.deepEqual(audit.tags, ['mutation', `async:${post.id}`])
  })
})
