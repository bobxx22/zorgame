/** Scrolls to a section by id: routes may live in the hash, so no #anchors. */
export function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
