import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

test.group('Global auditExclude — created', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ auditExclude: ['secret'] }))
    return () => teardownApp(app)
  })

  test('global auditExclude drops field on created', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare secret: string | null
    }
    const post = await Post.create({ title: 'A', secret: 'top-secret' })
    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .firstOrFail()
    assert.equal(a.newValues!.title, 'A')
    assert.notProperty(a.newValues!, 'secret')
  })
})

test.group('Global auditExclude — updated', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ auditExclude: ['updatedAt'] }))
    return () => teardownApp(app)
  })

  test('global auditExclude drops field on both sides of update diff', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare updatedAt: string | null
    }
    const post = await Post.create({ title: 'A', updatedAt: 't0' })
    post.title = 'B'
    post.updatedAt = 't1'
    await post.save()
    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'updated')
      .firstOrFail()
    assert.deepEqual(a.oldValues, { title: 'A' })
    assert.deepEqual(a.newValues, { title: 'B' })
  })
})

test.group('Global auditExclude — skip on empty', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ auditExclude: ['onlyCol'] }))
    return () => teardownApp(app)
  })

  test('no audit row when single mutable column is globally excluded', async ({ assert }) => {
    class Trivial extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare onlyCol: string
    }
    const t = await Trivial.create({ onlyCol: 'x' })
    t.onlyCol = 'y'
    await t.save()
    const updates = await Audit.query().where('auditableType', 'Trivial').where('event', 'updated')
    assert.lengthOf(updates, 0)
  })
})

test.group('Global auditExclude — union with per-model', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ auditExclude: ['globalNoise'] }))
    return () => teardownApp(app)
  })

  test('global and per-model auditExclude both drop their fields', async ({ assert }) => {
    class Doc extends compose(BaseModel, Auditable) {
      static auditExclude = ['localNoise']
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare globalNoise: string | null
      @column() declare localNoise: string | null
    }
    const d = await Doc.create({
      title: 'A',
      globalNoise: 'g',
      localNoise: 'l',
    })
    const a = await Audit.query()
      .where('auditableType', 'Doc')
      .where('auditableId', d.id)
      .firstOrFail()
    assert.equal(a.newValues!.title, 'A')
    assert.notProperty(a.newValues!, 'globalNoise')
    assert.notProperty(a.newValues!, 'localNoise')
  })
})

test.group('Global auditExclude — auditCustom unaffected', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ auditExclude: ['noise'] }))
    return () => teardownApp(app)
  })

  test('auditCustom payload preserves keys listed in global auditExclude', async ({ assert }) => {
    class Doc2 extends compose(BaseModel, Auditable) {
      static table = 'docs'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }
    const d = await Doc2.create({ title: 'X' })
    await d.auditCustom('inspected', {
      new: { noise: 'kept', signal: 'also kept' },
    })
    const a = await Audit.query()
      .where('auditableType', 'Doc2')
      .where('event', 'inspected')
      .firstOrFail()
    assert.equal(a.newValues!.noise, 'kept')
    assert.equal(a.newValues!.signal, 'also kept')
  })
})
