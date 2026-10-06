/* lab :: advise
   Why the advisor's order makes sense, in words. The advisor is any bot: it
   gives orders, not reasons, so the reason is read off the situation - only
   what our seat sees (the observe frame and the manifest): the target cell,
   who owns the needle there, distances, prices from the manifest's cfg, the
   rule behind it. In both languages; the panel picks one. */

import type { Hex, Manifest, Observe, Order, SlotName } from '@zoria/protocol';
import type { Bilingual } from '../shared/play.ts';

export interface AdviseContext {
  slot: SlotName;
  obs: Observe;
  man: Manifest;
  hearth: Hex;
  /* where the order came from inside our bot: head, tactic, fill, pulse; '' - another bot */
  src: string;
}

const b = (en: string, uk: string): Bilingual => ({ en, uk });
const join = (...parts: Bilingual[]): Bilingual => ({ en: parts.map((p) => p.en).join(' '), uk: parts.map((p) => p.uk).join(' ') });
const dist = (a: Hex, c: Hex): number => (Math.abs(a.q - c.q) + Math.abs(a.r - c.r) + Math.abs(a.q + a.r - c.q - c.r)) / 2;
const at = (h: Hex): string => `(${h.q}, ${h.r})`;
const same = (a: Hex, c: Hex): boolean => a.q === c.q && a.r === c.r;

/* Ukrainian number agreement: 1 клітину, 2 клітини, 5 клітин */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
/* after a verb or "за": іде 1 клітину / 2 клітини / 5 клітин */
const kl = (n: number): string => `${n} ${plural(n, 'клітину', 'клітини', 'клітин')}`;
/* a count on its own: (1 клітина, 2 клітини, 5 клітин) */
const klN = (n: number): string => `${n} ${plural(n, 'клітина', 'клітини', 'клітин')}`;
/* ticks: 1 такт, 2 такти, 5 тактів */
const tk = (n: number): string => `${n} ${plural(n, 'такт', 'такти', 'тактів')}`;

const CRIES: readonly Bilingual[] = [
  b('going for the ring', 'йду в кільце'),
  b('holding my own', 'тримаю своє'),
  b('looking for a pact', 'шукаю угоди'),
  b('looking for peace', 'шукаю миру'),
  b('going for the leader', 'йду на лідера'),
  b('going for the weaker', 'йду на слабшого'),
  b('waiting out the storm', 'пережидаю бурю'),
  b('good game', 'добра гра'),
];

const SOURCE: Record<string, Bilingual> = {
  head: b('Head (economy):', 'Голова (економіка):'),
  tactic: b('Tactic:', 'Надбудова:'),
  fill: b('Filler nakaz:', 'Наказ-заповнювач:'),
  pulse: b('Pulse:', 'Пульс:'),
};

/* who owns the needle on a cell, as far as the seat knows */
type Owner = { kind: 'none' } | { kind: 'ours'; dark: boolean } | { kind: 'ruin' } | { kind: 'keeper'; dark: boolean } | { kind: 'enemy'; who: string; dark: boolean };

export function explain(order: Order, ctx: AdviseContext): Bilingual {
  const head = SOURCE[ctx.src];
  const why = reason(order, ctx);
  return head ? join(head, why) : why;
}

function reason(o: Order, ctx: AdviseContext): Bilingual {
  const { obs, man, slot } = ctx;
  const cfg = man.cfg;
  const num = (key: string, fallback: number): number => (typeof cfg[key] === 'number' ? cfg[key] : fallback);
  const unitOf = (id: string) => obs.mine.units.find((u) => u.id === id);
  const spec = (h: Hex) => man.needles.find((n) => same(n, h));
  const ownerAt = (h: Hex): Owner => {
    const mine = obs.mine.needles.find((n) => same(n, h));
    if (mine) return { kind: 'ours', dark: mine.dark };
    const seen = obs.own.find((e) => same(e, h));
    if (seen) {
      if (seen.owner === null) return { kind: 'ruin' };
      if (seen.owner === 'K') return { kind: 'keeper', dark: seen.dark };
      if (seen.owner === slot) return { kind: 'ours', dark: seen.dark };
      return { kind: 'enemy', who: seen.owner, dark: seen.dark };
    }
    const s = spec(h);
    if (!s) return { kind: 'none' };
    return s.ring ? { kind: 'keeper', dark: false } : { kind: 'ruin' };
  };
  const cls = (c: string) => (c === 'клинок' ? b('Klinok', 'Клинок') : b('Tkach', 'Ткач'));
  const dawnAt = man.dawn.at;
  const beforeDawn = !obs.pub.dawn;
  const insideLine = (h: Hex) => dist(h, man.citadel) <= man.cherta;
  const energy = Math.round(obs.pulse.energy);
  const autonomy = num('autonomy', 40);

  switch (o.kind) {
    case 'move': {
      const u = unitOf(o.unit);
      const target = o.goal ?? { q: o.q, r: o.r };
      const steps = u ? dist(u, target) : 0;
      const who = u ? cls(u.cls) : b('Unit', 'Юнит');
      const name = `${o.unit}`;
      const away =
        u && u.away > 0
          ? b(`It is already ${u.away} of ${autonomy} ticks out of our network.`, `Він уже ${u.away} з ${autonomy} тактів поза нашою мережею.`)
          : b('', '');
      if (o.home) {
        return b(
          `${name} returns to the hearth (${steps} cells): it is ${u?.away ?? 0} ticks out of our network, and the leash is ${autonomy} - a unit that stays out longer is lost.`,
          `${name} повертається до вогнища (${klN(steps)}): він ${tk(u?.away ?? 0)} поза нашою мережею, а повідець - ${autonomy}; хто затримається довше, той гине.`,
        );
      }
      const owner = ownerAt(target);
      const isTkach = u?.cls !== 'клинок';
      const ring = spec(target)?.ring ?? false;
      if (owner.kind === 'ruin' && isTkach) {
        return join(
          b(
            `${name} walks ${steps} cells to the unowned ruin ${at(target)} to capture it: a Tkach standing on a needle heats it, a ruin takes ${num('heatNeedle', 8)} ticks. Each needle of ours adds minutes to the score.`,
            `${name} іде ${kl(steps)} до нічиєї руїни ${at(target)}, щоб захопити її: ткач, що стоїть на голці, гріє її, руїна - ${tk(num('heatNeedle', 8))}. Кожна наша голка додає хвилини до рахунку.`,
          ),
          away,
        );
      }
      if (owner.kind === 'keeper') {
        if (beforeDawn && insideLine(target) && isTkach) {
          return b(
            `${name} heads for the Keeper's needle ${at(target)} inside the line before dawn (tick ${dawnAt}): the Keeper rams Tkachs that heat its ring, so this is risky unless dawn is close.`,
            `${name} іде до голки Ключника ${at(target)} за чертою до зорі (такт ${dawnAt}): Ключник таранить ткачів, що гріють його кільце, тож це ризиковано, якщо зоря ще не близько.`,
          );
        }
        return b(
          `${name} goes to the Keeper's ring needle ${at(target)}: after dawn (tick ${dawnAt}) a ring needle heats like a ruin and its thread pulls ${num('dawnRing', 2)}× - whoever is nearest takes it.`,
          `${name} іде до голки кільця Ключника ${at(target)}: після зорі (такт ${dawnAt}) голка кільця гріється як руїна, а її нитка тягне в ${num('dawnRing', 2)} рази сильніше - бере той, хто ближче.`,
        );
      }
      if (owner.kind === 'enemy' && isTkach) {
        const price = owner.dark ? num('heatDark', 16) : num('heatEnemy', 24);
        return join(
          b(
            `${name} goes ${steps} cells to capture ${owner.who}'s ${owner.dark ? 'dark' : 'lit'} needle ${at(target)}: ${price} ticks of heating${owner.dark ? ' - a dark needle is cheap and nobody pays for it' : ', and the owner may come to defend it'}.`,
            `${name} іде ${kl(steps)} захопити ${owner.dark ? 'темну' : 'горящу'} голку гравця ${owner.who} ${at(target)}: ${tk(price)} прогріву${owner.dark ? ' - темна голка дешева, і за неї ніхто не платить' : ', і власник може прийти її боронити'}.`,
          ),
          away,
        );
      }
      if (owner.kind === 'enemy' && !isTkach) {
        return b(
          `${name} goes ${steps} cells to ${owner.who}'s needle ${at(target)}: from there a Klinok can jam it (its coverage then counts for us) or ram the Tkachs that come to it.`,
          `${name} іде ${kl(steps)} до голки гравця ${owner.who} ${at(target)}: звідти клинок може її глушити (її покриття тоді йде нам) або таранити ткачів, що до неї прийдуть.`,
        );
      }
      if (owner.kind === 'ours') {
        return isTkach
          ? b(
              `${name} goes to our needle ${at(target)}${owner.dark ? ' - it is dark, a Tkach standing there brings it back' : ''}.`,
              `${name} іде до нашої голки ${at(target)}${owner.dark ? ' - вона темна, ткач на ній поверне її' : ''}.`,
            )
          : b(
              `${name} moves to guard our needle ${at(target)}: enemy Tkachs that come to heat it can be rammed cleanly.`,
              `${name} іде стерегти нашу голку ${at(target)}: ворожих ткачів, що прийдуть її гріти, можна чисто таранити.`,
            );
      }
      const find = man.finds.find((f) => same(f, target));
      if (find && (find.kind === 'cache' || find.kind === 'flare')) {
        return find.kind === 'cache'
          ? b(
              `${name} goes ${steps} cells for the cache ${at(target)}: +150 charge (we have ${energy}; above ${num('energyCap', 360)} it burns).`,
              `${name} іде ${kl(steps)} по схованку ${at(target)}: +150 заряду (маємо ${energy}; понад ${num('energyCap', 360)} згоряє).`,
            )
          : b(
              `${name} goes ${steps} cells for the flare ${at(target)}: a token for one free scan.`,
              `${name} іде ${kl(steps)} по спалах ${at(target)}: жетон на один безкоштовний скан.`,
            );
      }
      const near = obs.foe.filter((f) => f.p !== 'K' && dist(f, target) <= 1);
      if (near.length && !isTkach) {
        return b(
          `${name} closes in on enemy units at ${at(target)} (${near.map((f) => f.id).join(', ')}): a Klinok next to them can ram on the next tick.`,
          `${name} підходить до ворожих юнитів біля ${at(target)} (${near.map((f) => f.id).join(', ')}): клинок поруч із ними може таранити наступного такту.`,
        );
      }
      if (beforeDawn && ring === false && dist(target, man.citadel) === man.cherta + 1 && isTkach) {
        return b(
          `${name} waits just beyond the line next to the Keeper's ring for dawn (tick ${dawnAt}): one step and it heats a ring needle first.`,
          `${name} чекає зорі (такт ${dawnAt}) одразу за чертою біля кільця Ключника: один крок - і він перший гріє голку кільця.`,
        );
      }
      return join(
        b(`${name} (${who.en}) moves ${steps} cells to ${at(target)}.`, `${name} (${who.uk.toLowerCase()}) переходить на ${kl(steps)} до ${at(target)}.`),
        isTkach
          ? b('A Tkach out in the open is a target: it is worth it when it leads to a needle or a find.', 'Ткач на відкритому місці - ціль: це варто того, коли веде до голки чи знахідки.')
          : b('A Klinok positions itself between our needles and the enemy.', 'Клинок стає між нашими голками і ворогом.'),
        away,
      );
    }
    case 'needle': {
      const u = unitOf(o.unit);
      const target = { q: o.q, r: o.r };
      const anchors = [ctx.hearth, ...obs.mine.needles.filter((n) => !n.dark)];
      const link = anchors.length ? Math.min(...anchors.map((n) => dist(n, target))) : 99;
      const range = num('linkRange', 5);
      return join(
        b(
          `${o.unit} builds a new needle at ${at(target)}${u ? ` (${dist(u, target)} cells away)` : ''}: ${num('costNeedle', 60)} charge (we have ${energy}), ${num('buildTicks', 8)} ticks of work.`,
          `${o.unit} будує нову голку на ${at(target)}${u ? ` (${klN(dist(u, target))})` : ''}: ${num('costNeedle', 60)} заряду (маємо ${energy}), ${tk(num('buildTicks', 8))} роботи.`,
        ),
        link <= range
          ? b(`It is ${link} cells from our network - within the thread's reach (${range}), so it lights up and pays minutes.`, `Вона за ${kl(link)} від нашої мережі - у межах нитки (${range}), тож засвітиться і даватиме хвилини.`)
          : b(`Careful: ${link} cells from our network, beyond the thread's reach (${range}) - it will stand dark until the network grows to it.`, `Обережно: ${kl(link)} від нашої мережі, далі за нитку (${range}) - стоятиме темною, доки мережа не дотягнеться.`),
      );
    }
    case 'feed':
      return b(
        `${o.unit} feeds our needle (${o.q}, ${o.r}): a fed needle burns brighter, but the Tkach stays bound to it and stops growing the network.`,
        `${o.unit} живить нашу голку (${o.q}, ${o.r}): підживлена голка горить яскравіше, але ткач прив'язаний до неї і більше не росте мережу.`,
      );
    case 'jam': {
      if (!o.target) {
        return o.hold
          ? b(`${o.unit} holds its place.`, `${o.unit} тримає місце.`)
          : b(
              `${o.unit} stops jamming / stands on guard: nothing changes in the world, the Klinok is kept free for the next job.`,
              `${o.unit} знімає заваду / стоїть на варті: у світі нічого не змінюється, клинок вільний для наступної справи.`,
            );
      }
      const target = o.target;
      const owner = ownerAt(target);
      const u = unitOf(o.unit);
      const hold = o.hold ? b('It stays in place to keep the jam.', 'Він стоїть на місці, щоб тримати заваду.') : b('', '');
      if (owner.kind === 'keeper') {
        const fromOutside = u ? dist(u, man.citadel) > man.cherta : false;
        return join(
          fromOutside
            ? b(
                `${o.unit} jams the Keeper's ring needle ${at(target)} from beyond the line: the coverage of a jammed lit needle counts for us (loot, rules 8.7), and jamming from farther than ${man.cherta} cells from the center does not provoke the Keeper (21.7).`,
                `${o.unit} глушить голку кільця Ключника ${at(target)} з-за черти: покриття заглушеної горящої голки йде нам (здобич, правила 8.7), а глушіння далі ніж за ${man.cherta} клітин від центру Ключника не провокує (21.7).`,
              )
            : b(
                `${o.unit} jams a Keeper needle ${at(target)} from inside the line: the Keeper will strike back - a risky move.`,
                `${o.unit} глушить голку Ключника ${at(target)} зсередини черти: Ключник відповість - ризикований хід.`,
              ),
          hold,
        );
      }
      if (owner.kind === 'enemy') {
        return join(
          owner.dark
            ? b(`${o.unit} jams ${owner.who}'s dark needle ${at(target)}: a dark needle gives no loot - it only stops it from coming back.`, `${o.unit} глушить темну голку гравця ${owner.who} ${at(target)}: темна голка здобичі не дає - лише не дає їй повернутися.`)
            : b(
                `${o.unit} jams ${owner.who}'s lit needle ${at(target)}: while the jam holds, its coverage counts for us instead of ${owner.who} (loot, rules 8.7) - minutes taken from a rival.`,
                `${o.unit} глушить горящу голку гравця ${owner.who} ${at(target)}: поки завада тримається, її покриття йде нам, а не ${owner.who} (здобич, правила 8.7) - хвилини, забрані в суперника.`,
              ),
          hold,
        );
      }
      return join(b(`${o.unit} jams ${at(target)}.`, `${o.unit} глушить ${at(target)}.`), hold);
    }
    case 'ram': {
      const foe = obs.foe.find((f) => f.id === o.target);
      const u = unitOf(o.unit);
      if (!foe) return b(`${o.unit} rams ${o.target}, last seen nearby.`, `${o.unit} таранить ${o.target}, якого бачили поруч.`);
      const steps = u ? dist(u, foe) : 0;
      if (foe.cls === 'клинок') {
        return b(
          `${o.unit} rams ${foe.p}'s Klinok ${foe.id} (${steps} cells): Klinok for Klinok - both die; worth it when theirs threatens our Tkachs.`,
          `${o.unit} таранить клинок ${foe.id} гравця ${foe.p} (${klN(steps)}): клинок за клинок - гинуть обидва; варто, коли їхній загрожує нашим ткачам.`,
        );
      }
      const under = ownerAt(foe);
      const working = (under.kind === 'ruin' || under.kind === 'keeper' || under.kind === 'ours' || (under.kind === 'enemy' && under.who !== foe.p));
      return working
        ? b(
            `${o.unit} rams ${foe.p}'s Tkach ${foe.id} (${steps} cells) while it heats a needle that is not its own: a clean ram - the Tkach (${num('costTkach', 90)} charge) dies, our Klinok survives (rules 11.7)${under.kind === 'ours' ? ', and our needle is saved' : ''}.`,
            `${o.unit} таранить ткача ${foe.id} гравця ${foe.p} (${klN(steps)}), поки той гріє чужу голку: чистий таран - ткач (${num('costTkach', 90)} заряду) гине, наш клинок живе (правила 11.7)${under.kind === 'ours' ? ', а наша голка вціліла' : ''}.`,
          )
        : b(
            `${o.unit} rams ${foe.p}'s Tkach ${foe.id} (${steps} cells): it is not working right now, so this is a trade - our Klinok (${num('costKlinok', 50)}) dies with their Tkach (${num('costTkach', 90)}).`,
            `${o.unit} таранить ткача ${foe.id} гравця ${foe.p} (${klN(steps)}): він зараз не працює, тож це розмін - наш клинок (${num('costKlinok', 50)}) гине разом із їхнім ткачем (${num('costTkach', 90)}).`,
          );
    }
    case 'halt': {
      const u = unitOf(o.unit);
      if (ctx.src === 'pulse' || !u?.task) {
        return b(
          `Keep-alive: a free order that changes nothing. Six ticks without an accepted order and the nakaz takes the slot (rules 23.2).`,
          `Підтримка слоту: безкоштовна команда, що нічого не змінює. Шість тактів без прийнятої команди - і слот бере наказ (правила 23.2).`,
        );
      }
      return b(`${o.unit} drops its current task and waits for a new one.`, `${o.unit} кидає поточну задачу і чекає нової.`);
    }
    case 'yard': {
      const tkach = o.cls === 'ткач';
      const cost = tkach ? num('costTkach', 90) : num('costKlinok', 50);
      const weight = obs.mine.units.reduce((s, u) => s + (u.cls === 'ткач' ? num('weightTkach', 2) : num('weightKlinok', 1)), 0);
      const tail = b(
        `Price ${cost} charge (we have ${energy}), weight ${tkach ? num('weightTkach', 2) : num('weightKlinok', 1)}: the swarm is ${weight}/${num('squadWeight', 8)}, ready in ${num('droneBuild', 4)} ticks.`,
        `Ціна ${cost} заряду (маємо ${energy}), вага ${tkach ? num('weightTkach', 2) : num('weightKlinok', 1)}: рій ${weight}/${num('squadWeight', 8)}, готовий за ${tk(num('droneBuild', 4))}.`,
      );
      return tkach
        ? join(b('Order a Tkach: Tkachs capture ruins and build needles - more needles, more minutes.', 'Замовити ткача: ткачі захоплюють руїни і будують голки - більше голок, більше хвилин.'), tail)
        : join(b('Order a Klinok: Klinoks guard our needles, jam rivals\' needles and ram their Tkachs.', 'Замовити клинка: клинки стережуть наші голки, глушать чужі й таранять ворожих ткачів.'), tail);
    }
    case 'watch':
      return ctx.src === 'pulse'
        ? b('Keep-alive: the focus that is already set, repeated so that the slot is not silent.', 'Підтримка слоту: той самий фокус ще раз, щоб слот не мовчав.')
        : b(
            `Focus the eyes on (${o.q}, ${o.r}): when the ears are short, the eyes nearest to the focus stay lit and the far ones go dark first. ${o.keep} ear bytes are set aside for a scan, so the scan never switches off our own vision.`,
            `Фокус очей на (${o.q}, ${o.r}): коли вух бракує, світяться очі, ближчі до фокуса, а дальні гаснуть першими. ${o.keep} байтів вух відкладено на скан, тож скан не вимикає нашого зору.`,
          );
    case 'scan': {
      /* why the head shines here (the engine's botScan): ears do not carry over, so it scans whenever it can
         afford it; the target is where the picture is oldest, movement blips first, then ruins next to a rival's network */
      const center = { q: o.q, r: o.r };
      const blips = obs.noisy.filter((h) => dist(h, center) <= o.rad).length;
      const rivals = man.needles.filter((n) => {
        const owner = ownerAt(n);
        return owner.kind === 'enemy' || (n.start !== null && n.start !== undefined && man.perm[['A', 'B', 'C'].indexOf(n.start)] !== slot);
      });
      const nearRival = rivals.some((n) => dist(n, center) <= o.rad + num('linkRange', 5));
      const ruins = man.needles.filter((n) => dist(n, center) <= o.rad && ownerAt(n).kind === 'ruin').length;
      const why = blips
        ? b(
            `There ${blips === 1 ? 'is a movement blip' : `are ${blips} movement blips`} there: an enemy unit or an echo - a scan tells which.`,
            `Там ${blips === 1 ? 'є відлуння руху' : `є відлуння руху (${blips})`}: ворожий юнит чи луна - скан покаже.`,
          )
        : nearRival
          ? b(
              `Next to a rival's network: ${ruins} ${ruins === 1 ? 'ruin' : 'ruins'} there look free on our map, but that picture is old - a rival may already hold them. The answer tells where to send our Tkachs.`,
              `Поруч із мережею суперника: ${ruins} ${plural(ruins, 'руїна', 'руїни', 'руїн')} там на нашій карті вільні, але картина стара - суперник міг їх уже взяти. Відповідь підкаже, куди слати наших ткачів.`,
            )
          : b(
              `Our picture of this area is the oldest: we have not seen it for a long time.`,
              `Наша картина цієї ділянки найстаріша: ми давно її не бачили.`,
            );
      return join(
        b(
          `Scan radius ${o.rad} at (${o.q}, ${o.r}): for one tick shows every unit and needle owner there.`,
          `Скан радіусом ${o.rad} на (${o.q}, ${o.r}): на один такт показує там усіх юнитів і власників голок.`,
        ),
        why,
        b(
          `It costs no charge - ${num('scanCost', 256)} ear bytes (now ${obs.pulse.ear}) or a flare token; ears refill every tick and do not carry over, unspent bytes burn, so the head scans whenever it can afford it. Skipping it loses only information.`,
          `Заряду не коштує - ${num('scanCost', 256)} байтів вух (зараз ${obs.pulse.ear}) або жетон спалаху; вуха поповнюються щотакту й не накопичуються, невитрачені байти згоряють, тож голова сканує щоразу, коли може. Пропуск втрачає лише інформацію.`,
        ),
      );
    }
    case 'bid': {
      const lot = man.lots[o.lot];
      return b(
        `Bid ${o.amount} charge on lot ${o.lot}${lot ? ` (it opens at tick ${lot.at})` : ''}: the highest bid takes the lot's cells.`,
        `Ставка ${o.amount} заряду на лот ${o.lot}${lot ? ` (відкривається на такті ${lot.at})` : ''}: соти лота бере найвища ставка.`,
      );
    }
    case 'pact': {
      const tax = Math.round(num('pactTax', 0.1) * 100);
      if (o.op === 'break') {
        return b(
          `Break the pact with ${o.to}: the ${tax}% tax stops after ${num('pactBreakDelay', 12)} ticks, and their units are fair game again.`,
          `Розірвати угоду з ${o.to}: податок ${tax}% зникне за ${tk(num('pactBreakDelay', 12))}, і їхні юнити знову законна ціль.`,
        );
      }
      return b(
        `${o.op === 'offer' ? 'Offer' : 'Accept'} a pact ${o.op === 'offer' ? 'to' : 'from'} ${o.to}: partners do not attack each other, but each pays a ${tax}% tax on every tick's income - useful against a runaway leader.`,
        `${o.op === 'offer' ? 'Запропонувати' : 'Прийняти'} угоду ${o.op === 'offer' ? 'гравцеві' : 'від'} ${o.to}: партнери не нападають одне на одного, але кожен платить ${tax}% доходу кожного такту - корисно проти лідера, що відривається.`,
      );
    }
    case 'cry': {
      const phrase = CRIES[o.phrase] ?? b(String(o.phrase), String(o.phrase));
      return b(`Cry «${phrase.en}»: a public signal to the other players.`, `Клич «${phrase.uk}»: публічний сигнал іншим гравцям.`);
    }
  }
}
