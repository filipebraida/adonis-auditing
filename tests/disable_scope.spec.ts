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

  test('auditing.withoutAuditing(cb) suppresses all audits inside callback', async ({ assert }) => {
    await auditing.withoutAuditing(async () => {
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

  test('withAuditing(cb) re-enables auditing inside a withoutAuditing scope', async ({
    assert,
  }) => {
    await auditing.withoutAuditing(async () => {
      assert.isTrue(auditing.isDisabled())
      await auditing.withAuditing(async () => {
        assert.isFalse(auditing.isDisabled())
      })
      assert.isTrue(auditing.isDisabled())
    })
  })

  test('withAuditing(cb) is a no-op when auditing is already enabled', async ({ assert }) => {
    await auditing.withAuditing(async () => {
      assert.isFalse(auditing.isDisabled())
    })
    assert.isFalse(auditing.isDisabled())
  })

  test('withoutAuditing nested inside withAuditing disables again', async ({ assert }) => {
    await auditing.withoutAuditing(async () => {
      await auditing.withAuditing(async () => {
        await auditing.withoutAuditing(async () => {
          assert.isTrue(auditing.isDisabled())
        })
        assert.isFalse(auditing.isDisabled())
      })
    })
  })

  test('audit row is written inside withAuditing even when surrounding scope is disabled', async ({
    assert,
  }) => {
    await auditing.withoutAuditing(async () => {
      // This save must NOT audit — it's inside the disabled scope.
      await Post.create({ title: 'silent', status: 'draft', viewCount: 0 })

      // This save MUST audit — withAuditing escapes the outer disable.
      await auditing.withAuditing(async () => {
        await Post.create({ title: 'loud', status: 'draft', viewCount: 0 })
      })
    })

    const row = await Audit.query().count('*', 'count').firstOrFail()
    const count = Number(row.$extras.count)
    assert.equal(count, 1)

    const audited = await Audit.query().firstOrFail()
    assert.equal(audited.event, 'created')
    assert.deepInclude(audited.newValues, { title: 'loud' })
  })
})
