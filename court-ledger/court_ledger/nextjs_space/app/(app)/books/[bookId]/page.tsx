import { BookDetailClient } from '@/components/book/book-detail-client'

export const dynamic = 'force-dynamic'

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params
  return <BookDetailClient bookId={bookId} />
}
