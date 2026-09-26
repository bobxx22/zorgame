import type { PartPlan } from '../config/season'
import type { StageSummary } from './schemas'

/**
 * Rows of the parts bridge: the parts released to this account and, after
 * them, the parts of the plan that have not come yet. The organizer numbers
 * the parts, so a planned part counts as delivered not only by its position
 * but also by its title or a "Частина N" in a released title; a planned part
 * below a released one is not waited for either (parts come in order).
 */
export type BridgeRow = { kind: 'stage'; position: number; stage: StageSummary } | { kind: 'plan'; position: number; plan: PartPlan }

export function bridgeRows(stages: readonly StageSummary[], plan: readonly PartPlan[]): BridgeRow[] {
  const top = Math.max(Number.NEGATIVE_INFINITY, ...stages.map((s) => s.position))
  const waiting = plan.filter((p) => p.position > top && !stages.some((s) => delivers(s, p)))
  const rows: BridgeRow[] = [
    ...stages.map((stage) => ({ kind: 'stage' as const, position: stage.position, stage })),
    ...waiting.map((p) => ({ kind: 'plan' as const, position: p.position, plan: p })),
  ]
  // Stable: the server's order stays for parts with the same position.
  return rows.sort((a, b) => a.position - b.position)
}

function delivers(stage: StageSummary, plan: PartPlan): boolean {
  if (stage.position === plan.position) return true
  const title = normalize(stage.title)
  const planned = normalize(plan.title)
  if (planned !== '' && title.includes(planned)) return true
  const number = /(?:частина|part)\s*(\d{1,2})/u.exec(title)?.[1]
  return number !== undefined && Number(number) === plan.position
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`ʼ]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
