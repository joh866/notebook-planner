import Anthropic from '@anthropic-ai/sdk';

// The AI side of the add box (spec §11). The key is read here on the server only and never leaves
// it: not in responses, not in logs.

/** A whole reply: new items, changes to existing ones, and check-ins the text answers (spec §11). */
export interface SortReply {
  items: unknown[];
  changes: unknown[];
  answers: unknown[];
}

/** Sorts one chunk of notes. Resolves to the reply (or just its items), or throws with a short reason. */
export type SortChunk = (system: string, chunk: string) => Promise<unknown[] | SortReply>;

/** Used when `.env` doesn't name a model. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** A failure the result message can show as its reason. */
export class SortError extends Error {}

/** The items in a reply, even if it came wrapped in prose or code fences. */
export function readReply(text: string): unknown[] {
  return readSortReply(text, true).items;
}

/** The JSON object in a reply. It needs an items list, or (unless `needItems`) a changes list. */
export function readSortReply(text: string, needItems = false): SortReply {
  const clean = text.replace(/```(?:json)?/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new SortError('the AI’s reply had no JSON in it');
  let obj: unknown;
  try {
    obj = JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new SortError('the AI’s reply wasn’t valid JSON');
  }
  const { items, changes, answers } = obj as { items?: unknown; changes?: unknown; answers?: unknown };
  if (!Array.isArray(items) && (needItems || !Array.isArray(changes))) throw new SortError('the AI’s reply had no items list');
  return { items: Array.isArray(items) ? items : [], changes: Array.isArray(changes) ? changes : [], answers: Array.isArray(answers) ? answers : [] };
}

/** A short, safe reason for a failed call. API error messages never include the key. */
function reasonFor(err: unknown): string {
  if (err instanceof SortError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'the API key in .env was turned down';
  if (err instanceof Anthropic.PermissionDeniedError) return 'the API key can’t use that model';
  if (err instanceof Anthropic.NotFoundError) return 'the model in .env wasn’t found';
  if (err instanceof Anthropic.RateLimitError) return 'too many requests right now';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'the AI took too long to answer';
  if (err instanceof Anthropic.APIConnectionError) return 'couldn’t reach the AI';
  if (err instanceof Anthropic.APIError) return `the AI service had an error (${err.status ?? 'no status'})`;
  return 'something went wrong calling the AI';
}

/**
 * Sorts chunks with Claude, using ANTHROPIC_API_KEY and ANTHROPIC_MODEL. Without a key, every call
 * fails with a reason, so the add box falls back to the local guess.
 */
export function anthropicSorter(env: NodeJS.ProcessEnv = process.env): SortChunk {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return () => Promise.reject(new SortError('there’s no ANTHROPIC_API_KEY in .env'));
  }
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
  // Haiku 4.5 doesn't take an effort setting. Sorting notes is a quick job, so others use low effort.
  const quick = /haiku/.test(model) ? {} : { output_config: { effort: 'low' as const } };

  return async (system, chunk) => {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: chunk }],
        ...quick,
      });
      if (res.stop_reason === 'refusal') throw new SortError('the AI declined to sort this');
      if (res.stop_reason === 'max_tokens') throw new SortError('the AI’s reply was cut off');
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return readSortReply(text);
    } catch (err) {
      const reason = reasonFor(err);
      console.warn(`AI sorting failed for a chunk: ${reason}`);
      throw new SortError(reason);
    }
  };
}
