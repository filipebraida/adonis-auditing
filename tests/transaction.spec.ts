import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: string
  @column() declare viewCount: number
}

test.group('transactions', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('audit row rolls back when transaction rolls back', async ({ assert }) => {
    const db = await app.container.make('lucid.db')
    const trx = await db.transaction()
    const post = new Post()
    post.useTransaction(trx)
    post.fill({ title: 'A', status: 'draft', viewCount: 0 })
    await post.save()
    await trx.rollback()

    const audits = await Audit.query().count('*', 'count').firstOrFail()
    assert.equal(Number((audits as any).$extras.count), 0)
  })

  test('audit row commits with model when transaction commits', async ({ assert }) => {
    const db = await app.container.make('lucid.db')
    const trx = await db.transaction()
    const post = new Post()
    post.useTransaction(trx)
    post.fill({ title: 'B', status: 'draft', viewCount: 0 })
    await post.save()
    await trx.commit()

    const audits = await Audit.query().count('*', 'count').firstOrFail()
    assert.equal(Number((audits as any).$extras.count), 1)
  })
})
