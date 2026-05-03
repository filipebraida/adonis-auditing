import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare body: string | null
  @column() declare status: string
  @column() declare secret: string | null
  @column() declare viewCount: number
}

test.group('CRUD audit — create', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('writes an audit row with full snapshot in newValues, null oldValues', async ({
    assert,
  }) => {
    const post = await Post.create({ title: 'Hello', status: 'draft', viewCount: 0 })
    const audits = await Audit.query().where('auditableType', 'Post').where('auditableId', post.id)
    assert.lengthOf(audits, 1)
    assert.equal(audits[0].event, 'created')
    assert.deepEqual(audits[0].tags, ['mutation'])
    assert.isNull(audits[0].oldValues)
    assert.equal(audits[0].newValues!.title, 'Hello')
    assert.equal(audits[0].newValues!.status, 'draft')
  })
})

test.group('CRUD audit — update', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('writes diff-only oldValues/newValues for changed fields', async ({ assert }) => {
    const post = await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
    post.status = 'published'
    await post.save()
    const last = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'updated')
      .firstOrFail()
    assert.deepEqual(last.oldValues, { status: 'draft' })
    assert.deepEqual(last.newValues, { status: 'published' })
    assert.deepEqual(last.tags, ['mutation'])
  })

  test('does not write an audit when only excluded fields changed', async ({ assert }) => {
    class P extends compose(BaseModel, Auditable) {
      static table = 'posts'
      static auditExclude = ['viewCount']
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare status: string
      @column() declare viewCount: number
    }
    const p = await P.create({ title: 'A', status: 'draft', viewCount: 0 })
    p.viewCount = 5
    await p.save()
    const updates = await Audit.query()
      .where('auditableType', 'P')
      .where('auditableId', p.id)
      .where('event', 'updated')
    assert.lengthOf(updates, 0)
  })
})

test.group('CRUD audit — delete', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('writes audit with snapshot oldValues, null newValues', async ({ assert }) => {
    const post = await Post.create({ title: 'X', status: 'draft', viewCount: 0 })
    await post.delete()
    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .where('event', 'deleted')
      .firstOrFail()
    assert.equal(a.oldValues!.title, 'X')
    assert.isNull(a.newValues)
    assert.deepEqual(a.tags, ['mutation'])
  })
})
