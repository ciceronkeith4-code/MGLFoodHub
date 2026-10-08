import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common'

export default function NotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      className="py-20"
      action={
        <Button asChild>
          <Link to="/">Back to stores</Link>
        </Button>
      }
    >
      Mukhang naligaw tayo. The page you're looking for doesn't exist.
    </EmptyState>
  )
}
