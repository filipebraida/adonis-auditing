import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

test.group('Hidden fields — global config', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['secret'] }))
    return () => teardownApp(app)
  })

  test('global hiddenFields masks value on created event', async ({ assert }) => {
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
    assert.equal(a.newValues!.secret, '******')
  })
})

test.group('Hidden fields — per-model auditMask', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('static auditMask masks both sides of an update diff', async ({ assert }) => {
    class Order extends compose(BaseModel, Auditable) {
      static auditMask = ['stripeIntent']
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare stripeIntent: string | null
    }
    await Order.query().delete() // clean slate; not strictly needed in :memory:
    const order = await Order.create({ title: 'A', stripeIntent: 'pi_old' })
    order.stripeIntent = 'pi_new'
    await order.save()
    const a = await Audit.query()
      .where('auditableType', 'Order')
      .where('event', 'updated')
      .firstOrFail()
    assert.deepEqual(a.oldValues, { stripeIntent: '******' })
    assert.deepEqual(a.newValues, { stripeIntent: '******' })
  })
})

test.group('Hidden fields — union', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['globalSecret'] }))
    return () => teardownApp(app)
  })

  test('global and per-model masks both apply', async ({ assert }) => {
    class Account extends compose(BaseModel, Auditable) {
      static auditMask = ['localSecret']
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare globalSecret: string | null
      @column() declare localSecret: string | null
    }
    const acc = await Account.create({
      name: 'A',
      globalSecret: 'g',
      localSecret: 'l',
    })
    const a = await Audit.query()
      .where('auditableType', 'Account')
      .where('auditableId', acc.id)
      .firstOrFail()
    assert.equal(a.newValues!.name, 'A')
    assert.equal(a.newValues!.globalSecret, '******')
    assert.equal(a.newValues!.localSecret, '******')
  })
})

test.group('Hidden fields — auditExclude precedence', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['password'] }))
    return () => teardownApp(app)
  })

  test('field listed in auditExclude AND hiddenFields is dropped, not masked', async ({
    assert,
  }) => {
    class Account extends compose(BaseModel, Auditable) {
      static auditExclude = ['password']
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare password: string | null
    }
    const acc = await Account.create({ name: 'A', password: 'shouldNotShow' })
    const a = await Audit.query()
      .where('auditableType', 'Account')
      .where('auditableId', acc.id)
      .firstOrFail()
    assert.equal(a.newValues!.name, 'A')
    assert.notProperty(a.newValues!, 'password')
  })
})

test.group('Hidden fields — auditCustom', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['token'] }))
    return () => teardownApp(app)
  })

  test('auditCustom masks old, new, and metadata payloads', async ({ assert }) => {
    class Session extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
    }
    const s = await Session.create({ label: 'login' })
    await s.auditCustom('rotated', {
      old: { token: 'old-tok', label: 'login' },
      new: { token: 'new-tok', label: 'login' },
      metadata: { token: 'tok-in-meta', reason: 'manual' },
    })
    const a = await Audit.query()
      .where('auditableType', 'Session')
      .where('auditableId', s.id)
      .where('event', 'rotated')
      .firstOrFail()
    assert.equal(a.oldValues!.token, '******')
    assert.equal(a.oldValues!.label, 'login')
    assert.equal(a.newValues!.token, '******')
    assert.equal(a.newValues!.label, 'login')
    assert.equal(a.metadata!.token, '******')
    assert.equal(a.metadata!.reason, 'manual')
  })
})

test.group('Hidden fields — metadata is top-level only', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['nested'] }))
    return () => teardownApp(app)
  })

  test('masking is top-level: nested object values are stringified to ******', async ({
    assert,
  }) => {
    class Item extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
    }
    const item = await Item.create({ label: 'x' })
    await item.auditCustom('inspected', {
      metadata: {
        nested: { inner: 'visible' }, // whole object is replaced, NOT recursed
        keep: 'shown',
      },
    })
    const a = await Audit.query()
      .where('auditableType', 'Item')
      .where('event', 'inspected')
      .firstOrFail()
    assert.equal(a.metadata!.nested, '******')
    assert.equal(a.metadata!.keep, 'shown')
  })
})

test.group('Hidden fields — deleted event', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['token'] }))
    return () => teardownApp(app)
  })

  test('deleted event masks values in oldValues snapshot', async ({ assert }) => {
    class Session extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
      @column() declare token: string | null
    }
    const s = await Session.create({ label: 'auth', token: 'secret-tok' })
    await s.delete()
    const a = await Audit.query()
      .where('auditableType', 'Session')
      .where('event', 'deleted')
      .firstOrFail()
    assert.equal(a.oldValues!.label, 'auth')
    assert.equal(a.oldValues!.token, '******')
    assert.isNull(a.newValues)
  })
})
