import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'

test.group('Selectivity', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('filterAttributes applies auditExclude', ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditExclude = ['secret']
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare secret: string
    }
    const filtered = Post.filterAuditAttributes({ id: 1, title: 't', secret: 'x' })
    assert.deepEqual(filtered, { id: 1, title: 't' })
  })

  test('filterAttributes applies auditInclude (wins over exclude)', ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditInclude = ['title']
      static auditExclude = ['title']
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
      @column() declare secret: string
    }
    const filtered = Post.filterAuditAttributes({ id: 1, title: 't', secret: 'x' })
    assert.deepEqual(filtered, { title: 't' })
  })

  test('withoutAudit toggles instance flag for callback duration', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
    }
    const post = new Post()
    assert.isFalse(post.$isAuditDisabled)
    await post.withoutAudit(async () => {
      assert.isTrue(post.$isAuditDisabled)
    })
    assert.isFalse(post.$isAuditDisabled)
  })
})
