import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'

test.group('Auditable.auditableName', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('defaults to class name', ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
    }
    assert.equal(Post.resolveAuditableName(), 'Post')
  })

  test('honors static auditableName override', ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      static auditableName = 'post_v2'
      @column({ isPrimary: true }) declare id: number
    }
    assert.equal(Post.resolveAuditableName(), 'post_v2')
  })
})
