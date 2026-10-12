/* hq :: view/dom
   The two ends of the contract in the markup (part3/01-hq-contract.md, sections
   3 and 4): value anchors the show writes, and controls it is driven through.
   Both are elements with a `data-zaria` name; a field is a control, anything
   else with that name is an anchor - except buttons, which are controls too. */

import type { Answers } from '../app/answers.ts'

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const isField = (el: Element): el is Field => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement

/** Writes anchor values; an element is touched only when its value changed. */
export class Anchors {
  readonly #nodes = new Map<string, HTMLElement[]>()
  readonly #shown = new Map<string, string>()

  constructor(root: ParentNode) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-zaria]')) {
      if (isField(el) || el instanceof HTMLButtonElement) continue
      const name = el.dataset.zaria ?? ''
      const list = this.#nodes.get(name)
      if (list) list.push(el)
      else this.#nodes.set(name, [el])
    }
  }

  show(values: Answers): void {
    for (const [name, nodes] of this.#nodes) {
      const value = (values as Record<string, string | undefined>)[name] ?? ''
      if (this.#shown.get(name) === value) continue
      this.#shown.set(name, value)
      for (const el of nodes) el.textContent = value
    }
  }
}

/**
 * Binds a control: a field answers to typing, a change and Enter (the driver
 * does all three, a person does any), a button to a click with its own
 * `data-zaria-value`. The listeners live until `signal` is aborted.
 */
export function bindControl(root: ParentNode, name: string, act: (value: string) => void, signal: AbortSignal): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-zaria="${name}"]`)) {
    if (isField(el)) {
      const run = (): void => {
        act(el.value)
      }
      el.addEventListener('input', run, { signal })
      el.addEventListener('change', run, { signal })
      el.addEventListener(
        'keydown',
        (event) => {
          if ((event as KeyboardEvent).key === 'Enter') run()
        },
        { signal },
      )
    } else if (el instanceof HTMLButtonElement) {
      el.addEventListener(
        'click',
        () => {
          act(el.dataset.zariaValue ?? '')
        },
        { signal },
      )
    }
  }
}

/** The field of a control, to mirror the show's state into it. */
export function fieldOf(root: ParentNode, name: string): Field | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-zaria="${name}"]`)) if (isField(el)) return el
  return null
}

/** Mirrors a value into a field the person is not typing in. */
export function mirror(field: Field | null, value: string): void {
  if (!field || field.value === value || document.activeElement === field) return
  field.value = value
}

/** Replaces the options of a list or of a datalist. */
export function setOptions(list: HTMLSelectElement | HTMLDataListElement | null, options: readonly { value: string; label: string }[]): void {
  if (!list) return
  list.replaceChildren(
    ...options.map((o) => {
      const el = document.createElement('option')
      el.value = o.value
      el.textContent = o.label
      return el
    }),
  )
}
