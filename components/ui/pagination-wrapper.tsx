import { Suspense } from 'react'
import { Pagination } from './pagination'

interface PaginationWrapperProps {
  total: number
  pageSize: number
  currentPage: number
}

export function PaginationWrapper(props: PaginationWrapperProps) {
  return (
    <Suspense fallback={null}>
      <Pagination {...props} />
    </Suspense>
  )
}
