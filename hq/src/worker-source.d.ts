/* The built worker (src/worker/indexer.ts) as text: build.mjs supplies it, the
   page starts workers from a blob - the show is one file with no network. */
declare module 'virtual:worker' {
  const source: string
  export default source
}
