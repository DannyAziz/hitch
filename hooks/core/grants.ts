import { atom, read, update, type EngineInterface } from 'claude-code'

// Engine session state survives a mod reload, never the session itself.
const grants = atom({ plugin: 'hitch', key: 'grants' }, [] as string[])

export async function sessionGrants($: EngineInterface): Promise<string[]> {
  return read($, grants)
}

export async function grantSession($: EngineInterface, key: string) {
  await update($, grants, keys => keys.includes(key) ? keys : [...keys, key])
}

export async function revokeGrants($: EngineInterface, key?: string): Promise<string[]> {
  let revoked: string[] = []
  await update($, grants, keys => {
    revoked = keys.filter(k => key === undefined || k === key)
    return keys.filter(k => !revoked.includes(k))
  })
  return revoked
}
