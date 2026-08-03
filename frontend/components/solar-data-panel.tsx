"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Sun,
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  MapPin,
  Gauge,
  CalendarDays,
  DollarSign,
  PiggyBank,
  Timer,
  BrainCircuit,
  AlertTriangle,
  Lightbulb,
  LineChart as LineChartIcon,
  Info,
  ChevronLeft,
  ChevronRight,
  Pencil,
  PanelRightOpen,
  PanelRightClose,
  CloudSun,
  LayoutGrid,
  Thermometer,
  Eclipse,
  SunDim,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"

// ── Types ──────────────────────────────────────────────

export interface HourlyGraphData {
  hour: string
  efficiency_score: number
  solar_resource: number
  weather_reliability: number
  energy_kwh: number
  irradiance_wm2: number
  is_daylight: boolean
  ambient_temperature_c: number
  cell_temperature_c: number
  energy_efficiency_loss: number
}

export interface MonthlyData {
  month: number
  month_name: string
  average_efficiency_score: number
  total_energy_kwh: number
  average_daily_energy_kwh: number
  average_daylight_hours: number
}

export interface SolarSummary {
  year: number
  total_energy_kwh: number
  average_efficiency_score: number
  best_month: string
  worst_month: string
  panel_area_m2: number
  panel_efficiency_percent: number
  estimated_panel_count?: number
}

export interface SolarData {
  midpoint: { latitude: number; longitude: number }
  year: number
  monthly_data: MonthlyData[]
  summary: SolarSummary
  daily_date?: string
  daily_summary?: {
    peak_efficiency: number
    peak_hour: string
    total_daylight_hours: number
    total_energy_kwh: number
    estimated_panel_count?: number
    shadow_coverage_percent?: number
    albedo?: number
  }
  hourly_data?: HourlyGraphData[]
}

interface SolarDataPanelProps {
  data: SolarData | null
  isOpen: boolean
  onClose: () => void
  onYearChange?: (year: number) => void
  isLoadingYear?: boolean
  signals?: SignalMessage[]
  signalsLoading?: boolean
}

// ── Formatting ─────────────────────────────────────────

function formatEnergy(kwh: number): string {
  if (kwh >= 1_000_000) return `${(kwh / 1_000_000).toFixed(1)} GWh`
  if (kwh >= 1_000) return `${(kwh / 1_000).toFixed(1)} MWh`
  return `${kwh.toFixed(0)} kWh`
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(2)}M`
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(1)}k`
  return `£${amount.toLocaleString()}`
}

// ── Energy comparison ──────────────────────────────────

function getEnergyComparison(kwh: number): string {
  const ukHomesPerYear = 3_800 // avg UK home uses ~3,800 kWh/year
  const evMilesPerKwh = 3.5 // avg EV gets ~3.5 miles per kWh
  const phonesPerKwh = 100 // ~100 phone charges per kWh
  const treeEquivalentKg = 21 // 1 tree absorbs ~21 kg CO₂/year
  const co2PerKwh = 0.233 // kg CO₂ saved per kWh (vs grid)

  const homes = kwh / ukHomesPerYear
  const evMiles = kwh * evMilesPerKwh
  const phoneCharges = kwh * phonesPerKwh
  const treesEquivalent = (kwh * co2PerKwh) / treeEquivalentKg

  if (kwh >= 5_000_000_000) {
    return `Equivalent to powering a small country for a year`
  }
  if (kwh >= 500_000_000) {
    return `Equivalent to powering a city of ${(homes / 1_000_000).toFixed(1)}M homes`
  }
  if (kwh >= 10_000_000) {
    return `Could power ~${Math.round(homes).toLocaleString()} homes for a year`
  }
  if (kwh >= 100_000) {
    return `Could power ~${Math.round(homes).toLocaleString()} homes or drive an EV ${(evMiles / 1_000_000).toFixed(1)}M miles`
  }
  if (kwh >= 10_000) {
    return `Could power ~${Math.round(homes).toLocaleString()} homes — equivalent to planting ${Math.round(treesEquivalent).toLocaleString()} trees`
  }
  if (kwh >= 1_000) {
    return `Equivalent to ${Math.round(phoneCharges).toLocaleString()} phone charges or driving an EV ${Math.round(evMiles).toLocaleString()} miles`
  }
  return `Equivalent to ~${Math.round(phoneCharges).toLocaleString()} phone charges`
}

// ── Mock data generators ───────────────────────────────

function generateMockROI(data: SolarData, electricityRate: number, installCostPerM2: number) {
  const annualEnergy = data.summary.total_energy_kwh
  const annualSavings = annualEnergy * electricityRate
  const totalInstallCost = data.summary.panel_area_m2 * installCostPerM2
  const paybackYears = totalInstallCost / annualSavings
  const roi25Year = ((annualSavings * 25 - totalInstallCost) / totalInstallCost) * 100

  const cumulativeSavings = Array.from({ length: 26 }, (_, i) => ({
    year: i,
    savings: Math.round(annualSavings * i),
    cost: totalInstallCost,
  }))

  return {
    totalInstallCost: Math.round(totalInstallCost),
    annualSavings: Math.round(annualSavings),
    paybackYears: Number(paybackYears.toFixed(1)),
    roi25Year: Number(roi25Year.toFixed(0)),
    electricityRate,
    cumulativeSavings,
    carbonOffsetKg: Math.round(annualEnergy * 0.233),
  }
}

function generateMockPredictions(data: SolarData) {
  const baseEnergy = data.summary.total_energy_kwh
  const baseEfficiency = data.summary.average_efficiency_score

  return Array.from({ length: 10 }, (_, i) => {
    const year = data.year + i
    const degradation = Math.pow(0.995, i)
    const climateBoost = 1 + i * 0.002
    return {
      year,
      energy: Math.round(baseEnergy * degradation * climateBoost),
      efficiency: Number((baseEfficiency * 100 * degradation).toFixed(1)),
      degradation: Number(((1 - degradation) * 100).toFixed(1)),
    }
  })
}

export interface SignalMessage {
  id: string
  type: "info" | "warning" | "tip" | "climate"
  title: string
  content: string
}

// generateMockSignals removed — signals now come from /solar/signals API

// ── Shared tooltip style ───────────────────────────────

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
  cursor: { fill: "rgba(255,255,255,0.05)" },
}

// ── Helpers ────────────────────────────────────────────

function MetricRow({
  label,
  value,
  icon: Icon,
  iconColor,
  tooltip,
}: {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
  iconColor?: string
  tooltip?: string
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon && <Icon className={`h-3.5 w-3.5 ${iconColor ?? ""}`} />}
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px] text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function SignalItem({ signal }: { signal: SignalMessage }) {
  const config = {
    info: { icon: Info, color: "text-sky-400", dotColor: "bg-sky-400" },
    warning: { icon: AlertTriangle, color: "text-amber-400", dotColor: "bg-amber-400" },
    tip: { icon: Lightbulb, color: "text-emerald-400", dotColor: "bg-emerald-400" },
    climate: { icon: CloudSun, color: "text-violet-400", dotColor: "bg-violet-400" },
  }[signal.type]

  const Icon = config.icon

  return (
    <div className="py-3.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`block h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        <span className="text-sm font-medium text-foreground">{signal.title}</span>
      </div>
      <p className="pl-5 text-xs leading-relaxed text-muted-foreground">{signal.content}</p>
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-3 justify-center">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

function TabSkeleton() {
  return (
    <div className="space-y-5 px-5 pb-6 pt-4">
      {/* Metric rows skeleton */}
      <div>
        <Skeleton className="mb-3 h-3 w-24" />
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-3.5 rounded-full" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div>
        <Skeleton className="mb-3 h-3 w-40" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────

export function SolarDataPanel({ data, isOpen, onClose, onYearChange, isLoadingYear, signals: signalsProp = [], signalsLoading: signalsLoadingProp = false }: SolarDataPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [electricityRate, setElectricityRate] = useState(0.34)
  const [installCostPerM2, setInstallCostPerM2] = useState(250)
  const [editField, setEditField] = useState<"electricity" | "install" | null>(null)
  const [editValue, setEditValue] = useState("")

  const openEdit = (field: "electricity" | "install") => {
    setEditField(field)
    setEditValue(field === "electricity" ? electricityRate.toString() : installCostPerM2.toString())
  }

  const saveEdit = () => {
    const parsed = parseFloat(editValue)
    if (isNaN(parsed) || parsed <= 0) { setEditField(null); return }
    if (editField === "electricity") setElectricityRate(parsed)
    if (editField === "install") setInstallCostPerM2(parsed)
    setEditField(null)
  }

  // Streaming reveal for signals
  const [visibleSignals, setVisibleSignals] = useState(0)
  const prevSignalsLenRef = useRef(0)

  useEffect(() => {
    if (signalsProp.length === 0) {
      setVisibleSignals(0)
      prevSignalsLenRef.current = 0
      return
    }
    // Only animate when new signals arrive
    if (signalsProp.length !== prevSignalsLenRef.current) {
      prevSignalsLenRef.current = signalsProp.length
      setVisibleSignals(0)
      let count = 0
      const interval = setInterval(() => {
        count++
        setVisibleSignals(count)
        if (count >= signalsProp.length) clearInterval(interval)
      }, 600)
      return () => clearInterval(interval)
    }
  }, [signalsProp])

  if (!data) return null

  const chartData = data.monthly_data.map((m) => ({
    name: m.month_name.slice(0, 3),
    energy: m.total_energy_kwh,
    efficiency: m.average_efficiency_score * 100,
    daylight: m.average_daylight_hours,
  }))

  const roi = generateMockROI(data, electricityRate, installCostPerM2)
  const predictions = generateMockPredictions(data)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
        {/* Collapsed tab */}
        {isCollapsed && (
          <motion.button
            key="collapsed-tab"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={() => setIsCollapsed(false)}
            className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-3 shadow-2xl transition-colors hover:bg-secondary"
          >
            <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
            <div className="text-left">
              <p className="text-xs font-semibold text-foreground">{formatEnergy(data.summary.total_energy_kwh)}</p>
              <p className="text-[10px] text-muted-foreground">{data.year} Analysis</p>
            </div>
          </motion.button>
        )}

        {/* Expanded panel */}
        {!isCollapsed && (
        <motion.aside
          key="expanded-panel"
          initial={{ x: "110%" }}
          animate={{ x: 0 }}
          exit={{ x: "110%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed right-4 top-4 bottom-4 z-50 w-[26rem] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        >
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-foreground">Solar Analysis</h2>
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                  {data.year}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsCollapsed(true)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <Separator />

            {/* Hero stat */}
            <div className="px-5 py-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Estimated Annual Output
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">
                  {formatEnergy(data.summary.total_energy_kwh)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6} className="max-w-56">
                    {getEnergyComparison(data.summary.total_energy_kwh)}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="mt-3 flex gap-2">
                <Badge variant="secondary" className="gap-1 border-transparent bg-green-500 text-xs font-normal text-white">
                  <TrendingUp className="h-3 w-3" />
                  Best: {data.summary.best_month}
                </Badge>
                <Badge variant="secondary" className="gap-1 border-transparent bg-red-500 text-xs font-normal text-white">
                  <TrendingDown className="h-3 w-3" />
                  Worst: {data.summary.worst_month}
                </Badge>
              </div>
            </div>

            {/* Year timeline */}
            {onYearChange && (
              <>
                <Separator />
                <div className={`flex items-center justify-between px-5 py-3 transition-opacity ${isLoadingYear ? "opacity-40 pointer-events-none" : ""}`}>
                  <button
                    onClick={() => onYearChange(data.year - 1)}
                    disabled={isLoadingYear || data.year <= 2015}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-3">
                    {Array.from({ length: 5 }, (_, i) => {
                      const y = data.year - 2 + i
                      const currentYear = new Date().getFullYear()
                      if (y < 2015 || y > currentYear) return null
                      return (
                        <button
                          key={y}
                          onClick={() => { if (y !== data.year) onYearChange(y) }}
                          disabled={isLoadingYear}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            y === data.year
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          {y}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => onYearChange(data.year + 1)}
                    disabled={isLoadingYear || data.year >= new Date().getFullYear()}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}

            <Separator />

            {/* Tabs */}
            <Tabs
              defaultValue="overview"
              className="flex min-h-0 flex-1 flex-col"
              
            >
              <div className="px-5 pt-5">
                <TabsList className="w-full">
                  <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
                  <TabsTrigger value="efficiency" className="flex-1 text-xs">Efficiency</TabsTrigger>
                  <TabsTrigger value="thermal" className="flex-1 text-xs">Thermal</TabsTrigger>
                  <TabsTrigger value="roi" className="flex-1 text-xs">ROI</TabsTrigger>
                  <TabsTrigger value="predictions" className="flex-1 text-xs">Forecast</TabsTrigger>
                  <TabsTrigger value="signals" className="flex-1 text-xs">Signals</TabsTrigger>
                </TabsList>
              </div>

              {/* ── Overview ──────────────────────── */}
              <TabsContent value="overview" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : <div className="space-y-5 px-5 pb-6 pt-4">
                    <div>
                      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Key Metrics</h3>
                      <div className="space-y-0">
                        <MetricRow icon={Gauge} iconColor="text-sky-400" label="Avg Efficiency" value={`${(data.summary.average_efficiency_score * 100).toFixed(0)}%`} tooltip="This is not the panel's actual efficiency — it's a score of how well the panel performs given local weather, daylight, and tilt conditions." />
                        <MetricRow icon={Zap} iconColor="text-amber-400" label="Panel Area" value={`${data.summary.panel_area_m2.toLocaleString()} m²`} />
                        <MetricRow icon={Sun} iconColor="text-orange-400" label="Panel Efficiency" value={`${data.summary.panel_efficiency_percent}%`} />
                        {data.summary.estimated_panel_count != null && (
                          <MetricRow icon={LayoutGrid} iconColor="text-violet-400" label="Est. Panels" value={`${data.summary.estimated_panel_count}`} tooltip="Estimated number of panels based on total area ÷ single panel area." />
                        )}
                        {data.daily_summary?.shadow_coverage_percent != null && (
                          <MetricRow icon={Eclipse} iconColor="text-slate-400" label="Shadow Coverage" value={`${data.daily_summary.shadow_coverage_percent.toFixed(1)}%`} tooltip="Approximate terrain shadow coverage. 0% = no shading, higher = more terrain obstruction." />
                        )}
                        {data.daily_summary?.albedo != null && (
                          <MetricRow icon={SunDim} iconColor="text-cyan-400" label="Ground Albedo" value={`${data.daily_summary.albedo.toFixed(2)}`} tooltip="Ground reflectivity from NASA POWER. E.g. 0.17 for grass, 0.80 for snow. Higher values mean more reflected light reaching panels." />
                        )}
                        <MetricRow icon={MapPin} iconColor="text-rose-400" label="Location" value={`${data.midpoint.latitude.toFixed(3)}°, ${data.midpoint.longitude.toFixed(3)}°`} />
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Monthly Energy Production</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={45} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                            <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [formatEnergy(value), "Energy"]} />
                            <Bar dataKey="energy" fill="#0ea5e9" radius={[3, 3, 0, 0]} maxBarSize={28} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>}
                </ScrollArea>
              </TabsContent>

              {/* ── Efficiency ────────────────────── */}
              <TabsContent value="efficiency" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : <div className="space-y-5 px-5 pb-6 pt-4">
                    {data.daily_summary && (
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Daily Snapshot</h3>
                          {data.daily_date && (
                            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                              <CalendarDays className="mr-0.5 h-2.5 w-2.5" />
                              {data.daily_date}
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-0">
                          <MetricRow icon={Clock} iconColor="text-violet-400" label="Peak Hour" value={(() => {
                            try {
                              const d = new Date(data.daily_summary.peak_hour)
                              if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
                            } catch { /* ignore */ }
                            return data.daily_summary.peak_hour
                          })()} />
                          <MetricRow icon={Gauge} iconColor="text-sky-400" label="Peak Efficiency" value={`${(data.daily_summary.peak_efficiency * 100).toFixed(0)}%`} tooltip="A performance score based on conditions, not the panel's rated efficiency." />
                          <MetricRow icon={Sun} iconColor="text-orange-400" label="Daylight Hours" value={`${data.daily_summary.total_daylight_hours.toFixed(1)} h`} />
                          <MetricRow icon={Zap} iconColor="text-amber-400" label="Energy Today" value={formatEnergy(data.daily_summary.total_energy_kwh)} />
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Monthly Efficiency</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="efficiencyGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} domain={[0, 100]} width={32} tickFormatter={(v: number) => `${v}%`} />
                            <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [`${value.toFixed(0)}%`, "Efficiency"]} />
                            <Area type="monotone" dataKey="efficiency" stroke="#10b981" strokeWidth={2} fill="url(#efficiencyGradient)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Average Daylight Hours</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="daylightGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={32} tickFormatter={(v: number) => `${v}h`} />
                            <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [`${value.toFixed(1)} h`, "Daylight"]} />
                            <Area type="monotone" dataKey="daylight" stroke="#f59e0b" strokeWidth={2} fill="url(#daylightGradient)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>}
                </ScrollArea>
              </TabsContent>

              {/* ── Thermal ──────────────────────── */}
              <TabsContent value="thermal" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : (() => {
                    const hourly = data.hourly_data ?? []
                    const thermalChartData = hourly.map((h) => {
                      const d = new Date(h.hour)
                      return {
                        time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
                        ambient: h.ambient_temperature_c,
                        cell: h.cell_temperature_c,
                        loss: h.energy_efficiency_loss,
                        isDaylight: h.is_daylight,
                      }
                    })

                    if (thermalChartData.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center gap-2 py-16">
                          <Thermometer className="h-6 w-6 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">No hourly thermal data available</p>
                        </div>
                      )
                    }

                    const daylightData = thermalChartData.filter((d) => d.isDaylight)
                    const avgAmbient = daylightData.length ? daylightData.reduce((s, d) => s + d.ambient, 0) / daylightData.length : 0
                    const avgCell = daylightData.length ? daylightData.reduce((s, d) => s + d.cell, 0) / daylightData.length : 0
                    const avgLoss = daylightData.length ? daylightData.reduce((s, d) => s + d.loss, 0) / daylightData.length : 1

                    return (
                      <div className="space-y-5 px-5 pb-6 pt-4">
                        <div>
                          <div className="mb-1 flex items-center gap-2">
                            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Daylight Averages</h3>
                            {data.daily_date && (
                              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                                <CalendarDays className="mr-0.5 h-2.5 w-2.5" />
                                {data.daily_date}
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-0">
                            <MetricRow icon={Thermometer} iconColor="text-sky-400" label="Avg Ambient Temp" value={`${avgAmbient.toFixed(1)}°C`} tooltip="Average ambient air temperature during daylight hours." />
                            <MetricRow icon={Thermometer} iconColor="text-rose-400" label="Avg Cell Temp" value={`${avgCell.toFixed(1)}°C`} tooltip="Average estimated solar cell temperature during daylight — always ≥ ambient due to solar heating." />
                            <MetricRow icon={Gauge} iconColor="text-amber-400" label="Avg Temp Factor" value={avgLoss >= 1 ? `+${((avgLoss - 1) * 100).toFixed(1)}%` : `−${((1 - avgLoss) * 100).toFixed(1)}%`} tooltip="1.0 = no loss. <1.0 = heat-related loss. >1.0 = cold-weather gain." />
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Temperature (Ambient vs Cell)</h3>
                          <div className="h-44 rounded-lg border border-border bg-card p-3">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={thermalChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                                <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={36} tickFormatter={(v: number) => `${v}°`} />
                                <RechartsTooltip {...tooltipStyle} formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name === "ambient" ? "Ambient" : "Cell"]} />
                                <Line type="monotone" dataKey="ambient" stroke="#38bdf8" strokeWidth={2} dot={false} name="ambient" />
                                <Line type="monotone" dataKey="cell" stroke="#f43f5e" strokeWidth={2} dot={false} name="cell" />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> Ambient</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Cell</span>
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Temperature Efficiency Factor</h3>
                          <div className="h-44 rounded-lg border border-border bg-card p-3">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={thermalChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                                <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={40} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(2)} />
                                <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [value.toFixed(4), "Efficiency Factor"]} />
                                <Area type="monotone" dataKey="loss" stroke="#f59e0b" strokeWidth={2} fill="url(#lossGradient)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Factor of 1.0 = no temperature impact. Below 1.0 = heat losses. Above 1.0 = cold-weather efficiency gain.
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                </ScrollArea>
              </TabsContent>

              {/* ── ROI ───────────────────────────── */}
              <TabsContent value="roi" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : <div className="space-y-5 px-5 pb-6 pt-4">
                    <div className="rounded-lg border border-border bg-card p-4 text-center">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Payback Period
                      </p>
                      <p className="mt-1 text-3xl font-extrabold text-foreground">
                        {roi.paybackYears} <span className="text-base font-medium text-muted-foreground">years</span>
                      </p>
                    </div>

                    <div>
                      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Financial Summary</h3>
                      <div className="space-y-0">
                        <div className="flex items-center justify-between py-2">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                            Installation Cost
                          </span>
                          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                            {formatCurrency(roi.totalInstallCost)}
                            <button onClick={() => openEdit("install")} className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                              <Pencil className="h-3 w-3" />
                            </button>
                          </span>
                        </div>
                        <MetricRow icon={PiggyBank} iconColor="text-pink-400" label="Annual Savings" value={formatCurrency(roi.annualSavings)} />
                        <MetricRow icon={Timer} iconColor="text-sky-400" label="25-Year ROI" value={`${roi.roi25Year}%`} />
                        <div className="flex items-center justify-between py-2">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Zap className="h-3.5 w-3.5 text-amber-400" />
                            Electricity Rate
                          </span>
                          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                            £{roi.electricityRate}/kWh
                            <button onClick={() => openEdit("electricity")} className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                              <Pencil className="h-3 w-3" />
                            </button>
                          </span>
                        </div>
                        <MetricRow icon={Sun} iconColor="text-orange-400" label="CO₂ Offset" value={`${(roi.carbonOffsetKg / 1000).toFixed(1)}t/yr`} />
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Cumulative Savings vs Cost</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={roi.cumulativeSavings} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="year" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={45} tickFormatter={(v) => formatCurrency(v)} />
                            <RechartsTooltip
                              {...tooltipStyle}
                              formatter={(value: number, name: string) => [
                                formatCurrency(value),
                                name === "savings" ? "Cumulative Savings" : "Install Cost",
                              ]}
                              labelFormatter={(label) => `Year ${label}`}
                            />
                            <Area type="monotone" dataKey="savings" stroke="#10b981" strokeWidth={2} fill="url(#savingsGradient)" />
                            <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Break-even at year {roi.paybackYears}. Savings exceed installation cost from that point forward.
                      </p>
                    </div>
                  </div>}
                </ScrollArea>
              </TabsContent>

              {/* ── Forecast ──────────────────────── */}
              <TabsContent value="predictions" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : <div className="space-y-5 px-5 pb-6 pt-4">
                    <div>
                      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">10-Year Outlook</h3>
                      <div className="space-y-0">
                        <MetricRow icon={LineChartIcon} iconColor="text-sky-400" label={`Energy in ${predictions[9].year}`} value={formatEnergy(predictions[9].energy)} />
                        <MetricRow icon={Gauge} iconColor="text-emerald-400" label={`Efficiency in ${predictions[9].year}`} value={`${predictions[9].efficiency}%`} />
                        <MetricRow icon={TrendingDown} iconColor="text-rose-400" label="Total Degradation" value={`${predictions[9].degradation}%`} />
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Projected Annual Energy</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={predictions} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="forecastEnergyGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="year" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={45} domain={["dataMin - dataMin * 0.02", "dataMax + dataMax * 0.01"]} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`} />
                            <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [formatEnergy(value), "Energy"]} labelFormatter={(label) => `${label}`} />
                            <Area type="monotone" dataKey="energy" stroke="#0ea5e9" strokeWidth={2} fill="url(#forecastEnergyGradient)" dot={{ r: 3, fill: "#0ea5e9" }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Y-axis is zoomed in to highlight the gradual decline from panel degradation.
                      </p>
                    </div>

                    <div>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Projected Efficiency</h3>
                      <div className="h-44 rounded-lg border border-border bg-card p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={predictions} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                            <XAxis dataKey="year" tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" axisLine={false} tickLine={false} domain={["auto", "auto"]} width={36} tickFormatter={(v: number) => `${v}%`} />
                            <RechartsTooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Efficiency"]} labelFormatter={(label) => `${label}`} />
                            <Line type="monotone" dataKey="efficiency" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Assumes 0.5% annual panel degradation with marginal irradiance increase.
                      </p>
                    </div>
                  </div>}
                </ScrollArea>
              </TabsContent>

              {/* ── Signals ───────────────────────── */}
              <TabsContent value="signals" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {isLoadingYear ? <TabSkeleton /> : (() => {
                    const visibleList = signalsProp.slice(0, visibleSignals)
                    const regularSignals = visibleList.filter((s) => s.type !== "climate")
                    const climateSignals = visibleList.filter((s) => s.type === "climate")
                    const allRegular = signalsProp.filter((s) => s.type !== "climate")
                    const allClimate = signalsProp.filter((s) => s.type === "climate")

                    return <div className="space-y-5 px-5 pb-6 pt-4">
                    {/* AI-Powered Insights */}
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <BrainCircuit className="h-3.5 w-3.5 text-muted-foreground" />
                        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          AI-Powered Insights
                        </h3>
                      </div>

                      {signalsLoadingProp && (
                        <div className="rounded-lg border border-border bg-card p-4 text-center">
                          <p className="text-xs text-muted-foreground">Analysing your solar configuration…</p>
                          <TypingDots />
                        </div>
                      )}

                      {!signalsLoadingProp && signalsProp.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border py-8 text-center">
                          <BrainCircuit className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">
                            No AI signals available
                          </p>
                        </div>
                      )}

                      {regularSignals.length > 0 && (
                        <div className="rounded-lg border border-border bg-card">
                          <AnimatePresence>
                            {regularSignals.map((signal, index) => (
                              <motion.div
                                key={signal.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className={index > 0 ? "border-t border-border" : ""}
                              >
                                <div className="px-4">
                                  <SignalItem signal={signal} />
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>

                          {!signalsLoadingProp && regularSignals.length > 0 && regularSignals.length < allRegular.length && (
                            <div className="border-t border-border">
                              <TypingDots />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Climate Signals */}
                    {(climateSignals.length > 0 || (signalsLoadingProp && allClimate.length === 0)) && (
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <CloudSun className="h-3.5 w-3.5 text-violet-400" />
                        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Climate Outlook
                        </h3>
                      </div>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        Based on future climate projections fed into the LLM model.
                      </p>

                      {climateSignals.length > 0 && (
                        <div className="rounded-lg border border-violet-500/20 bg-card">
                          <AnimatePresence>
                            {climateSignals.map((signal, index) => (
                              <motion.div
                                key={signal.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className={index > 0 ? "border-t border-violet-500/10" : ""}
                              >
                                <div className="px-4">
                                  <SignalItem signal={signal} />
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>

                          {!signalsLoadingProp && climateSignals.length > 0 && climateSignals.length < allClimate.length && (
                            <div className="border-t border-violet-500/10">
                              <TypingDots />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                  })()}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </motion.aside>
        )}
        </>
      )}

      <Dialog open={editField !== null} onOpenChange={(open) => { if (!open) setEditField(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editField === "electricity" ? "Electricity Rate" : "Installation Cost"}
            </DialogTitle>
            <DialogDescription>
              {editField === "electricity"
                ? "Enter your electricity rate in £ per kWh. UK average is £0.34/kWh."
                : "Enter installation cost in £ per m². UK average is £250/m²."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label htmlFor="edit-value">
                {editField === "electricity" ? "Rate (£/kWh)" : "Cost (£/m²)"}
              </Label>
              <Input
                id="edit-value"
                type="number"
                step={editField === "electricity" ? 0.01 : 1}
                min={0.01}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit() }}
                className="mt-1.5"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditField(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AnimatePresence>
  )
}
