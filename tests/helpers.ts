import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig as defineLucidConfig } from '@adonisjs/lucid'
import { defineConfig } from '../src/define_config.js'
import AuditingProvider from '../providers/auditing_provider.js'

const BASE_URL = new URL('../', import.meta.url)

export async function setupApp(opts: { hiddenFields?: string[]; auditExclude?: string[] } = {}) {
  const ignitor = new IgnitorFactory()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => Promise.resolve({ default: AuditingProvider }),
        ],
      },
      config: {
        database: defineLucidConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename: ':memory:' },
              useNullAsDefault: true,
              migrations: { paths: ['tests/migrations'] },
            },
          },
        }),
        auditing: defineConfig({
          userResolver: async () => ({
            default: class {
              async resolve() {
                return null
              }
            },
          }),
          resolvers: {},
          hiddenFields: opts.hiddenFields,
          auditExclude: opts.auditExclude,
        }),
      },
    })
    .withCoreConfig()
    .withCoreProviders()
    .create(BASE_URL)

  const app = ignitor.createApp('test')
  await app.init()
  await app.boot()
  await app.start(() => {})

  const db = await app.container.make('lucid.db')
  const { MigrationRunner } = await import('@adonisjs/lucid/migration')
  const migrator = new MigrationRunner(db, app, { direction: 'up', connectionName: 'sqlite' })
  await migrator.run()

  return { app, db }
}

export async function teardownApp(app: Awaited<ReturnType<typeof setupApp>>['app']) {
  await app.terminate()
}
