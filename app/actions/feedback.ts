'use server';

export async function submitFeedback(
  _prevState: { success: boolean; error?: string } | null,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const message = (formData.get('message') as string).trim();
  if (!message) return { success: false, error: 'Message is required.' };

  const res = await fetch('https://api.github.com/repos/hbarudin/audition-aggregator/issues', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Feedback: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
      body: message,
      labels: ['feedback'],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: (err as { message?: string }).message ?? 'Failed to submit.' };
  }

  return { success: true };
}
