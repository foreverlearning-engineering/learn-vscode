// The verified first-tutor prompt, read from the docs snapshot bundled with the server, so the
// command copies exactly what the server's first-tutor prompt serves.
export interface SnapshotKits {
  kits: { id: string; state: string; mcp_prompt: string | null; prompt: string; where_to_run?: string }[];
}

export function firstTutorKit(snapshot: SnapshotKits): { prompt: string; whereToRun: string } | undefined {
  const kit = snapshot.kits.find((k) => k.mcp_prompt === 'first-tutor' && k.state === 'verified' && k.prompt.trim() !== '');
  return kit ? { prompt: kit.prompt, whereToRun: kit.where_to_run ?? '' } : undefined;
}
