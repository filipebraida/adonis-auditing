import { test } from '@japa/runner'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setupApp, teardownApp } from './helpers.js'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { compose } from '@adonisjs/core/helpers'
import { HttpContextFactory } from '@adonisjs/http-server/factories'
import { HttpContext } from '@adonisjs/core/http'
import Auditable from '../src/auditable/mixin.js'
import Audit from '../src/audit.js'

/**
 * Tenant resolvers depend on HttpContext. Tests that exercise resolver code
 * paths must run inside an HttpContext scope; without one, the resolver is
 * (correctly) skipped. We monkey-patch HttpContext.get for the duration of
 * the callback.
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

test.group('Multitenancy — tenantResolver', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({
      tenantResolver: async () => ({
        default: class {
          async resolve() {
            return 'tenant-foo'
          }
        },
      }),
    }))
    return () => teardownApp(app)
  })

  test('resolver returning string populates audit.tenantId', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const ctx = new HttpContextFactory().create()
    await runWithHttpContext(ctx, async () => {
      await Post.create({ title: 'A' })
    })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.tenantId, 'tenant-foo')
  })
})

test.group('Multitenancy — model.tenantId fallback', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({
      tenantResolver: async () => ({
        default: class {
          async resolve() {
            return null
          }
        },
      }),
    }))
    return () => teardownApp(app)
  })

  test('falls back to model.tenantId when resolver returns null', async ({ assert }) => {
    class TenantedWidget extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare tenantId: string | null
    }

    await TenantedWidget.create({ name: 'A', tenantId: 'tenant-bar' })

    const a = await Audit.query()
      .where('auditableType', 'TenantedWidget')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.tenantId, 'tenant-bar')
  })
})

test.group('Multitenancy — no resolver configured', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp())
    return () => teardownApp(app)
  })

  test('model.tenantId is used when no resolver is configured', async ({ assert }) => {
    class TenantedWidget extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare tenantId: string | null
    }

    await TenantedWidget.create({ name: 'B', tenantId: 'tenant-baz' })

    const a = await Audit.query()
      .where('auditableType', 'TenantedWidget')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.tenantId, 'tenant-baz')
  })

  test('audit.tenantId is null when neither resolver nor model column', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    await Post.create({ title: 'C' })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.isNull(a.tenantId)
  })

  test('numeric model.tenantId coerces to string', async ({ assert }) => {
    class NumericTenanted extends compose(BaseModel, Auditable) {
      static table = 'tenanted_widgets'
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare tenantId: number | null
    }

    await NumericTenanted.create({ name: 'D', tenantId: 42 as any })

    const a = await Audit.query()
      .where('auditableType', 'NumericTenanted')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.tenantId, '42')
    assert.isString(a.tenantId)
  })
})

test.group('Multitenancy — integration', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({
      tenantResolver: async () => ({
        default: class {
          async resolve() {
            return 'tenant-int'
          }
        },
      }),
    }))
    return () => teardownApp(app)
  })

  test('create + update + delete all carry tenantId from resolver', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const ctx = new HttpContextFactory().create()
    await runWithHttpContext(ctx, async () => {
      const post = await Post.create({ title: 'A' })
      post.title = 'B'
      await post.save()
      await post.delete()
    })

    const audits = await Audit.query().where('auditableType', 'Post').orderBy('id', 'asc')

    assert.lengthOf(audits, 3)
    assert.equal(audits[0].event, 'created')
    assert.equal(audits[1].event, 'updated')
    assert.equal(audits[2].event, 'deleted')
    for (const a of audits) {
      assert.equal(a.tenantId, 'tenant-int')
    }
  })
})

test.group('Multitenancy — resolver error paths', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  group.each.setup(async () => {
    ;({ app } = await setupApp({
      tenantResolver: async () => ({
        default: class {
          async resolve(): Promise<string | null> {
            throw new Error('boom')
          }
        },
      }),
    }))
    return () => teardownApp(app)
  })

  test('resolver throwing falls back to model.tenantId', async ({ assert }) => {
    class TenantedWidget extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare tenantId: string | null
    }

    const ctx = new HttpContextFactory().create()
    await runWithHttpContext(ctx, async () => {
      await TenantedWidget.create({ name: 'thrown', tenantId: 'tenant-fallback' })
    })

    const a = await Audit.query()
      .where('auditableType', 'TenantedWidget')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(a.tenantId, 'tenant-fallback')
  })

  test('resolver throwing with no model column results in null', async ({ assert }) => {
    class Post extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare title: string
    }

    const ctx = new HttpContextFactory().create()
    await runWithHttpContext(ctx, async () => {
      await Post.create({ title: 'thrown' })
    })

    const a = await Audit.query()
      .where('auditableType', 'Post')
      .where('event', 'created')
      .firstOrFail()

    assert.isNull(a.tenantId)
  })
})

test.group('Multitenancy — non-HTTP context', (group) => {
  let app: Awaited<ReturnType<typeof setupApp>>['app']
  let resolverCallCount = 0
  group.each.setup(async () => {
    resolverCallCount = 0
    ;({ app } = await setupApp({
      tenantResolver: async () => ({
        default: class {
          async resolve(ctx: any) {
            resolverCallCount++
            // touch ctx.auth — would throw if ctx is null and we got here
            return ctx.auth.user?.organizationId ?? null
          }
        },
      }),
    }))
    return () => teardownApp(app)
  })

  test('tenantResolver is not invoked when no HttpContext (no warn, no throw)', async ({
    assert,
  }) => {
    class TenantedWidget extends compose(BaseModel, Auditable) {
      @column({ isPrimary: true }) declare id: number
      @column() declare name: string
      @column() declare tenantId: string | null
    }

    // No HttpContext.run() — Japa default
    await TenantedWidget.create({ name: 'no-ctx', tenantId: 'fallback-tenant' })

    const a = await Audit.query()
      .where('auditableType', 'TenantedWidget')
      .where('event', 'created')
      .firstOrFail()

    assert.equal(resolverCallCount, 0, 'resolver should NOT have been invoked without HttpContext')
    assert.equal(a.tenantId, 'fallback-tenant', 'should fall back to model.tenantId')
  })
})
