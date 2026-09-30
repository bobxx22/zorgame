/* Вибір учасника: наш бот (пресет голови і надбудови), архетип SDK, зразок наказу або наш наказ. */

import type { LabOptions, SeatKind, SeatSpec } from '../../shared/record.ts';

/* надбудови нашого бота у вигляді полів форми */
interface TacticForm {
  fill: boolean;
  charter: string;
  after: number;
  noPact: boolean;
}

/* не задано - типові надбудови бою */
function readTactics(tactics: readonly string[] | undefined, defaults: readonly string[]): TacticForm {
  const out: TacticForm = { fill: false, charter: 'наш', after: 6, noPact: false };
  for (const t of tactics ?? defaults) {
    const [what, charter, after] = t.split(':');
    if (what === 'nopact') out.noPact = true;
    if (what === 'fill' && charter) Object.assign(out, { fill: true, charter, after: Number(after ?? 0) || 0 });
  }
  return out;
}

/* усе вимкнено - явне none: без поля бот грав би з типовими */
function writeTactics(f: TacticForm): string[] {
  const out: string[] = [];
  if (f.fill) out.push(f.after > 0 ? `fill:${f.charter}:${f.after}` : `fill:${f.charter}`);
  if (f.noPact) out.push('nopact');
  return out.length ? out : ['none'];
}

export function SeatEditor({ options, value, onChange, label }: { options: LabOptions; value: SeatSpec; onChange: (s: SeatSpec) => void; label: string }) {
  const encode = (s: SeatSpec) => s.kind + ':' + s.name;
  const tactics = readTactics(value.tactics, options.defaultTactics);
  const setTactics = (next: Partial<TacticForm>) => {
    const t = writeTactics({ ...tactics, ...next });
    /* збіг із типовими - без поля: підпис «типові надбудови», як у бою */
    onChange(t.join(',') === options.defaultTactics.join(',') ? { kind: value.kind, name: value.name } : { ...value, tactics: t });
  };
  return (
    <div className="seat">
      <label className="field">
        <span>{label}</span>
        <select
          value={encode(value)}
          onChange={(e) => {
            const [kind, ...rest] = e.target.value.split(':');
            const next: SeatSpec = { kind: kind as SeatKind, name: rest.join(':') };
            if (next.kind === 'ours' && value.kind === 'ours' && value.tactics) next.tactics = value.tactics;
            onChange(next);
          }}
        >
          <optgroup label="наш бот (голова архетипу + пульс)">
            {options.presets.map((p) => (
              <option key={p} value={'ours:' + p}>
                наш бот · {p}
                {p === options.defaultPreset ? ' (бій)' : ''}
              </option>
            ))}
          </optgroup>
          <optgroup label="архетип SDK (дзеркало)">
            {options.archetypes.map((p) => (
              <option key={p} value={'archetype:' + p}>
                архетип · {p}
              </option>
            ))}
          </optgroup>
          <optgroup label="наказ">
            <option value="our-nakaz:nakaz.yaml">наш наказ (bot/nakaz.yaml)</option>
            {options.nakaz.map((p) => (
              <option key={p} value={'nakaz:' + p}>
                зразок наказу · {p}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {value.kind === 'ours' && (
        <div className="tactics">
          <label title="голова мовчить - команди дає наказ усередині бота; слот лишається за ботом">
            <input type="checkbox" checked={tactics.fill} onChange={() => setTactics({ fill: !tactics.fill })} /> заповнювати простій
          </label>
          {tactics.fill && (
            <>
              <select value={tactics.charter} onChange={(e) => setTactics({ charter: e.target.value })}>
                {options.charters.map((c) => (
                  <option key={c} value={c}>
                    {c === 'наш' ? 'наш наказ' : c}
                  </option>
                ))}
              </select>
              <label title="скільки тактів мовчання голови чекати, перш ніж говорить наказ">
                після{' '}
                <input
                  type="number"
                  min={0}
                  max={1200}
                  value={tactics.after}
                  onChange={(e) => setTactics({ after: Math.max(0, Math.min(1200, Math.floor(Number(e.target.value) || 0))) })}
                  style={{ width: 60 }}
                />{' '}
                тактів
              </label>
            </>
          )}
          <label title="не пропонувати і не приймати угод: податок - 10% доходу кожного такту">
            <input type="checkbox" checked={tactics.noPact} onChange={() => setTactics({ noPact: !tactics.noPact })} /> без угод
          </label>
        </div>
      )}
    </div>
  );
}
