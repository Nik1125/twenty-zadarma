# Reusable code snippets

Drop-in helpers for callers (n8n, Twenty Workflow HTTP, migration scripts)
that need to write to this App's RICH_TEXT v2 fields without re-implementing
the markdown→BlockNote converter.

## `markdownToBlocknote` — JS (n8n Function node)

Twenty RICH_TEXT v2 fields are shaped `{ markdown: string, blocknote: string | null }`.
Mutations that send only `markdown` render the value as **raw plaintext**
(`**bold**` shows literal asterisks) until the operator manually edits the
field — at which point BlockNote intercepts the keystroke and parses the
markdown. To get formatted rendering on first read, every external write
must include the JSON-stringified `blocknote` payload alongside `markdown`.

This helper does exactly that. It is the plain-JS port of the in-App
TypeScript algorithm in `src/modules/shared/format-markdown-blocknote.ts`.
Copy verbatim into an n8n Function / Code node:

```js
// markdownToBlocknote(md) → { markdown, blocknote }
// Drop into an n8n Function or Code node; the result is a Twenty
// RICH_TEXT v2 payload ready for any updateOne... mutation.
//
// Supported markdown:
//   - paragraphs (separated by blank lines)
//   - inline **bold**, *italic*, _italic_
//   - ## H2 / ### H3 headings (# H1 also handled)
//   - "- bullet" / "* bullet" list items
//   - "---" / "***" horizontal rule

const DEFAULT_PROPS = {
  textColor: 'default',
  backgroundColor: 'default',
  textAlignment: 'left',
};

const uuid = () =>
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  );

const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_)/g;

const parseInline = (text) => {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const pos = m.index ?? 0;
    if (pos > last) out.push({ type: 'text', text: text.slice(last, pos), styles: {} });
    if (m[2] !== undefined) out.push({ type: 'text', text: m[2], styles: { bold: true } });
    else if (m[3] !== undefined) out.push({ type: 'text', text: m[3], styles: { italic: true } });
    else if (m[4] !== undefined) out.push({ type: 'text', text: m[4], styles: { italic: true } });
    last = pos + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), styles: {} });
  return out.length > 0 ? out : [{ type: 'text', text, styles: {} }];
};

const markdownToBlocks = (md) => {
  if (!md || md.trim() === '') return [];
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    if (text) {
      blocks.push({
        id: uuid(),
        type: 'paragraph',
        props: DEFAULT_PROPS,
        content: parseInline(text),
        children: [],
      });
    }
    para = [];
  };
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    if (line === '') { flush(); continue; }
    if (line === '---' || line === '***') {
      flush();
      blocks.push({ id: uuid(), type: 'horizontalRule', props: DEFAULT_PROPS, content: [], children: [] });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flush();
      blocks.push({
        id: uuid(),
        type: 'heading',
        props: { ...DEFAULT_PROPS, level: h[1].length },
        content: parseInline(h[2].trim()),
        children: [],
      });
      continue;
    }
    const b = line.match(/^[-*]\s+(.+)$/);
    if (b) {
      flush();
      blocks.push({
        id: uuid(),
        type: 'bulletListItem',
        props: DEFAULT_PROPS,
        content: parseInline(b[1].trim()),
        children: [],
      });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
};

const markdownToBlocknote = (markdown) => ({
  markdown,
  blocknote: JSON.stringify(markdownToBlocks(markdown)),
});

// USAGE inside an n8n Function node:
//   const richText = markdownToBlocknote(myLlmOutput);
//   return [{ json: { aiBiography: richText } }];
//
// Then in the next HTTP Request node, send aiBiography unchanged as the
// field value in your updateOnePerson / updateOneCallLog mutation.
```

## How to use it inside an HTTP Request node

The Twenty GraphQL mutation receives the full `{ markdown, blocknote }`
object as the field value. Example with `updateOnePerson`:

```graphql
mutation {
  updateOnePerson(
    id: "{{ $json.personId }}"
    data: {
      aiBiography: {
        markdown: {{ JSON.stringify($json.aiBiography.markdown) }}
        blocknote: {{ JSON.stringify($json.aiBiography.blocknote) }}
      }
    }
  ) { id }
}
```

> ⚠ JSON-string escaping inside GraphQL is fiddly. Prefer `bodyParameters`
> with `query` + `variables`, passing `aiBiography` as a typed variable —
> n8n handles escaping automatically.

```js
// Function node before the HTTP Request:
return [{
  json: {
    query: `mutation Update($id: ID!, $bio: RichTextV2Input!) {
      updateOnePerson(id: $id, data: { aiBiography: $bio }) { id }
    }`,
    variables: {
      id: $json.personId,
      bio: markdownToBlocknote($json.markdown),
    },
  },
}];
```

## When to skip the snippet

If your LLM output is plain text (no markdown features), there is no
rendering bug — `{ markdown: 'plain text', blocknote: null }` renders fine.
Only LLM output that contains `**bold**`, `## headings`, `- bullets`, etc.
needs the converter. When in doubt, run it through anyway — the extra
JSON.stringify cost is negligible.

## Limitations

The converter is **non-nested** by design (covers ~95% of LLM output at ~50
LOC). It does not handle:

- nested formatting (`**bold *italic***` will break)
- tables
- code blocks (```)
- links (`[text](url)`)

For any of those, switch to the official `@blocknote/core` npm package
(`parseMarkdownToBlocks`) — but that brings ~100KB of dependencies and
needs n8n configured to allow npm imports in Function nodes.
