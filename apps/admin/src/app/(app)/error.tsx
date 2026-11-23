'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6">
      <h1 className="text-base font-semibold">This screen could not load</h1>
      <p className="mt-1 text-sm text-fg-2">
        {error.message.includes('Not permitted')
          ? 'Your role does not include access to this screen.'
          : 'The MADP API did not respond as expected. Try again; if it keeps failing, check Connectors & sync or the API health endpoint.'}
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-fg-3">Reference {error.digest}</p> : null}
      <button onClick={reset} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm">
        Try again
      </button>
    </div>
  );
}
