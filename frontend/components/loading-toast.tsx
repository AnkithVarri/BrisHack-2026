"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Progress } from "@/components/ui/progress"

interface LoadingToastProps {
  isVisible: boolean
  message?: string
}

const DEFAULT_MESSAGES = [
  "Analysing data from over 20 satellite powered data signals...",
  "Simulating power efficiency across over 1,000 intervals...",
  "Calibrating irradiance and weather reliability models...",
  "Cross-referencing historical climate patterns...",
  "Generating AI-powered insights for your region...",
]

const INITIAL_PROGRESS = 8
const MAX_VIRTUAL_PROGRESS = 94

export function LoadingToast({ isVisible, message }: LoadingToastProps) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [progress, setProgress] = useState(INITIAL_PROGRESS)

  useEffect(() => {
    if (!isVisible) {
      setMessageIndex(0)
      setProgress(INITIAL_PROGRESS)
      return
    }

    const progressInterval = setInterval(() => {
      setProgress((previous) => {
        if (previous >= MAX_VIRTUAL_PROGRESS) {
          return MAX_VIRTUAL_PROGRESS
        }
        const remaining = MAX_VIRTUAL_PROGRESS - previous
        const step = Math.max(0.25, remaining * 0.05)
        return Number(Math.min(MAX_VIRTUAL_PROGRESS, previous + step).toFixed(1))
      })
    }, 400)

    const messageInterval = setInterval(() => {
      setMessageIndex((previous) => (previous + 1) % DEFAULT_MESSAGES.length)
    }, 4500)

    return () => {
      clearInterval(progressInterval)
      clearInterval(messageInterval)
    }
  }, [isVisible])

  const activeMessage = message ?? DEFAULT_MESSAGES[messageIndex]

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="w-[min(92vw,26rem)] rounded-xl border border-border bg-background/80 px-3.5 pt-3 pb-1.5 shadow-2xl backdrop-blur-sm">
            <div className="mb-2.5 min-w-0">
              <p className="text-sm font-semibold text-foreground">Running solar analysis</p>
              <p className="text-[11px] text-muted-foreground">This may take up to 20 seconds</p>
            </div>

            <Progress
              value={progress}
              className="h-1 bg-green-500/20 [&_[data-slot=progress-indicator]]:bg-green-500"
            />

            <div className="mt-2 min-h-7">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={activeMessage}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="text-[11px] leading-relaxed text-muted-foreground"
                >
                  {activeMessage}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
