const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

export function requireOpenAiKey(): string | null {
  const key = OPENAI_API_KEY?.trim();
  return key || null;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = requireOpenAiKey();
  if (!key) throw new Error('OPENAI_API_KEY is not configured on Supabase Edge Functions');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const data = json.data as Array<{ embedding: number[]; index: number }>;
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chatJson<T>(messages: ChatMessage[]): Promise<T> {
  const key = requireOpenAiKey();
  if (!key) throw new Error('OPENAI_API_KEY is not configured on Supabase Edge Functions');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI chat failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI returned empty response');
  }
  return JSON.parse(content) as T;
}
