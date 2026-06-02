import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { chatJson, embedTexts } from '../_shared/openai.ts';
import { handleOptions, jsonResponse, requireMemoryAddon, requireUser } from '../_shared/userAuth.ts';

type MatchedChunk = {
  id: string;
  source_type: string;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

type AskBody = { question: string };

type LlmAnswer = {
  answer: string;
  citationRefs: number[];
};

const SYSTEM_PROMPT = `You are a personal working-memory assistant for someone with ADHD. Your job is to answer questions using ONLY the provided context from their notes, tasks, and meeting debriefs.

Rules:
- Be direct and concise. Lead with the status or answer.
- If context is thin, say what you know and what is unclear — do not invent facts.
- Use citation markers like [1] [2] in the answer matching the context block numbers.
- Return JSON: { "answer": "markdown string with [n] citations", "citationRefs": [1, 2] } listing which context blocks you used (1-indexed).
- When asked "where are we at", synthesize status: last known state, open questions, who is involved, suggested next step.
- Prefer recent information when sources conflict.`;

function formatContextBlock(index: number, chunk: MatchedChunk): string {
  const meta = chunk.metadata ?? {};
  const title = typeof meta.title === 'string' ? meta.title : chunk.source_type;
  const typeLabel =
    chunk.source_type === 'note'
      ? 'Note'
      : chunk.source_type === 'task'
        ? 'Task'
        : 'Meeting debrief';
  return `[${index}] (${typeLabel}: ${title})\n${chunk.content}`;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const addonErr = await requireMemoryAddon(auth.admin, auth.user.id);
  if (addonErr) return addonErr;

  if (!Deno.env.get('OPENAI_API_KEY')?.trim()) {
    return jsonResponse(
      { error: 'OPENAI_API_KEY is not configured. Run: supabase secrets set OPENAI_API_KEY=sk-...' },
      503,
    );
  }

  let body: AskBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const question = body.question?.trim();
  if (!question) {
    return jsonResponse({ error: 'question is required' }, 400);
  }

  try {
    const [queryEmbedding] = await embedTexts([question]);

    const { data: chunks, error: matchErr } = await auth.admin.rpc('match_memory_chunks', {
      query_embedding: queryEmbedding,
      match_user_id: auth.user.id,
      match_count: 14,
    });
    if (matchErr) throw new Error(matchErr.message);

    const matched = (chunks ?? []) as MatchedChunk[];
    if (matched.length === 0) {
      return jsonResponse({
        ok: true,
        answer:
          "I don't have anything indexed yet. Open **Memory** and run **Index workspace**, or enable working memory in Profile if you haven't.",
        citations: [],
      });
    }

    const context = matched.map((c, i) => formatContextBlock(i + 1, c)).join('\n\n---\n\n');

    const llm = await chatJson<LlmAnswer>([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Context:\n\n${context}\n\n---\n\nQuestion: ${question}`,
      },
    ]);

    const refs = Array.isArray(llm.citationRefs) ? llm.citationRefs : [];
    const citations = refs
      .map((ref) => matched[ref - 1])
      .filter((c): c is MatchedChunk => !!c)
      .map((c) => ({
        sourceType: c.source_type as 'note' | 'task' | 'debrief',
        sourceId: c.source_id,
        title: typeof c.metadata?.title === 'string' ? c.metadata.title : c.source_type,
        excerpt: c.content.slice(0, 240),
        similarity: c.similarity,
        metadata: c.metadata,
      }));

    return jsonResponse({
      ok: true,
      answer: llm.answer?.trim() || 'No answer generated.',
      citations,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ask failed';
    return jsonResponse({ error: msg }, 500);
  }
});
