import type ConfigureCommand from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { readFile, writeFile } from 'node:fs/promises'
import { parseTsconfig } from 'get-tsconfig'

export async function configure(command: ConfigureCommand) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'migration.stub', { time: Date.now() })
  await codemods.makeUsingStub(stubsRoot, 'config.stub', {})

  await codemods.updateRcFile((transformer) => {
    transformer.addProvider('@filipebraida/adonis-auditing/auditing_provider')
    transformer.setDirectory('audit_resolvers', 'app/audit_resolvers')
  })

  const path = command.app.makePath('app', 'audit_resolvers')
  await codemods.makeUsingStub(stubsRoot, 'resolvers/ip_address_resolver.stub', { path })
  await codemods.makeUsingStub(stubsRoot, 'resolvers/user_agent_resolver.stub', { path })
  await codemods.makeUsingStub(stubsRoot, 'resolvers/url_resolver.stub', { path })
  await codemods.makeUsingStub(stubsRoot, 'resolvers/user_resolver.stub', { path })

  const packageJsonPath = command.app.makePath('package.json')
  const packageJson = await readFile(packageJsonPath, 'utf-8').then(JSON.parse)
  packageJson.imports = {
    ...packageJson.imports,
    '#audit_resolvers/*': './app/audit_resolvers/*.js',
  }
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), { encoding: 'utf-8' })

  const tsConfigJsonPath = command.app.makePath('tsconfig.json')
  const tsConfigJson = parseTsconfig(tsConfigJsonPath)
  tsConfigJson.compilerOptions = {
    ...tsConfigJson.compilerOptions,
    paths: {
      ...tsConfigJson.compilerOptions?.paths,
      '#audit_resolvers/*': ['./app/audit_resolvers/*.js'],
    },
  }
  await writeFile(tsConfigJsonPath, JSON.stringify(tsConfigJson, null, 2), { encoding: 'utf-8' })
}
