'use server'

import { revalidateTag } from 'next/cache'

export async function revalidateDashboard(): Promise<void> {
  revalidateTag('dashboard')
}
