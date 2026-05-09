# adonis-auditing

Audit your Lucid models with ease — AdonisJS v7 edition.

A maintained MIT continuation of [`@stouder-io/adonis-auditing`](https://github.com/StouderIO/adonis-auditing) (v1.1.8, MIT, archived), modernized for AdonisJS v7 and extended with custom domain events, transaction awareness, diff-only updates, polymorphic actor support, and tag-based categorization.

> **Why this fork?** The original project's successor (`@adogrove/adonis-auditing`) was relicensed to AGPL-3.0-or-later, which is unworkable for many production projects. This package keeps the MIT license.

## Install

```bash
node ace add @filipebraida/adonis-auditing
```

This registers the provider, scaffolds `config/auditing.ts`, the `audits` migration, and four default resolvers (`user`, `ip_address`, `user_agent`, `url`) under `app/audit_resolvers/`.

Then run the migration:

```bash
node ace migration:run
```

## Make a model auditable

```ts
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { Auditable } from '@filipebraida/adonis-auditing'

export default class Post extends compose(BaseModel, Auditable) {
  // Optional: override the value stored in audits.auditable_type
  static auditableName = 'post'

  // Skip these fields from any automatic CRUD audit
  static auditExclude = ['secret']

  // Or whitelist (wins over auditExclude when both set):
  // static auditInclude = ['title', 'status']

  // Mask values with '******' instead of dropping — preserves the
  // event of change but hides the value:
  static auditMask = ['password']

  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare status: 'draft' | 'published'
  @column() declare secret: string | null
  @column() declare password: string
}
```

Create / update / delete are now recorded in the `audits` table. Updates store only the changed fields (diff).

## Project-wide selectivity

The same selectivity options exist at the config level. Globals are unioned with per-model declarations:

```ts
import { defineConfig } from '@filipebraida/adonis-auditing'

export default defineConfig({
  userResolver: () => import('#audit_resolvers/user_resolver'),
  resolvers: { /* ... */ },

  // Drop these from every audit (project-wide). Useful for noise
  // columns like `updatedAt`/`createdAt`. Does not apply to
  // auditCustom payloads.
  auditExclude: ['updatedAt', 'createdAt'],

  // Mask these with '******' in every audit, including auditCustom.
  // Use for cross-cutting sensitive fields.
  hiddenFields: ['password', 'apiKey'],
})
```

Precedence when a field appears in multiple lists:

- `auditInclude` is allow-list — anything not listed is dropped, regardless of other settings.
- `auditExclude` (per-model or global) drops the field; mask never sees it.
- `hiddenFields` / `auditMask` mask whatever survives the exclude step.

## Custom domain events

Beyond CRUD, record arbitrary events — state transitions, views, exports, anything:

```ts
// Pure event, no diff
await post.auditCustom('viewed', { tags: ['view'] })

// State transition with explicit before/after
await post.auditCustom('published', {
  old: { status: 'draft' },
  new: { status: 'published' },
  tags: ['state'],
  metadata: { reason: 'editorial approval' },
})
```

## Tagging audits

Override `auditTags()` to attach extra tags to every audit emitted by a model — anything you want to filter or group by later (tenant scoping, severity flags, domain categories, ...). One common case is linking child records back to a parent in 1-N relationships:

```ts
class OrderItem extends compose(BaseModel, Auditable) {
  @column() declare orderId: number

  override auditTags() {
    return [`order:${this.orderId}`]
  }
}
```

These tags are appended to whatever the call site provides:

```ts
await item.save()                                     // tags: ['mutation', 'order:42']
await item.auditCustom('shipped', { tags: ['ship'] }) // tags: ['ship', 'order:42']
```

Query across the parent's lifetime in one shot — `tags` is a JSON column, so use the operator your driver supports:

```ts
// Postgres
await Audit.query().whereRaw(`tags @> ?::jsonb`, [JSON.stringify(['order:42'])])
```

`auditTags()` may also be `async`, in case you need to await something.

## Skipping audits

```ts
// Per instance:
await post.withoutAudit(async () => {
  post.viewCount += 1
  await post.save()
})

// Globally (e.g., seeders, bulk migrations):
import auditing from '@filipebraida/adonis-auditing/services/main'
await auditing.disabled(async () => {
  await User.createMany(megaSeed)
})
```

## Reading the history

```ts
const timeline = await post.audits().orderBy('id', 'desc')
const stateChanges = await post.audits().where('event', 'published')
const recentViews = await post.audits().where('event', 'viewed').limit(20)
```

`post.audits()` returns a Lucid `ModelQueryBuilder<Audit>` — the full Lucid query API is available.

Each `Audit` row exposes diff helpers:

```ts
const audit = await post.audits().orderBy('id', 'desc').firstOrFail()

audit.changes()            // { title: { old: 'Foo', new: 'Bar' }, ... }
audit.changesFor('title')  // { old: 'Foo', new: 'Bar' }
audit.changedFields()      // ['title']
audit.changesDisplay()     // 'title: "Foo" → "Bar"'
audit.changesDisplay({ labels: { title: 'Title' }, separator: ' to ' })

audit.maskedFields()       // ['password'] when newValues has '******'
audit.hasMaskedFields()    // true if any field was masked at write time
```

## Reacting to audits

```ts
import emitter from '@adonisjs/core/services/emitter'

emitter.on('audit:created', ({ audit }) => {
  if (audit.event === 'published') {
    // notify, propagate, send a webhook, etc.
  }
})
```

## Schema

The `audits` table:

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | PK |
| `user_type` | text, nullable | Polymorphic actor type (model name, `'system'`, etc.) |
| `user_id` | text, nullable | Polymorphic actor id (string supports UUIDs and `'system'`) |
| `event` | text | Free-form (`'created'`, `'updated'`, `'deleted'`, `'published'`, `'viewed'`, ...) |
| `auditable_type` | text | From `static auditableName`, defaults to class name |
| `auditable_id` | bigint | The audited entity's id |
| `old_values` | jsonb, nullable | Diff (update) or full snapshot (delete) or null (create) |
| `new_values` | jsonb, nullable | Diff (update) or full snapshot (create) or null (delete) |
| `tags` | jsonb, nullable | Array of strings — `['mutation']` for CRUD, plus per-call `auditCustom` tags and any `auditTags()` overrides |
| `metadata` | jsonb, nullable | Bag from resolvers (ip, user-agent, url, ...) plus per-call extras |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(auditable_type, auditable_id)`, `(user_type, user_id)`, `(event)`, `(created_at DESC)`.

## Configuration

Edit `config/auditing.ts` to plug in custom resolvers:

```ts
import { defineConfig } from '@filipebraida/adonis-auditing'

export default defineConfig({
  userResolver: () => import('#audit_resolvers/user_resolver'),
  resolvers: {
    ip_address: () => import('#audit_resolvers/ip_address_resolver'),
    user_agent: () => import('#audit_resolvers/user_agent_resolver'),
    url: () => import('#audit_resolvers/url_resolver'),
    // tenant_id: () => import('#audit_resolvers/tenant_id_resolver'),
  },
})
```

Each resolver implements:

```ts
import { HttpContext } from '@adonisjs/core/http'
import type { Resolver } from '@filipebraida/adonis-auditing/types'

export default class TenantIdResolver implements Resolver {
  async resolve(ctx: HttpContext) {
    return ctx.request.header('x-tenant-id')
  }
}
```

The user resolver is special — it returns `{ id: string, type: string } | null`:

```ts
import { HttpContext } from '@adonisjs/core/http'
import type { UserResolver } from '@filipebraida/adonis-auditing/types'

export default class MyUserResolver implements UserResolver {
  async resolve(ctx: HttpContext) {
    const user = ctx.auth.user
    if (!user) return null
    return { type: user.constructor.name, id: String(user.id) }
  }
}
```

## Troubleshooting

### Warning: `adonis-auditing: cannot read HttpContext (asyncLocalStorage disabled?)`

This shows up in your logs when an audit fires outside an HTTP request — e.g., from a queue worker, an ace command, a seeder, or any code path where `HttpContext.get()` returns nothing. The audit row is still written; only the user resolution is skipped, so `user_id` / `user_type` end up null on those rows.

Two common causes:

**1. AsyncLocalStorage is disabled.** AdonisJS uses AsyncLocalStorage to keep `HttpContext` reachable from anywhere inside a request. Make sure it's enabled in `config/app.ts`:

```ts
import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  http: {
    useAsyncLocalStorage: true,
  },
})
```

**2. The code genuinely runs outside an HTTP request.** For workers, scripts, or CLI commands, there is no request to attach a user to. Either accept the null-user audit row, or suppress the audit entirely with `auditing.disabled(...)` (see "Skipping audits" above).

If you want a non-HTTP audit to still record an actor (e.g., a "system" user), use `auditCustom` and write the actor explicitly via `metadata`, since the resolver path requires `HttpContext`.

## License

MIT.

Originally based on [`@stouder-io/adonis-auditing`](https://github.com/StouderIO/adonis-auditing) (MIT). The successor `@adogrove/adonis-auditing` (AGPL-3.0-or-later) is **not** related to this project.
