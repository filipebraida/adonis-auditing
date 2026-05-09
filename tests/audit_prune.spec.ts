import { test } from '@japa/runner'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { Kernel } from '@adonisjs/core/ace'
import { DateTime } from 'luxon'

import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'
import AuditPrune from '../commands/audit_prune.js'

class Post extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
}

class Item extends compose(BaseModel, Auditable) {
  @column({ isPrimary: true }) declare id: number
  @column() declare label: string
}

async function runPrune(
  app: Awaited<ReturnType<typeof setupApp>>['app'],
  argv: string[]
): Promise<AuditPrune> {
  const kernel = new Kernel(app as any)
  const cmd = await kernel.create(AuditPrune, argv)
  await cmd.run()
  return cmd
}

async function backdate(
  app: Awaited<ReturnType<typeof setupApp>>['app'],
  id: number,
  when: DateTime
): Promise<void> {
  const db = await app.container.make('lucid.db')
  await db
    .connection()
    .from('audits')
    .where('id', id)
    .update({ created_at: when.toSQL({ includeOffset: false }) })
}

test.group('audit:prune command', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('--days deletes only audits older than N days', async ({ assert }) => {
    const oldPost = await Post.create({ title: 'Old' })
    const recentPost = await Post.create({ title: 'New' })

    const oldAudits = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', oldPost.id)
    await backdate(app, oldAudits[0].id, DateTime.now().minus({ days: 100 }))

    const cmd = await runPrune(app, ['--days=90'])
    assert.notEqual(cmd.exitCode, 1)

    const remaining = await Audit.query().orderBy('id', 'asc')
    assert.lengthOf(remaining, 1)
    assert.equal(remaining[0].auditableId, recentPost.id)
  })

  test('--days with --model only affects matching auditableType', async ({ assert }) => {
    await Post.create({ title: 'p' })
    const item = await Item.create({ label: 'c' })

    const allAudits = await Audit.query().orderBy('id', 'asc')
    for (const a of allAudits) {
      await backdate(app, a.id, DateTime.now().minus({ days: 100 }))
    }

    const cmd = await runPrune(app, ['--days=90', '--model=Post'])
    assert.notEqual(cmd.exitCode, 1)

    const remaining = await Audit.query().orderBy('id', 'asc')
    assert.lengthOf(remaining, 1)
    assert.equal(remaining[0].auditableType, 'Item')
    assert.equal(remaining[0].auditableId, item.id)
  })

  test('--dry-run reports count without deleting', async ({ assert }) => {
    await Post.create({ title: 'a' })
    await Post.create({ title: 'b' })
    const all = await Audit.query()
    for (const a of all) {
      await backdate(app, a.id, DateTime.now().minus({ days: 100 }))
    }

    const auditsBefore = await Audit.query()
    const before = auditsBefore.length

    const cmd = await runPrune(app, ['--days=90', '--dry-run'])
    assert.notEqual(cmd.exitCode, 1)

    const auditsAfter = await Audit.query()
    assert.equal(auditsAfter.length, before, 'dry-run must not delete rows')
  })

  test('--keep retains the N most recent audits per (type,id) and prunes older', async ({
    assert,
  }) => {
    const post = await Post.create({ title: 'a' })
    post.title = 'b'
    await post.save()
    post.title = 'c'
    await post.save()
    post.title = 'd'
    await post.save()

    const second = await Post.create({ title: 'x' })

    const cmd = await runPrune(app, ['--keep=2'])
    assert.notEqual(cmd.exitCode, 1)

    const postAudits = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', post.id)
      .orderBy('createdAt', 'desc')
    assert.lengthOf(postAudits, 2)

    const secondAudits = await Audit.query()
      .where('auditableType', 'Post')
      .where('auditableId', second.id)
    assert.lengthOf(secondAudits, 1)
  })

  test('missing both --days and --keep prints a friendly error and exits non-zero', async ({
    assert,
  }) => {
    await Post.create({ title: 'a' })
    const auditsBefore = await Audit.query()
    const before = auditsBefore.length

    const cmd = await runPrune(app, [])
    assert.equal(cmd.exitCode, 1)

    const auditsAfter = await Audit.query()
    assert.equal(auditsAfter.length, before)
  })

  test('command is exported in commands/main.ts and resolvable via getMetaData', async ({
    assert,
  }) => {
    const { getMetaData, getCommand } = await import('../commands/main.js')
    const meta = await getMetaData()
    assert.isAtLeast(meta.length, 1)
    const found = meta.find((m) => m.commandName === 'audit:prune')
    assert.exists(found)
    const ctor = await getCommand(found!)
    assert.equal((ctor as typeof AuditPrune).commandName, 'audit:prune')
  })
})
