import { test } from '@japa/runner'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { HttpContextFactory, RequestFactory } from '@adonisjs/http-server/factories'
import { HttpContext } from '@adonisjs/core/http'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

/**
 * AdonisJS v6 does not expose a public `HttpContext.run()` for test-time
 * scoping (only `getOrFail` / `runOutsideContext` are public). The internal
 * AsyncLocalStorage is private to the http-server module and is only
 * activated by booting a real Server with `useAsyncLocalStorage: true`.
 *
 * For unit tests of code that calls `HttpContext.get()`, we install our
 * own AsyncLocalStorage and monkey-patch `HttpContext.get` to read from
 * it. The patch is scoped per-call via try/finally so it cannot leak into
 * other tests.
 */
const testCtxStorage = new AsyncLocalStorage<HttpContext>()
async function runWithHttpContext(ctx: HttpContext, callback: () => Promise<void>) {
  const originalGet = HttpContext.get
  HttpContext.get = () => testCtxStorage.getStore() ?? null
  try {
    await testCtxStorage.run(ctx, callback)
  } finally {
    HttpContext.get = originalGet
  }
}

test.group('Forensics — auditComment', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('auditComment populates on create', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = new Post()
    post.title = 'Hello'
    post.auditComment = 'Initial seed'
    await post.save()

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.auditComment, 'Initial seed')
  })

  test('auditComment populates on update', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = await Post.create({ title: 'A' })
    post.title = 'B'
    post.auditComment = 'Title fixed'
    await post.save()

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'updated')
      .firstOrFail()

    assert.equal(a.auditComment, 'Title fixed')
  })

  test('auditComment populates on delete', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = await Post.create({ title: 'C' })
    post.auditComment = 'GDPR removal request #42'
    await post.delete()

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'deleted')
      .firstOrFail()

    assert.equal(a.auditComment, 'GDPR removal request #42')
  })

  test('auditComment is cleared after save (transient)', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = await Post.create({ title: 'D' })
    post.auditComment = 'first save comment'
    post.title = 'D2'
    await post.save()

    // Second save without setting auditComment — should NOT carry over
    post.title = 'D3'
    await post.save()

    const audits = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'updated')
      .orderBy('id', 'asc')

    assert.lengthOf(audits, 2)
    assert.equal(audits[0].auditComment, 'first save comment')
    assert.isNull(audits[1].auditComment)
  })
})

test.group('Forensics — auditCommentRequired enforcement', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('auditCommentRequired = true throws when comment missing', async ({ assert }) => {
    class BankAccount extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts' // reuse existing test table
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const acct = new BankAccount()
    acct.title = 'savings'
    await assert.rejects(() => acct.save(), /requires an audit comment/)
  })

  test('auditCommentRequired = true allows save when comment set', async ({ assert }) => {
    class BankAccount2 extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const acct = new BankAccount2()
    acct.title = 'checking'
    acct.auditComment = 'Account opened by customer #1234'
    await acct.save() // should NOT throw

    const a = await Audit.query()
      .where('auditableType', 'BankAccount2')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.auditComment, 'Account opened by customer #1234')
  })

  test('auditCommentRequired = false (default) does not throw', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = new Post()
    post.title = 'no comment'
    await post.save() // must NOT throw

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.isNull(a.auditComment)
  })

  test('auditCommentRequired does NOT throw inside withoutAudit', async ({ assert }) => {
    class CompliantModel extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new CompliantModel()
    m.title = 'inside-without-audit'
    await m.withoutAudit(async () => {
      await m.save() // must NOT throw
    })

    const audits = await Audit.query().where('auditableType', 'CompliantModel')
    assert.lengthOf(audits, 0, 'no audit should be written')
  })

  test('auditCommentRequired does NOT throw when auditIf returns false', async ({ assert }) => {
    class GatedModel extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static auditIf = () => false
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new GatedModel()
    m.title = 'gated'
    await m.save() // must NOT throw

    const audits = await Audit.query().where('auditableType', 'GatedModel')
    assert.lengthOf(audits, 0)
  })

  test('auditCommentRequired does NOT throw on no-op update', async ({ assert }) => {
    class NoOp extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new NoOp()
    m.title = 'init'
    m.auditComment = 'first'
    await m.save() // creates, with comment

    // Re-save without changing anything (no-op update)
    await m.save() // must NOT throw — nothing changed, no audit

    const updates = await Audit.query().where('auditableType', 'NoOp').where('event', 'updated')
    assert.lengthOf(updates, 0, 'no update audit should be written for no-op')
  })

  test('auditCommentRequired DOES throw on update when actual changes happen', async ({
    assert,
  }) => {
    class StrictModel extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new StrictModel()
    m.title = 'init'
    m.auditComment = 'first'
    await m.save()

    m.title = 'changed' // real dirty change
    await assert.rejects(() => m.save(), /requires an audit comment/)
  })

  test('auditCommentRequired DOES throw on delete when no comment', async ({ assert }) => {
    class DeleteStrict extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new DeleteStrict()
    m.title = 'tbd'
    m.auditComment = 'init'
    await m.save()

    // No comment for delete
    await assert.rejects(() => m.delete(), /requires an audit comment/)
  })
})

test.group('Forensics — auditCustom comment integration', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('auditCustom honors model.auditComment', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const post = await Post.create({ title: 'A' })
    post.auditComment = 'manual: status changed by support'
    await post.auditCustom('status-change', {
      old: { status: 'pending' },
      new: { status: 'approved' },
      tags: ['state'],
    })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'status-change')
      .firstOrFail()

    assert.equal(a.auditComment, 'manual: status changed by support')
  })

  test('auditCustom respects auditCommentRequired', async ({ assert }) => {
    class StrictModel extends compose(BaseModel, Auditable) {
      static auditCommentRequired = true
      static table = 'posts'
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const m = new StrictModel()
    m.title = 'init'
    m.auditComment = 'init comment'
    await m.save()

    // Now try auditCustom WITHOUT setting auditComment — should throw
    await assert.rejects(
      () => m.auditCustom('approved', { tags: ['state'] }),
      /requires an audit comment/
    )
  })
})

test.group('Forensics — requestId', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('requestId populates from ctx.request.id() with x-request-id header', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const request = new RequestFactory().create()
    // RequestFactory does not expose a `headers` merge param; set directly on
    // the underlying IncomingMessage so request.id() can read it.
    ;(request.request.headers as Record<string, string>)['x-request-id'] = 'req-abc-123'
    const ctx = new HttpContextFactory().merge({ request }).create()

    await runWithHttpContext(ctx, async () => {
      await Post.create({ title: 'inside-request' })
    })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.requestId, 'req-abc-123')
  })

  test('requestId is null when no HttpContext (background job)', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    // No HttpContext.run() — Japa default
    await Post.create({ title: 'no-ctx' })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.isNull(a.requestId)
  })

  test('multiple audits in one request share requestId', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const request = new RequestFactory().create()
    ;(request.request.headers as Record<string, string>)['x-request-id'] = 'req-shared-xyz'
    const ctx = new HttpContextFactory().merge({ request }).create()

    await runWithHttpContext(ctx, async () => {
      await Post.create({ title: 'first' })
      const post = await Post.create({ title: 'second' })
      post.title = 'second-updated'
      await post.save()
    })

    const audits = await Audit.query().where('auditableType', 'Post').orderBy('id', 'asc')

    assert.lengthOf(audits, 3) // 2 creates + 1 update
    for (const a of audits) {
      assert.equal(a.requestId, 'req-shared-xyz')
    }
  })
})

test.group('Forensics — combined comment + requestId', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('comment and requestId both populate together', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const request = new RequestFactory().create()
    ;(request.request.headers as Record<string, string>)['x-request-id'] = 'combo-req-1'
    const ctx = new HttpContextFactory().merge({ request }).create()

    await runWithHttpContext(ctx, async () => {
      const post = new Post()
      post.title = 'combo'
      post.auditComment = 'compliance check passed'
      await post.save()
    })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.auditComment, 'compliance check passed')
    assert.equal(a.requestId, 'combo-req-1')
  })
})
