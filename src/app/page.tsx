"use client";

import { useState } from "react";

interface ModelResponse {
  model: string;
  content: string;
  error?: string;
}

interface QueryResult {
  synthesis: string;
  individualResponses: {
    openai: ModelResponse;
    gemini: ModelResponse;
  };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Request failed");
      }

      const data: QueryResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function toggleModel(model: string) {
    setExpandedModel(expandedModel === model ? null : model);
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <div className="w-full max-w-2xl">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          OpenClaw
        </h1>
        <p className="mb-8 text-zinc-500 dark:text-zinc-400">
          Query multiple AI models and get a synthesized answer.
        </p>

        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything..."
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {loading ? "Querying..." : "Ask"}
            </button>
          </div>
        </form>

        {loading && (
          <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-zinc-100" />
            <span className="text-zinc-600 dark:text-zinc-400">
              Querying OpenAI and Gemini...
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Synthesized Answer
              </h2>
              <div className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                {result.synthesis}
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Individual Responses
              </h2>

              {(["openai", "gemini"] as const).map((model) => {
                const response = result.individualResponses[model];
                const isExpanded = expandedModel === model;

                return (
                  <div
                    key={model}
                    className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <button
                      onClick={() => toggleModel(model)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {response.model}
                      </span>
                      <span className="text-zinc-400">
                        {isExpanded ? "\u25B2" : "\u25BC"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        {response.error ? (
                          <p className="text-red-500">{response.error}</p>
                        ) : (
                          <div className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                            {response.content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
