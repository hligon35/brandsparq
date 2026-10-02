const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      (payload as { error?: string } | null)?.error ?? `Request failed: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  getReviewQueue: () => request<{ data: unknown[] }>("/v1/posts/review"),
  approvePost: (postId: string) =>
    request<{ ok: true; status: string }>(`/v1/posts/${postId}/approve`, {
      method: "POST",
    }),
  publishNow: (postId: string) =>
    request<{ ok: true; queued: true }>(`/v1/posts/${postId}/publish-now`, {
      method: "POST",
    }),
};
