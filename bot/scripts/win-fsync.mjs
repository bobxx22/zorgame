/*
 * Windows cannot fsync a directory handle: Node answers EPERM, and the
 * record store of @zoria/server syncs its directories after every write, so
 * a local pack stops after the first match. On Windows only, and only for a
 * directory, the sync becomes a no-op; files are synced as before. Linux and
 * macOS are left untouched.
 *
 *   npm run play:win -- --fast     (package.json: node --import ./scripts/win-fsync.mjs ... pack)
 */
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

if (process.platform === 'win32') {
  const fsyncSync = fs.fsyncSync
  fs.fsyncSync = (fd) => {
    try {
      fsyncSync(fd)
    } catch (error) {
      if (error?.code === 'EPERM' && fs.fstatSync(fd).isDirectory()) return
      throw error
    }
  }
  syncBuiltinESMExports()
}
