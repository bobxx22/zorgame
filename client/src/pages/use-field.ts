import { useEffect, useState } from 'react'
import { useCabinetStore } from '../app/cabinet-context'
import { aliasesOf, parseField, type Field } from '../cabinet/field'

/**
 * The site's draw files. zoria.net sends no CORS headers, so the page reads them
 * through the dev server's proxy (vite.config.ts, `/site`); a build opened
 * without it gets no answer and the roll stays unmarked.
 */
const GROUPS_URL = '/site/draw/groups.json'
const SECOND_URL = '/site/draw/second-stage.json'

export interface FieldState {
  field: Field | null
  /** display name (loose key) -> login, from one's own games */
  aliases: ReadonlyMap<string, string>
  /** why the draw files are not there; null while reading or when they are */
  problem: string | null
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`${url}: ${String(res.status)}`)
  return (await res.json()) as unknown
}

/** Reads the draw files once per visit to the screen, and the names from one's own games when signed in. */
export function useField(): FieldState {
  const store = useCabinetStore()
  const [field, setField] = useState<Field | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [aliases, setAliases] = useState<ReadonlyMap<string, string>>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([readJson(GROUPS_URL, controller.signal), readJson(SECOND_URL, controller.signal)])
      .then(([groups, second]) => {
        const parsed = parseField(groups, second)
        setField(parsed)
        setProblem(parsed ? null : 'файли жеребкування мають незнайому форму')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setProblem(error instanceof Error ? error.message : String(error))
      })
    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!store) return
    let alive = true
    void store.readGames().then((result) => {
      if (alive && result.ok) setAliases(aliasesOf(result.data.items.flatMap((g) => g.opponents)))
    })
    return () => {
      alive = false
    }
  }, [store])

  return { field, aliases, problem }
}
