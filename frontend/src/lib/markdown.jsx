/**
 * Minimal, safe Markdown for Copilot answers: paragraphs, headings, lists, tables, code, bold,
 * italic and inline code. Everything is rendered as React text nodes (never raw HTML), and link
 * syntax is shown as plain text, so model output cannot inject markup or create navigation.
 */
import { Fragment } from "react";

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const INLINE = /(\*\*|__)(.+?)\1|`([^`\n]+)`|!?\[([^\]\n]*)\]\(([^)\n]*)\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w])_(?![\s_])(.+?)(?<![\s_])_(?![\w])/;

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isBlockStart(line, next) {
  return FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next));
}

export function parseBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].replace(/#+\s*$/, "").trim() });
      index += 1;
      continue;
    }
    if (line.includes("|") && lines[index + 1] !== undefined && TABLE_SEPARATOR.test(lines[index + 1])) {
      const header = splitRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitRow(lines[index++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const ordered = /^\d/.test(line.match(LIST_ITEM)[2]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(LIST_ITEM);
        if (match) {
          items.push({ text: match[3], depth: Math.min(Math.floor(match[1].replace(/\t/g, "  ").length / 2), 2) });
          index += 1;
        } else if (lines[index].trim() && /^\s{2,}/.test(lines[index]) && items.length) {
          items[items.length - 1].text += ` ${lines[index].trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length && QUOTE.test(lines[index])) body.push(lines[index++].match(QUOTE)[1]);
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }
    const body = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], lines[index + 1])) body.push(lines[index++]);
    blocks.push({ type: "paragraph", text: body.join("\n") });
  }
  return blocks;
}

/** Inline formatting to React nodes; unsupported syntax stays literal text. */
export function renderInline(text, keyPrefix = "i") {
  const nodes = [];
  let rest = String(text ?? "");
  let count = 0;
  while (rest) {
    const match = rest.match(INLINE);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${count++}`;
    if (match[2] !== undefined) nodes.push(<strong key={key}>{renderInline(match[2], key)}</strong>);
    else if (match[3] !== undefined) nodes.push(<code key={key}>{match[3]}</code>);
    else if (match[4] !== undefined) nodes.push(<span key={key}>{match[4]}</span>); // link text only, never a link
    else nodes.push(<em key={key}>{renderInline(match[6] ?? match[7], key)}</em>);
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

function withBreaks(text, key) {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <Fragment key={`${key}-${index}`}>
      {renderInline(line, `${key}-${index}`)}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ));
}

export function Markdown({ text, className = "copilot-md" }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case "heading": {
            // The panel title is the h2, so answer headings start at h3.
            const Heading = block.level <= 3 ? "h3" : "h4";
            return <Heading key={key}>{renderInline(block.text, key)}</Heading>;
          }
          case "code":
            return <pre key={key}><code>{block.text}</code></pre>;
          case "quote":
            return <blockquote key={key}>{withBreaks(block.text, key)}</blockquote>;
          case "table":
            return (
              <div key={key} className="copilot-md__table" role="region" aria-label="Table from the answer" tabIndex={0}>
                <table>
                  <thead>
                    <tr>{block.header.map((cell, cellIndex) => <th key={cellIndex} scope="col">{renderInline(cell, `${key}-h${cellIndex}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.header.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] ?? "", `${key}-${rowIndex}-${cellIndex}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className={item.depth ? `is-depth-${item.depth}` : undefined}>{renderInline(item.text, `${key}-${itemIndex}`)}</li>
                ))}
              </List>
            );
          }
          default:
            return <p key={key}>{withBreaks(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
