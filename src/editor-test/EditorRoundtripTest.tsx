import { useMemo, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { diffLines, diffChars } from 'diff';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { fixtures, type Fixture } from './fixtures';
import { extractActionItems, type ActionItem } from '../lib/format';

type RoundTripResult = {
  fixture: Fixture;
  output: string;
  error: string | null;
  inputItems: ActionItem[];
  outputItems: ActionItem[];
};

const tasksEqual = (a: ActionItem[], b: ActionItem[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    return (
      item.text === other.text &&
      item.displayText === other.displayText &&
      item.priority === other.priority &&
      item.dueDate === other.dueDate &&
      item.description === other.description
    );
  });
};

const noteFromMarkdown = (id: string, md: string) => ({
  id,
  title: `fixture-${id}`,
  content: md,
  updated_at: new Date().toISOString(),
});

export default function EditorRoundtripTest() {
  // One editor instance is enough — we reuse it for every fixture, since
  // tryParseMarkdownToBlocks / blocksToMarkdownLossy are stateless with respect
  // to the editor's current content.
  const editor = useCreateBlockNote();
  const [liveMd, setLiveMd] = useState(fixtures[fixtures.length - 1].input);

  const results = useMemo<RoundTripResult[]>(() => {
    return fixtures.map((fixture) => {
      try {
        const blocks = editor.tryParseMarkdownToBlocks(fixture.input);
        const output = editor.blocksToMarkdownLossy(blocks);
        const inputItems = extractActionItems([noteFromMarkdown('in', fixture.input)], {
          includeDone: true,
        });
        const outputItems = extractActionItems([noteFromMarkdown('out', output)], {
          includeDone: true,
        });
        return { fixture, output, error: null, inputItems, outputItems };
      } catch (err) {
        return {
          fixture,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          inputItems: [],
          outputItems: [],
        };
      }
    });
  }, [editor]);

  const summary = useMemo(() => {
    const exact = results.filter((r) => r.fixture.input === r.output).length;
    const tasksOk = results.filter((r) => tasksEqual(r.inputItems, r.outputItems)).length;
    return { total: results.length, exact, tasksOk };
  }, [results]);

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '2rem 1.5rem 4rem',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: '#111',
        background: '#fafafa',
        minHeight: '100vh',
      }}
    >
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          BlockNote markdown round-trip verification
        </h1>
        <p style={{ color: '#555', marginTop: 4, marginBottom: 0 }}>
          {summary.exact}/{summary.total} fixtures round-trip with byte-for-byte
          equality. {summary.tasksOk}/{summary.total} preserve{' '}
          <code>extractActionItems()</code> output (the bar that actually
          matters for this app).
        </p>
      </header>

      <section
        style={{
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          padding: '1rem 1.25rem',
          marginBottom: '2rem',
        }}
      >
        <h2 style={{ fontSize: 16, margin: '0 0 0.5rem', fontWeight: 600 }}>
          Live editor (playground)
        </h2>
        <p style={{ color: '#666', fontSize: 13, margin: '0 0 0.75rem' }}>
          A live BlockNote editor, mounted inside React Strict Mode. Type a bit
          and see the current markdown export below.
        </p>
        <div
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: 6,
            background: '#fff',
          }}
        >
          <BlockNoteView
            editor={editor}
            onChange={() => setLiveMd(editor.blocksToMarkdownLossy())}
            theme="light"
          />
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#555' }}>
            Current markdown export
          </summary>
          <pre
            style={{
              background: '#f4f4f5',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              overflow: 'auto',
              marginTop: 8,
            }}
          >
            {liveMd}
          </pre>
        </details>
      </section>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 1rem' }}>
        Fixtures
      </h2>

      {results.map((r) => (
        <FixtureCard key={r.fixture.name} result={r} />
      ))}
    </div>
  );
}

function FixtureCard({ result }: { result: RoundTripResult }) {
  const { fixture, output, error, inputItems, outputItems } = result;
  const exactMatch = fixture.input === output;
  const tasksMatch = tasksEqual(inputItems, outputItems);

  const statusColor = error
    ? '#c02626'
    : exactMatch
      ? '#1f7a3f'
      : tasksMatch
        ? '#a26a00'
        : '#c02626';

  const statusLabel = error
    ? 'ERROR'
    : exactMatch
      ? 'EXACT'
      : tasksMatch
        ? 'LOSSY BUT TASKS OK'
        : 'TASKS BROKEN';

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderLeft: `4px solid ${statusColor}`,
        borderRadius: 8,
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          {fixture.name}
        </h3>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            letterSpacing: 0.4,
          }}
        >
          {statusLabel}
        </span>
      </header>
      <p style={{ color: '#555', fontSize: 13, margin: '0 0 0.75rem' }}>
        {fixture.what}
      </p>

      {error ? (
        <pre
          style={{
            background: '#fef2f2',
            color: '#991b1b',
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflow: 'auto',
          }}
        >
          {error}
        </pre>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <LabeledPre label="input markdown" body={fixture.input} />
            <LabeledPre label="after round-trip" body={output} />
          </div>
          <LineDiff input={fixture.input} output={output} />
          <TaskDiff inputItems={inputItems} outputItems={outputItems} />
        </>
      )}
    </article>
  );
}

function LabeledPre({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          background: '#f8f8f8',
          border: '1px solid #eee',
          padding: 10,
          borderRadius: 4,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          margin: 0,
          minHeight: 40,
        }}
      >
        {body || '(empty)'}
      </pre>
    </div>
  );
}

function LineDiff({ input, output }: { input: string; output: string }) {
  if (input === output) {
    return (
      <div style={{ fontSize: 12, color: '#1f7a3f', marginBottom: 8 }}>
        No textual differences.
      </div>
    );
  }
  const lineParts = diffLines(input, output);
  return (
    <details style={{ marginBottom: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#555' }}>
        Textual diff ({countChanges(input, output)})
      </summary>
      <pre
        style={{
          background: '#f4f4f5',
          padding: 10,
          borderRadius: 4,
          fontSize: 12,
          overflow: 'auto',
          marginTop: 6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {lineParts.map((part, i) => {
          const bg = part.added ? '#dcfce7' : part.removed ? '#fee2e2' : 'transparent';
          const color = part.added ? '#166534' : part.removed ? '#991b1b' : '#333';
          const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
          return (
            <span key={i} style={{ background: bg, color, display: 'block' }}>
              {part.value
                .split('\n')
                .filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''))
                .map((l) => prefix + l)
                .join('\n')}
            </span>
          );
        })}
      </pre>
    </details>
  );
}

function countChanges(a: string, b: string): string {
  const parts = diffChars(a, b);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.length, 0);
  const removed = parts
    .filter((p) => p.removed)
    .reduce((n, p) => n + p.value.length, 0);
  return `+${added} / -${removed} chars`;
}

function TaskDiff({
  inputItems,
  outputItems,
}: {
  inputItems: ActionItem[];
  outputItems: ActionItem[];
}) {
  if (inputItems.length === 0 && outputItems.length === 0) return null;

  const rows = Math.max(inputItems.length, outputItems.length);
  const ok = tasksEqual(inputItems, outputItems);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: ok ? '#1f7a3f' : '#991b1b',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        extractActionItems comparison ({inputItems.length} → {outputItems.length}
        {ok ? ' • identical' : ' • DIVERGENT'})
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          border: '1px solid #eee',
        }}
      >
        <thead>
          <tr style={{ background: '#f8f8f8' }}>
            <Th>#</Th>
            <Th>input: priority</Th>
            <Th>input: due</Th>
            <Th>input: displayText</Th>
            <Th>input: description</Th>
            <Th>output: priority</Th>
            <Th>output: due</Th>
            <Th>output: displayText</Th>
            <Th>output: description</Th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => {
            const a = inputItems[i];
            const b = outputItems[i];
            const rowOk =
              a && b &&
              a.priority === b.priority &&
              a.dueDate === b.dueDate &&
              a.displayText === b.displayText &&
              a.description === b.description;
            return (
              <tr key={i} style={{ background: rowOk ? 'transparent' : '#fef2f2' }}>
                <Td>{i}</Td>
                <Td>{a?.priority ?? '—'}</Td>
                <Td>{a?.dueDate ?? '—'}</Td>
                <Td>{a?.displayText ?? '—'}</Td>
                <Td>{a?.description ? JSON.stringify(a.description) : '—'}</Td>
                <Td>{b?.priority ?? '—'}</Td>
                <Td>{b?.dueDate ?? '—'}</Td>
                <Td>{b?.displayText ?? '—'}</Td>
                <Td>{b?.description ? JSON.stringify(b.description) : '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  border: '1px solid #eee',
  padding: '4px 8px',
  verticalAlign: 'top',
  textAlign: 'left',
};

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ ...cellStyle, fontWeight: 600 }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={cellStyle}>{children}</td>;
}
