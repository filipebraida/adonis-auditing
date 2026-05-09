import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

test.group('Audit diff helpers — changes()', () => {
  test('returns object form with old/new for differing fields', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com', name: 'Foo' }
    audit.newValues = { email: 'b@x.com', name: 'Foo' }

    assert.deepEqual(audit.changes(), {
      email: { old: 'a@x.com', new: 'b@x.com' },
      name: { old: 'Foo', new: 'Foo' },
    })
  })

  test('field only in oldValues has new: undefined', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { x: 1 }
    audit.newValues = {}

    assert.deepEqual(audit.changes(), {
      x: { old: 1, new: undefined },
    })
  })

  test('field only in newValues has old: undefined', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = {}
    audit.newValues = { x: 1 }

    assert.deepEqual(audit.changes(), {
      x: { old: undefined, new: 1 },
    })
  })

  test('null oldValues (created event) treated as empty object', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = null
    audit.newValues = { x: 1, y: 'hi' }

    assert.deepEqual(audit.changes(), {
      x: { old: undefined, new: 1 },
      y: { old: undefined, new: 'hi' },
    })
  })

  test('null newValues (deleted event) treated as empty object', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { x: 1 }
    audit.newValues = null

    assert.deepEqual(audit.changes(), {
      x: { old: 1, new: undefined },
    })
  })

  test('both null returns empty object', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = null
    audit.newValues = null

    assert.deepEqual(audit.changes(), {})
  })
})

test.group('Audit diff helpers — changesFor()', () => {
  test('returns shape for present field', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com' }
    audit.newValues = { email: 'b@x.com' }

    assert.deepEqual(audit.changesFor('email'), { old: 'a@x.com', new: 'b@x.com' })
  })

  test('returns undefined for missing field', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com' }
    audit.newValues = { email: 'b@x.com' }

    assert.isUndefined(audit.changesFor('nonexistent'))
  })
})

test.group('Audit diff helpers — changedFields()', () => {
  test('returns union of keys from old and new values', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { a: 1, b: 2 }
    audit.newValues = { b: 3, c: 4 }

    assert.deepEqual(audit.changedFields().sort(), ['a', 'b', 'c'])
  })

  test('returns empty array when both sides null', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = null
    audit.newValues = null

    assert.deepEqual(audit.changedFields(), [])
  })
})

test.group('Audit diff helpers — changesDisplay() default format', () => {
  test('renders field: old → new per line, JSON-stringified', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com', count: 1 }
    audit.newValues = { email: 'b@x.com', count: 2 }

    assert.equal(audit.changesDisplay(), 'email: "a@x.com" → "b@x.com"\ncount: 1 → 2')
  })

  test('renders undefined as the literal string for missing sides', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = null
    audit.newValues = { x: 1 }

    assert.equal(audit.changesDisplay(), 'x: undefined → 1')
  })

  test('renders empty string for empty diff', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = null
    audit.newValues = null

    assert.equal(audit.changesDisplay(), '')
  })
})

test.group('Audit diff helpers — changesDisplay() opts', () => {
  test('labels override field display name', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com' }
    audit.newValues = { email: 'b@x.com' }

    assert.equal(
      audit.changesDisplay({ labels: { email: 'Email Address' } }),
      'Email Address: "a@x.com" → "b@x.com"'
    )
  })

  test('missing label falls through to field name', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com', name: 'Foo' }
    audit.newValues = { email: 'b@x.com', name: 'Bar' }

    assert.equal(
      audit.changesDisplay({ labels: { email: 'Email' } }),
      'Email: "a@x.com" → "b@x.com"\nname: "Foo" → "Bar"'
    )
  })

  test('custom separator replaces default arrow', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { x: 1 }
    audit.newValues = { x: 2 }

    assert.equal(audit.changesDisplay({ separator: ' to ' }), 'x: 1 to 2')
  })
})

test.group('Audit diff helpers — masked fields', () => {
  test('maskedFields returns names of fields with masked sentinel in newValues', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { password: 'old', email: 'a@x.com' }
    audit.newValues = { password: '******', email: 'b@x.com' }

    assert.deepEqual(audit.maskedFields(), ['password'])
  })

  test('maskedFields returns empty array when no field is masked', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { email: 'a@x.com' }
    audit.newValues = { email: 'b@x.com' }

    assert.deepEqual(audit.maskedFields(), [])
  })

  test('maskedFields ignores masked sentinel in oldValues', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { password: '******' }
    audit.newValues = { password: 'new-real-value' }

    assert.deepEqual(audit.maskedFields(), [])
  })

  test('maskedFields handles null newValues', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = { x: 1 }
    audit.newValues = null

    assert.deepEqual(audit.maskedFields(), [])
  })

  test('hasMaskedFields returns true when at least one field is masked', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = {}
    audit.newValues = { password: '******' }

    assert.isTrue(audit.hasMaskedFields())
  })

  test('hasMaskedFields returns false when no field is masked', ({ assert }) => {
    const audit = new Audit()
    audit.oldValues = {}
    audit.newValues = { email: 'b@x.com' }

    assert.isFalse(audit.hasMaskedFields())
  })
})

test.group('Audit diff helpers — integration', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('helpers work on an audit row produced by save lifecycle', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare viewCount: number
    }

    const post = await Post.create({ title: 'Widget', viewCount: 1 })
    post.title = 'Gadget'
    post.viewCount = 5
    await post.save()

    const updateAudit = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'updated')
      .firstOrFail()

    assert.deepEqual(updateAudit.changes(), {
      title: { old: 'Widget', new: 'Gadget' },
      viewCount: { old: 1, new: 5 },
    })
    assert.deepEqual(updateAudit.changesFor('title'), { old: 'Widget', new: 'Gadget' })
    assert.deepEqual(updateAudit.changedFields().sort(), ['title', 'viewCount'])
    assert.equal(updateAudit.changesDisplay(), 'title: "Widget" → "Gadget"\nviewCount: 1 → 5')
    assert.isFalse(updateAudit.hasMaskedFields())
    assert.deepEqual(updateAudit.maskedFields(), [])
  })
})
