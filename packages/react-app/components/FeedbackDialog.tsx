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
      <DialogContent className="bg-white text-gray-900">
        <DialogTitle>{title}</DialogTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <DialogFooter>
          <Button onClick={onClose} title={'Close'}       className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
