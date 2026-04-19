'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // Generic wrapper from the shadcn design system. Association with a form
    // control (`htmlFor`) is the caller's responsibility — it is forwarded
    // via {...props}. Silencing the lint rule here is safe because checking
    // it at this layer would produce false positives every time the
    // component is imported.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Label }
