"use client"

import { Sun, Zap, Ruler, Trash2, LayoutGrid } from "lucide-react"
import type { SolarPolygon } from "./solar-map"

// Average solar panel specs
const PANEL_AREA_SQM = 1.7 // ~1.7 m^2 per panel
const PANEL_WATTAGE = 400 // watts per panel
const PEAK_SUN_HOURS = 5 // average daily peak sun hours
const PANEL_EFFICIENCY = 0.85 // system efficiency factor

interface SolarPanelInfoProps {
  polygons: SolarPolygon[]
  onDeletePolygon?: (id: string) => void
}

function formatArea(sqm: number): string {
  if (sqm >= 10000) {
    return `${(sqm / 10000).toFixed(2)} ha`
  }
  return `${sqm.toFixed(1)} m\u00B2`
}

function formatPower(watts: number): string {
  if (watts >= 1000000) {
    return `${(watts / 1000000).toFixed(1)} MW`
  }
  if (watts >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`
  }
  return `${watts.toFixed(0)} W`
}

function formatEnergy(wh: number): string {
  if (wh >= 1000000) {
    return `${(wh / 1000000).toFixed(1)} MWh`
  }
  if (wh >= 1000) {
    return `${(wh / 1000).toFixed(1)} kWh`
  }
  return `${wh.toFixed(0)} Wh`
}

export function SolarPanelInfo({ polygons }: SolarPanelInfoProps) {
  const totalArea = polygons.reduce((sum, p) => sum + p.area, 0)
  const totalPanels = Math.floor(totalArea / PANEL_AREA_SQM)
  const totalCapacity = totalPanels * PANEL_WATTAGE
  const dailyEnergy = totalCapacity * PEAK_SUN_HOURS * PANEL_EFFICIENCY
  const annualEnergy = dailyEnergy * 365

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">Total Area</span>
          </div>
          <span className="text-lg font-semibold text-foreground">{formatArea(totalArea)}</span>
        </div>

        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">Panels</span>
          </div>
          <span className="text-lg font-semibold text-foreground">{totalPanels.toLocaleString()}</span>
        </div>

        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-muted-foreground">Capacity</span>
          </div>
          <span className="text-lg font-semibold text-foreground">{formatPower(totalCapacity)}</span>
        </div>

        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-muted-foreground">Daily Output</span>
          </div>
          <span className="text-lg font-semibold text-foreground">{formatEnergy(dailyEnergy)}</span>
        </div>
      </div>

      {/* Annual projection */}
      {totalArea > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Annual Energy Projection</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-primary">
            {formatEnergy(annualEnergy)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Based on {PEAK_SUN_HOURS}h avg. peak sun, {(PANEL_EFFICIENCY * 100).toFixed(0)}% system efficiency
          </p>
        </div>
      )}

      {/* Individual polygon list */}
      {polygons.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Zones ({polygons.length})
          </h3>
          <div className="flex flex-col gap-2">
            {polygons.map((polygon, index) => {
              const panels = Math.floor(polygon.area / PANEL_AREA_SQM)
              const capacity = panels * PANEL_WATTAGE
              return (
                <div
                  key={polygon.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      Zone {index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatArea(polygon.area)} &middot; {panels} panels &middot; {formatPower(capacity)}
                    </span>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
                    <Sun className="h-4 w-4" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {polygons.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sun className="h-6 w-6 text-primary" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">No solar zones yet</p>
            <p className="text-xs text-muted-foreground">
              Use the polygon tool on the map to draw areas for solar panel placement
            </p>
          </div>
        </div>
      )}

      {/* Assumptions */}
      <div className="rounded-lg bg-muted p-3">
        <p className="text-xs font-medium text-muted-foreground">Assumptions</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
          <li>{PANEL_AREA_SQM} m&sup2; per panel ({PANEL_WATTAGE}W)</li>
          <li>{PEAK_SUN_HOURS}h daily peak sun hours</li>
          <li>{(PANEL_EFFICIENCY * 100).toFixed(0)}% system efficiency</li>
        </ul>
      </div>
    </div>
  )
}
