"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { SolarMap, type SolarPolygon, type SolarMapHandle } from "@/components/solar-map"
import { LoadingToast } from "@/components/loading-toast"
import { SolarDataPanel, type SolarData, type SignalMessage } from "@/components/solar-data-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Layers, SlidersHorizontal, Info, Trash2, ChevronUp, ChevronDown, Home } from "lucide-react"

const MAP_STYLES = [
  { label: "Satellite", value: "satellite" },
  { label: "Streets", value: "https://tiles.openfreemap.org/styles/liberty" },
  { label: "Light", value: "https://tiles.openfreemap.org/styles/positron" },
  { label: "Dark", value: "https://tiles.openfreemap.org/styles/dark" },
]

const SOLAR_API_BASE_URL = process.env.NEXT_PUBLIC_SOLAR_API_URL ?? "http://localhost:8000"
const DEFAULT_PANEL_EFFICIENCY = 0.2
const DEFAULT_PANEL_TILT = 30
const MIN_TILT = 0
const MAX_TILT = 90
const MIN_EFFICIENCY_PERCENT = 1
const MAX_EFFICIENCY_PERCENT = 100
const DEFAULT_PARAM_AREA = 1.7
const MIN_PARAM_AREA = 0.1
const MAX_PARAM_AREA = 100

interface PolygonPoint {
  latitude: number
  longitude: number
}

interface PolygonRequestBody {
  points: PolygonPoint[]
  panel_efficiency: number
  panel_area: number
  panel_tilt: number
  param_area: number
}

interface PolygonDailySummary {
  peak_efficiency: number
  peak_hour: string
  total_daylight_hours: number
  total_energy_kwh: number
}

interface PolygonHourlyData {
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

interface PolygonDailyResponse {
  date: string
  hourly_data: PolygonHourlyData[]
  summary: PolygonDailySummary
}

function toPolygonPoints(polygon: SolarPolygon): PolygonPoint[] {
  const ring = polygon.coordinates[0] ?? []
  const hasClosedRing =
    ring.length > 2 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const vertices = hasClosedRing ? ring.slice(0, -1) : ring

  return vertices.map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }))
}

async function getApiErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string }
    return data.detail ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function SolarDrawPage() {
  const [polygons, setPolygons] = useState<SolarPolygon[]>([])
  const [hasDrawnOnce, setHasDrawnOnce] = useState(false)
  const [mapStyle, setMapStyle] = useState(MAP_STYLES[0].value)
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [panelTilt, setPanelTilt] = useState(DEFAULT_PANEL_TILT)
  const [panelTiltDraft, setPanelTiltDraft] = useState(DEFAULT_PANEL_TILT)
  const [panelEfficiencyPercent, setPanelEfficiencyPercent] = useState(
    DEFAULT_PANEL_EFFICIENCY * 100
  )
  const [paramArea, setParamArea] = useState(DEFAULT_PARAM_AREA)
  const [isCreditsOpen, setIsCreditsOpen] = useState(false)
  const [isBottomBarOpen, setIsBottomBarOpen] = useState(true)
  const [mapZoom, setMapZoom] = useState(1.5)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingYear, setIsLoadingYear] = useState(false)
  const [solarData, setSolarData] = useState<SolarData | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [signals, setSignals] = useState<SignalMessage[]>([])
  const [signalsLoading, setSignalsLoading] = useState(false)
  const mapRef = useRef<SolarMapHandle>(null)
  const activeRequestRef = useRef<AbortController | null>(null)
  const yearRequestRef = useRef<AbortController | null>(null)

  const fetchPolygonSolarData = useCallback(async (polygon: SolarPolygon) => {
    const points = toPolygonPoints(polygon)
    if (points.length < 3) {
      return
    }

    if (activeRequestRef.current) {
      activeRequestRef.current.abort()
    }

    const controller = new AbortController()
    activeRequestRef.current = controller
    setIsLoading(true)
    setIsBottomBarOpen(false)
    setSignals([])
    setSignalsLoading(true)

    const requestBody: PolygonRequestBody = {
      points,
      panel_efficiency: panelEfficiencyPercent / 100,
      panel_area: Math.max(1, Number(polygon.area.toFixed(2))),
      panel_tilt: panelTilt,
      param_area: paramArea,
    }

    const year = new Date().getFullYear()

    try {
      const [dailyResponse, yearlyResponse, signalsResponse] = await Promise.all([
        fetch(`${SOLAR_API_BASE_URL}/solar/polygon-efficiency`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }),
        fetch(`${SOLAR_API_BASE_URL}/solar/polygon-yearly?year=${year}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }),
        fetch(`${SOLAR_API_BASE_URL}/solar/signals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }).catch(() => null), // Signals are non-critical — don't block on failure
      ])

      if (!dailyResponse.ok) {
        throw new Error(await getApiErrorMessage(dailyResponse))
      }
      if (!yearlyResponse.ok) {
        throw new Error(await getApiErrorMessage(yearlyResponse))
      }

      const dailyData = (await dailyResponse.json()) as PolygonDailyResponse
      const yearlyData = (await yearlyResponse.json()) as SolarData

      // Process signals (non-blocking)
      if (signalsResponse && signalsResponse.ok) {
        try {
          const signalsJson = (await signalsResponse.json()) as { signals: { type: "info" | "warning" | "tip"; title: string; content: string; climate?: boolean }[] }
          setSignals(signalsJson.signals.map((s, i) => ({ id: `s${i}`, type: s.climate ? "climate" as const : s.type, title: s.title, content: s.content })))
        } catch {
          setSignals([])
        }
      } else {
        setSignals([{ id: "error", type: "warning", title: "Signals Unavailable", content: "Could not load AI-powered signals. Please try again later." }])
      }
      setSignalsLoading(false)

      setSolarData({
        ...yearlyData,
        daily_date: dailyData.date,
        daily_summary: dailyData.summary,
        hourly_data: dailyData.hourly_data,
      })
      setIsPanelOpen(true)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return
      }

      console.error("Failed to fetch polygon solar data:", error)
      setSolarData(null)
      setSignals([])
      setSignalsLoading(false)
      setIsPanelOpen(false)
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null
      }
      setIsLoading(false)
    }
  }, [panelEfficiencyPercent, panelTilt, paramArea])

  const handlePolygonsChange = useCallback((newPolygons: SolarPolygon[]) => {
    setPolygons(newPolygons)
    if (newPolygons.length > 0) setHasDrawnOnce(true)
  }, [])

  useEffect(() => {
    if (polygons.length === 0) {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort()
      }
      setSolarData(null)
      setIsPanelOpen(false)
      setIsLoading(false)
      return
    }

    const latestPolygon = polygons[polygons.length - 1]
    void fetchPolygonSolarData(latestPolygon)
  }, [polygons, fetchPolygonSolarData])

  const handleYearChange = useCallback(async (year: number) => {
    if (!polygons.length) return

    if (yearRequestRef.current) {
      yearRequestRef.current.abort()
    }

    const controller = new AbortController()
    yearRequestRef.current = controller
    setIsLoadingYear(true)

    const latestPolygon = polygons[polygons.length - 1]
    const points = toPolygonPoints(latestPolygon)
    if (points.length < 3) return

    const requestBody: PolygonRequestBody = {
      points,
      panel_efficiency: panelEfficiencyPercent / 100,
      panel_area: Math.max(1, Number(latestPolygon.area.toFixed(2))),
      panel_tilt: panelTilt,
      param_area: paramArea,
    }

    try {
      const response = await fetch(
        `${SOLAR_API_BASE_URL}/solar/polygon-yearly?year=${year}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response))
      }

      const yearlyData = (await response.json()) as SolarData

      setSolarData((prev) => ({
        ...yearlyData,
        daily_date: prev?.daily_date,
        daily_summary: prev?.daily_summary,
      }))
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      console.error("Failed to fetch year data:", error)
    } finally {
      if (yearRequestRef.current === controller) {
        yearRequestRef.current = null
      }
      setIsLoadingYear(false)
    }
  }, [polygons, panelEfficiencyPercent, panelTilt, paramArea])

  useEffect(() => {
    return () => {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort()
      }
      if (yearRequestRef.current) {
        yearRequestRef.current.abort()
      }
    }
  }, [])

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Map area */}
      <main className={`relative flex-1 ${isBottomBarOpen ? "bottom-bar-open" : ""}`}>
        <SolarMap ref={mapRef} onPolygonsChange={handlePolygonsChange} mapStyle={mapStyle} onZoomChange={setMapZoom} />

        {/* Onboarding empty state */}
        <AnimatePresence>
          {!hasDrawnOnce && !isLoading && mapZoom >= 14 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut", delay: 0.8, exit: { duration: 0.1, delay: 0 } }}
              onClick={() => setHasDrawnOnce(true)}
              className="absolute inset-0 z-[5] flex items-center justify-center cursor-pointer"
            >
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background/90 px-8 py-7 shadow-2xl backdrop-blur-md max-w-sm text-center">
                <h3 className="text-base font-semibold text-foreground">
                  Draw a solar zone
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Use the polygon tool in the top-right to outline a rooftop or area.
                  We&apos;ll analyse its solar potential instantly.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete & Start Over */}
        <AnimatePresence>
          {polygons.length > 0 && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
              className="absolute left-1/2 z-10 -translate-x-1/2 transition-[bottom] duration-300 ease-in-out"
              style={{ bottom: isBottomBarOpen ? "calc(1.5rem + 68px)" : "1.5rem" }}
            >
              <Button
                variant="outline"
                onClick={() => {
                  mapRef.current?.deleteAll()
                }}
                className="gap-2 rounded-xl bg-card/90 shadow-lg backdrop-blur-sm border-destructive/30 text-destructive hover:bg-destructive hover:text-white transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete &amp; Start Over
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map style selector */}
        <div
          className="absolute left-4 z-10 flex items-end gap-3 transition-[bottom] duration-300 ease-in-out"
          style={{ bottom: isBottomBarOpen ? "calc(1.5rem + 68px)" : "1.5rem" }}
        >
          <div className="relative">
            <button
              onClick={() => setShowStylePicker(!showStylePicker)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-secondary"
            >
              <Layers className="h-4 w-4" />
              {MAP_STYLES.find((s) => s.value === mapStyle)?.label}
            </button>

            {showStylePicker && (
              <div className="absolute bottom-full left-0 mb-2 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                {MAP_STYLES.map((style) => (
                  <button
                    key={style.value}
                    onClick={() => {
                      setMapStyle(style.value)
                      setShowStylePicker(false)
                    }}
                    className={`px-4 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                      mapStyle === style.value
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground"
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <Button
              variant="outline"
              onClick={() => setShowConfigMenu((current) => !current)}
              className="bg-card shadow-lg"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Panel Settings
            </Button>
            {showConfigMenu && (
              <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-border bg-card p-4 shadow-xl">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="panel-tilt">Panel Tilt (degrees)</Label>
                    <div className="mt-2 rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{MIN_TILT}°</span>
                        <span className="font-semibold text-foreground">
                          {panelTiltDraft}°
                        </span>
                        <span>{MAX_TILT}°</span>
                      </div>
                      <Slider
                        id="panel-tilt"
                        min={MIN_TILT}
                        max={MAX_TILT}
                        step={1}
                        value={[panelTiltDraft]}
                        onValueChange={(values) => {
                          const value = values[0]
                          if (typeof value !== "number") return
                          setPanelTiltDraft(clamp(value, MIN_TILT, MAX_TILT))
                        }}
                        onValueCommit={(values) => {
                          const value = values[0]
                          if (typeof value !== "number") return
                          const clamped = clamp(value, MIN_TILT, MAX_TILT)
                          setPanelTiltDraft(clamped)
                          setPanelTilt(clamped)
                        }}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[0, 15, 30, 45, 60].map((tiltPreset) => (
                          <button
                            key={tiltPreset}
                            type="button"
                            onClick={() => {
                              setPanelTiltDraft(tiltPreset)
                              setPanelTilt(tiltPreset)
                            }}
                            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                              panelTiltDraft === tiltPreset
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-foreground hover:bg-secondary"
                            }`}
                          >
                            {tiltPreset}°
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Drag the slider and release to apply.
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="panel-efficiency">Panel Efficiency (%)</Label>
                    <Input
                      id="panel-efficiency"
                      type="number"
                      min={MIN_EFFICIENCY_PERCENT}
                      max={MAX_EFFICIENCY_PERCENT}
                      step={1}
                      value={panelEfficiencyPercent}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (Number.isNaN(value)) return
                        setPanelEfficiencyPercent(
                          clamp(value, MIN_EFFICIENCY_PERCENT, MAX_EFFICIENCY_PERCENT)
                        )
                      }}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="param-area">Single Panel Area (m²)</Label>
                    <Input
                      id="param-area"
                      type="number"
                      min={MIN_PARAM_AREA}
                      max={MAX_PARAM_AREA}
                      step={0.1}
                      value={paramArea}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (Number.isNaN(value)) return
                        setParamArea(
                          clamp(value, MIN_PARAM_AREA, MAX_PARAM_AREA)
                        )
                      }}
                      className="mt-2"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Area of a single panel, used to estimate panel count.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Credits full-screen page */}
      <AnimatePresence>
        {isCreditsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-black"
          >
            <div className="relative flex h-full w-full overflow-hidden">
              {/* Left content */}
              <div className="relative z-10 flex flex-1 flex-col justify-between p-10 md:p-14">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/50">
                    Built for
                  </p>
                  <h2 className="mt-1 text-3xl font-extrabold uppercase tracking-tight text-white md:text-5xl">
                    BrisHack 2026
                  </h2>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
                    className="mt-8 space-y-1"
                  >
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/40">
                      Team
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-bold uppercase tracking-wide text-white md:text-xl">
                      <span>Sohan</span>
                      <span className="text-white/30">|</span>
                      <span>Umayr</span>
                      <span className="text-white/30">|</span>
                      <span>Ankith</span>
                      <span className="text-white/30">|</span>
                      <span>Sai</span>
                    </div>
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.6, ease: "easeOut" }}
                  className="space-y-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/SolarSAT.svg"
                    alt="SolarSAT"
                    className="h-8 w-auto opacity-70"
                  />
                  <p className="text-xs text-white/30">
                    Satellite-powered solar analysis — anywhere on Earth.
                  </p>
                </motion.div>
              </div>

              {/* Right globe visual */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                className="pointer-events-none absolute -right-20 top-1/2 -translate-y-1/2 md:right-0"
              >
                <div className="h-[36rem] w-[36rem] rounded-full bg-gradient-to-br from-white/[0.07] to-transparent md:h-[44rem] md:w-[44rem]" />
              </motion.div>

              {/* Back button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.5 }}
                onClick={() => setIsCreditsOpen(false)}
                className="absolute right-6 top-6 z-20 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                Back
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <LoadingToast isVisible={isLoading} />
      <SolarDataPanel
        data={solarData}
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        onYearChange={handleYearChange}
        isLoadingYear={isLoadingYear}
        signals={signals}
        signalsLoading={signalsLoading}
      />

      {/* Collapsible bottom branding bar */}
      <motion.div
        initial={false}
        animate={{ y: isBottomBarOpen ? 0 : "calc(100% - 28px)" }}
        transition={{ type: "spring", damping: 28, stiffness: 350 }}
        className="fixed bottom-0 left-0 right-0 z-40"
      >
        {/* Toggle handle */}
        <div className="flex justify-center">
          <button
            onClick={() => setIsBottomBarOpen((o) => !o)}
            className="flex items-center gap-1 rounded-t-lg border border-b-0 border-border bg-background/95 px-3 py-1 text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
          >
            {isBottomBarOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Bar content */}
        <div className="relative flex items-center border-t border-border bg-background/95 px-6 py-5 backdrop-blur-sm">
          {/* Centered logo (absolute so it's always perfectly centered) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/SolarSAT.svg"
              alt="SolarSAT"
              className="h-7 w-auto opacity-90"
            />
          </div>

          {/* Icons positioned just left of center */}
          <div className="mx-auto flex items-center gap-2" style={{ transform: "translateX(-8.5rem)" }}>
            <button
              onClick={() => {
                setIsPanelOpen(false)
                setIsCreditsOpen(true)
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Credits"
            >
              <Info className="h-4 w-4" />
            </button>
            <button
              onClick={() => mapRef.current?.zoomToEarth()}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Zoom to Earth"
            >
              <Home className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
