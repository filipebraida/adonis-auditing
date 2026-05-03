import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'
import type { AuditingService } from '../src/types.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number
}

test.group('disable scope', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  let auditing: AuditingService
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    auditing = await app.container.make('auditing.manager')
    return () => teardownApp(app)
  })

  test('auditing.disabled(cb) suppresses all audits inside callback', async ({ assert }) => {
    await auditing.disabled(async () => {
      await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
      await Post.create({ title: 'B', status: 'draft', viewCount: 0 })
    })
    const rowAfterDisabled = await Audit.query().count('*', 'count').firstOrFail()
    const countAfterDisabled = Number(rowAfterDisabled.$extras.count)
    assert.equal(countAfterDisabled, 0)

    await Post.create({ title: 'C', status: 'draft', viewCount: 0 })
    const rowAfterEnabled = await Audit.query().count('*', 'count').firstOrFail()
    const countAfterEnabled = Number(rowAfterEnabled.$extras.count)
    assert.equal(countAfterEnabled, 1)
  })

  test('post.withoutAudit(cb) suppresses audits for this instance only', async ({ assert }) => {
    const post = await Post.create({ title: 'A', status: 'draft', viewCount: 0 })
    await post.withoutAudit(async () => {
      post.status = 'published'
      await post.save()
    })
    const updates = await Audit.query().where('auditableId', post.id).where('event', 'updated')
    assert.lengthOf(updates, 0)
  })
})
