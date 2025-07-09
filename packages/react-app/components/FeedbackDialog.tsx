/* components/FeedbackDialog.tsx */
'use client'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

export default function FeedbackDialog({
  open,
  title,
  description,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <DialogFooter>
          <Button onClick={onClose} title={'Close'}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
