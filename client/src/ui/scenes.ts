import after from '../assets/scene/after.webp'
import harbinger from '../assets/scene/harbinger.webp'
import staticScene from '../assets/scene/static.webp'
import valley from '../assets/scene/valley.webp'
import windowScene from '../assets/scene/window.webp'

export const SCENES = {
  static: staticScene,
  harbinger,
  window: windowScene,
  after,
} as const

export type SceneName = keyof typeof SCENES

export const VALLEY_SCENE = valley
