'use client'
export default function ReaderError({ reset }: { reset: () => void }) {
  return <div className="empty" role="alert"><h1>The library is temporarily unavailable</h1><p>Your changes may not have completed. Please reload the page to check its current state.</p><button onClick={reset}>Try again</button> <a href="/">Back to library</a></div>
}
