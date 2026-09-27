import { useMemo } from 'react'
import { inlineText, parseMarkdown, type Block, type Inline } from '../cabinet/markdown'

/** Server text in the network's Markdown subset, rendered as text nodes only (CL-30). */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return <div className="md">{blocks.map((block, i) => renderBlock(block, i))}</div>
}

function renderBlock(block: Block, key: number) {
  switch (block.t) {
    case 'h': {
      const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[block.level - 1] ?? 'h5'
      return <Tag key={key}>{renderInline(block.c)}</Tag>
    }
    case 'p':
      return <p key={key}>{renderInline(block.c)}</p>
    case 'ul':
      return (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      )
    case 'pre':
      return (
        <pre key={key} className="code mono">
          {block.v}
        </pre>
      )
    case 'table': {
      // On a phone each row becomes a card, and a cell names its column itself.
      const labels = block.head.map((cell) => inlineText(cell))
      return (
        <div key={key} className="tbl">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} data-label={labels[i]}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }
}

function renderInline(nodes: Inline[]) {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return node.v
      case 'strong':
        return <strong key={i}>{renderInline(node.c)}</strong>
      case 'code':
        return (
          <code key={i} className="mono">
            {node.v}
          </code>
        )
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.c)}
          </a>
        )
    }
  })
}
