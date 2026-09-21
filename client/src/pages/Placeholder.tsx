interface PlaceholderProps {
  title: string
  items: string[]
}

/** Stand-in for a screen that is not built yet; lists what it will show. */
export function Placeholder({ title, items }: PlaceholderProps) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className="muted">Екран у розробці. Тут буде:</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
