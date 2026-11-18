'use client'
export default function ReaderError({ reset }: { reset: () => void }) {
  return <section className="panel empty" role="alert"><h1>The library is temporarily unavailable</h1>
    <p>Your last action may not have completed. Reload the page to check its current state.</p>
    <div className="actions"><button className="btn-primary" onClick={reset}>Try again</button><a className="btn-ghost" href="/">Back to library</a></div></section>
}
