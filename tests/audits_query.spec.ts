import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number
}

test.group('audits() query builder', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('returns ModelQueryBuilder filtered by entity', async ({ assert }) => {
    const post = await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
    post.status = 'published'
    await post.save()
    await post.auditCustom('viewed', { tags: ['view'] })

    const all = await post.audits().orderBy('id', 'asc')
    assert.lengthOf(all, 3) // created + updated + viewed
    assert.deepEqual(
      all.map((a) => a.event),
      ['created', 'updated', 'viewed']
    )

    const states = await post.audits().where('event', 'viewed')
    assert.lengthOf(states, 1)
  })
})
