import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

test.group('Conditional auditing — per-model auditIf', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('auditIf returning false skips audit on created', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditIf = () => false
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }
    const post = await Post.create({ title: 'A' })
    const audits = await Audit.query().where('auditableType', 'Post').where('auditableId', post.id)
    assert.lengthOf(audits, 0)
  })

  test('auditIf returning true allows audit on created', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditIf = () => true
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }
    const post = await Post.create({ title: 'A' })
    const audits = await Audit.query().where('auditableType', 'Post').where('auditableId', post.id)
    assert.lengthOf(audits, 1)
  })

  test('auditIf returning false skips audit on update', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditIf = (_model: any, event: string) => event !== 'updated'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }
    const post = await Post.create({ title: 'A' })
    post.title = 'B'
    await post.save()
    const updates = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'updated')
    assert.lengthOf(updates, 0)
    // Sanity: created event still recorded.
    const creates = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'created')
    assert.lengthOf(creates, 1)
  })
})

test.group('Conditional auditing — global skipIfOnlyChanged', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ skipIfOnlyChanged: ['title'] }))
    return () => teardownApp(app)
  })

  test('skipIfOnlyChanged skips update when only listed fields changed', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare body: string | null
    }
    const post = await Post.create({ title: 'A', body: 'b' })
    post.title = 'B'
    await post.save()
    const updates = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'updated')
    assert.lengthOf(updates, 0)
  })

  test('skipIfOnlyChanged does not skip when other fields also changed', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare body: string | null
    }
    const post = await Post.create({ title: 'A', body: 'b' })
    post.title = 'B'
    post.body = 'c'
    await post.save()
    const updates = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'updated')
    assert.lengthOf(updates, 1)
  })

  test('skipIfOnlyChanged does not affect created events', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }
    const post = await Post.create({ title: 'A' })
    const creates = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'created')
    assert.lengthOf(creates, 1)
  })
})
