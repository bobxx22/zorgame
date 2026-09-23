import { SCENES, type SceneName } from './scenes'

/**
 * The station behind the hero, one frame per phase. All frames stay in the
 * page and cross-fade, so a phase change never waits for a download. The grain
 * over them thins as the signal comes out of the noise.
 */
export function Scene({ name }: { name: SceneName }) {
  return (
    <div className={`scene scene-${name}`} aria-hidden="true">
      {(Object.keys(SCENES) as SceneName[]).map((key) => (
        <img key={key} className={key === name ? 'on' : ''} src={SCENES[key]} alt="" width="1920" height="1072" />
      ))}
      <i className="grain" />
    </div>
  )
}
