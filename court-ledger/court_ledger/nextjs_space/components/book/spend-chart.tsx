'use client'

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export default function SpendChart({ data }: { data: { month: string; spend: number }[] }) {
  return (
    <div className="w-full h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <XAxis dataKey="month" tickLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            width={36}
          />
          <Tooltip wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="spend" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
