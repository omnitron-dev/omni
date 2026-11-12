let attempts = 0;
export async function init() {
  attempts += 1;
  if (attempts === 1) throw new Error('Index shard temporarily unavailable');
}

export async function search(query) {
  if (query === 'invalid') return {};
  return {
    results: [1, 2].map(id => ({
      id: String(id),
      data: async () => ({
        url: `/docs/${id}`,
        meta: { title: `Configured index result ${id}` },
        excerpt: query,
      }),
    })),
  };
}
