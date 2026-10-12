/* The whole path on the acceptance material: the pass of the worker over a real journal
   against the cursor of the SDK asked tick by tick, the way the acceptance driver computes
   its keys (part3/03-record.md, section 3). The record is not in the repository: put it with
   `npx zaria-kit records`, otherwise this test is skipped. */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createEngine } from '@zoria/engine'
import { decodeOrders, readRunLog } from '@zoria/protocol'
import { openJournal } from '@zoria/sdk'
import { readDiary } from '../src/model/belief.ts'
import { MatchIndex } from '../src/model/match.ts'
import { SLOTS, slotIndex } from '../src/model/wire.ts'
import { Pass } from '../src/worker/pass.ts'

const DIR = join(import.meta.dirname, '..', 'records', 'reference')
const MATCH = 2
const TICKS = [0, 1, 30, 299, 300, 640, 1000, 1199, 1200]

test('the pass over the reference journal gives the world the engine gives at any tick', { skip: existsSync(join(DIR, 'pack.json')) ? false : 'no records/reference: npx zaria-kit records' }, () => {
  const bytes = new Uint8Array(readFileSync(join(DIR, `match-${MATCH}.runlog`)))
  const pass = Pass.ofRecord(bytes)
  const index = new MatchIndex(pass.meta)
  index.addFrames(pass.frames, pass.meta.ticks)
  index.addDenies(pass.denies)
  for (let chunk = pass.run(25); chunk; chunk = pass.run(25)) index.addChunk(chunk)
  assert.equal(index.done, pass.meta.ticks)
  assert.equal(pass.finished, true)

  const cursor = openJournal(createEngine, bytes)
  for (const t of TICKS) {
    cursor.seek(t)
    const world = cursor.engine.SIM.world
    SLOTS.forEach((slot, s) => {
      assert.equal(index.scoreAt(s, t), cursor.engine.simScoreBreakdown(slot).total, `score of ${slot} at ${t}`)
      assert.equal(index.needlesAt(s, t), world.needles[slot] ?? 0, `needles of ${slot} at ${t}`)
    })
    const cells = new Set([...Object.keys(world.own), ...index.own.keys()])
    for (const cell of cells) assert.equal(index.ownerAt(cell, t), world.own[cell] || null, `owner of ${cell} at ${t}`)
    const alive = cursor.engine.SIM.units.filter((u) => !u.dead)
    assert.deepEqual(
      index
        .unitsAt(t)
        .map((u) => `${u.id}@${u.q},${u.r}`)
        .sort(),
      alive.map((u) => `${u.id}@${u.q},${u.r}`).sort(),
      `units at ${t}`,
    )
  }

  /* the channel is the journal as it is */
  const log = readRunLog(bytes)
  for (const [t, slot, frame] of log.submits) {
    assert.equal(index.bytesAt(slotIndex(slot), t), frame.length)
    assert.equal(index.ordersAt(slotIndex(slot), t), decodeOrders(frame)?.length ?? 0)
  }
  const denied = (log.denies ?? []).filter((d) => d[0] === 'A' && d[1] === (log.denies ?? [])[0]?.[1])
  assert.equal(index.deniesAt(0, denied[0]?.[1] ?? -1).length, denied.length)
})

test('the belief index gives what a replay of the diary gives', { skip: existsSync(join(DIR, 'pack.json')) ? false : 'no records/reference: npx zaria-kit records' }, () => {
  const text = readFileSync(join(DIR, `belief-${MATCH}.ndjson`), 'utf8')
  const index = readDiary(text)
  assert.equal(index.skipped, 0)
  const frames = text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { t: number; full?: boolean; own?: Record<string, string | null>; dark?: Record<string, boolean> })
  for (const t of TICKS) {
    /* the reading of the record's own document: the last full frame no later than t, then the changes */
    let start = 0
    frames.forEach((f, i) => {
      if (f.full && f.t <= t) start = i
    })
    const own = new Map<string, string | null>()
    const dark = new Map<string, boolean>()
    for (const f of frames.slice(start)) {
      if (f.t > t) break
      for (const [cell, who] of Object.entries(f.own ?? {})) own.set(cell, who)
      for (const [cell, silent] of Object.entries(f.dark ?? {})) dark.set(cell, silent)
    }
    for (const cell of index.own.keys()) assert.equal(index.ownerAt(cell, t), own.get(cell), `belief about ${cell} at ${t}`)
    for (const cell of index.dark.keys()) assert.equal(index.darkAt(cell, t), dark.get(cell) === true, `silence of ${cell} at ${t}`)
  }
})
