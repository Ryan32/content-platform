'use client'
/** A GET form that applies as soon as a filter changes (the Apply button stays for keyboard and no-JS use). */
export default function AutoSubmit({ children, className, action, label }: { children: React.ReactNode; className?: string; action: string; label: string }) {
  return <form method="get" action={action} className={className} aria-label={label}
    onChange={e => (e.currentTarget as HTMLFormElement).requestSubmit()}>{children}</form>
}
