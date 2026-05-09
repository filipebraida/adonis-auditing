import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

test.group('Partial masking — backwards compatibility', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('per-model auditMask string[] form still produces full mask', async ({ assert }) => {
    class Account extends compose(BaseModel, Auditable) {
      static auditMask = ['password']
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare password: string | null
    }
    const acc = await Account.create({ name: 'A', password: 'hunter2' })
    const a = await Audit.query()
      .where('auditableType', 'Account')
      .where('auditableId', acc.id)
      .firstOrFail()
    assert.equal(a.newValues!.password, '******')
  })
})

test.group('Partial masking — backwards compatibility (global)', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({ hiddenFields: ['secret'] }))
    return () => teardownApp(app)
  })

  test('global hiddenFields string[] form still produces full mask', async ({ assert }) => {
    class Doc extends compose(BaseModel, Auditable) {
      static table = 'mask_docs'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare secret: string | null
    }
    const d = await Doc.create({ title: 'A', secret: 'top' })
    const a = await Audit.query()
      .where('auditableType', 'Doc')
      .where('auditableId', d.id)
      .firstOrFail()
    assert.equal(a.newValues!.secret, '******')
  })
})

test.group('Partial masking — keep-last', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('keep-last reveals trailing chars, masks the prefix', async ({ assert }) => {
    class Card extends compose(BaseModel, Auditable) {
      static auditMask = { creditCard: { strategy: 'keep-last' as const, n: 4 } }
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
      @column() declare creditCard: string | null
    }
    const c = await Card.create({ label: 'visa', creditCard: '12348765' })
    const a = await Audit.query()
      .where('auditableType', 'Card')
      .where('auditableId', c.id)
      .firstOrFail()
    assert.equal(a.newValues!.creditCard, '****8765')
  })
})

test.group('Partial masking — keep-first', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('keep-first reveals leading chars, masks the suffix', async ({ assert }) => {
    class Token extends compose(BaseModel, Auditable) {
      static auditMask = { code: { strategy: 'keep-first' as const, n: 3 } }
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
      @column() declare code: string | null
    }
    const t = await Token.create({ label: 't', code: 'creditcard' })
    const a = await Audit.query()
      .where('auditableType', 'Token')
      .where('auditableId', t.id)
      .firstOrFail()
    assert.equal(a.newValues!.code, 'cre*******')
  })
})

test.group('Partial masking — custom redact callback', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('custom redact callback receives the original value', async ({ assert }) => {
    class Profile extends compose(BaseModel, Auditable) {
      static auditMask = {
        phone: { redact: (v: unknown) => String(v).slice(0, 3) + '*****' },
      }
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare phone: string | null
    }
    const p = await Profile.create({ name: 'A', phone: '5551234' })
    const a = await Audit.query()
      .where('auditableType', 'Profile')
      .where('auditableId', p.id)
      .firstOrFail()
    assert.equal(a.newValues!.phone, '555*****')
  })
})

test.group('Partial masking — true shorthand', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('record entry set to `true` aliases the literal full mask', async ({ assert }) => {
    class User extends compose(BaseModel, Auditable) {
      static table = 'mask_users'
      static auditMask = { password: true as const }
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare password: string | null
    }
    const u = await User.create({ name: 'A', password: 'pw' })
    const a = await Audit.query()
      .where('auditableType', 'User')
      .where('auditableId', u.id)
      .firstOrFail()
    assert.equal(a.newValues!.password, '******')
  })
})

test.group('Partial masking — per-model wins over global', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    // global says full-mask "apiKey"
    ;({ app } = await setupApp({ hiddenFields: ['apiKey'] }))
    return () => teardownApp(app)
  })

  test('per-model strategy overrides global mask for the same field', async ({ assert }) => {
    class Service extends compose(BaseModel, Auditable) {
      // override global full-mask with a keep-last strategy locally
      static auditMask = { apiKey: { strategy: 'keep-last' as const, n: 4 } }
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare apiKey: string | null
    }
    const s = await Service.create({ name: 'svc', apiKey: 'sk_live_ABCDEFGH' })
    const a = await Audit.query()
      .where('auditableType', 'Service')
      .where('auditableId', s.id)
      .firstOrFail()
    // 16 chars total, last 4 = "EFGH"
    assert.equal(a.newValues!.apiKey, '************EFGH')
  })
})

test.group('Partial masking — short value graceful degrade', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('value shorter than n falls back to full-length asterisks', async ({ assert }) => {
    class Pin extends compose(BaseModel, Auditable) {
      static auditMask = { code: { strategy: 'keep-last' as const, n: 4 } }
      @column({ isPrimary: true }) declare id: number
      @column() declare label: string
      @column() declare code: string | null
    }
    // value length 2 < n=4 -> should not leak the original
    const p = await Pin.create({ label: 'l', code: 'ab' })
    const a = await Audit.query()
      .where('auditableType', 'Pin')
      .where('auditableId', p.id)
      .firstOrFail()
    assert.equal(a.newValues!.code, '**')
  })
})
