/* hq :: app/local
   A record opened by hand, when there is no show host (HQ contract, 2.7): the
   person picks the files of one pack - pack.json, the match journals, the
   diaries - and the show reads them the way it reads the host's. */

import { readEntry, type PackEntry } from '../model/pack.ts'
import type { FileSource } from './library.ts'

export class LocalRecord implements FileSource {
  readonly entry: PackEntry
  readonly #files: Map<string, File>

  private constructor(entry: PackEntry, files: Map<string, File>) {
    this.entry = entry
    this.#files = files
  }

  /** Reads the summary among the picked files; the error's message is a key of the dictionary. */
  static async read(files: readonly File[]): Promise<LocalRecord> {
    const byName = new Map(files.map((f) => [f.name, f]))
    const summary = byName.get('pack.json')
    if (!summary) throw new Error('noPackFile')
    let pack: unknown
    try {
      pack = JSON.parse(await summary.text())
    } catch (cause) {
      throw new Error('badPack', { cause })
    }
    const entry = readEntry({ id: 'local', title: summary.webkitRelativePath.split('/').at(-2) ?? 'pack.json', preset: '', pack })
    if (!entry) throw new Error('badPack')
    return new LocalRecord(entry, byName)
  }

  file(_id: string, name: string): Promise<ArrayBuffer | string> {
    const file = this.#files.get(name)
    if (!file) return Promise.reject(new Error(`${name} is not among the chosen files`))
    return /\.(ndjson|json)$/.test(name) ? file.text() : file.arrayBuffer()
  }
}
