'use client'

import { motion } from 'framer-motion'
import { Trophy } from 'lucide-react'

export function AuthShell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl hero-card flex items-center justify-center shadow-lg mb-4">
            <Trophy className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Court Ledger</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">{subtitle}</p>
        </div>
        {children}
      </motion.div>
    </div>
  )
}
