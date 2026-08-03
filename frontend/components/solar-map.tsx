"use client"

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import MapboxDraw from "@mapbox/mapbox-gl-draw"
import "mapbox-gl/dist/mapbox-gl.css"
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css"
import { area } from "@turf/area"
import { LocationSearch } from "./location-search"

export interface SolarPolygon {
  id: string
  area: number // square meters
  coordinates: number[][][]
}

export interface SolarMapHandle {
  deleteAll: () => void
  zoomToEarth: () => void
}

/** Maximum polygon area in m² (default 50,000 m² ≈ 5 hectares) */
const DEFAULT_MAX_AREA_M2 = 50_000

interface SolarMapProps {
  onPolygonsChange: (polygons: SolarPolygon[]) => void
  mapStyle: string
  onLoadingChange?: (loading: boolean) => void
  onZoomChange?: (zoom: number) => void
  maxAreaM2?: number
}

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ""

export const SolarMap = forwardRef<SolarMapHandle, SolarMapProps>(function SolarMap(
  { onPolygonsChange, mapStyle, onLoadingChange, onZoomChange, maxAreaM2 = DEFAULT_MAX_AREA_M2 },
  ref
) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const draw = useRef<MapboxDraw | null>(null)
  const marker = useRef<mapboxgl.Marker | null>(null)
  const isLocked = useRef(false)
  const spinEnabled = useRef(true)
  const userInteracting = useRef(false)
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [areaWarning, setAreaWarning] = useState<string | null>(null)

  const lockPolygon = useCallback(() => {
    if (!draw.current || isLocked.current) return
    isLocked.current = true
    // Switch to simple_select with nothing selected so polygon can't be edited
    draw.current.changeMode("simple_select", { featureIds: [] })
    // Hide the draw controls via CSS
    const container = mapContainer.current
    if (container) {
      container.closest(".relative")?.classList.add("draw-locked")
    }
  }, [])

  const unlockAndClear = useCallback(() => {
    if (!draw.current) return
    isLocked.current = false
    draw.current.deleteAll()
    draw.current.changeMode("draw_polygon")
    const container = mapContainer.current
    if (container) {
      container.closest(".relative")?.classList.remove("draw-locked")
    }
    onPolygonsChange([])
  }, [onPolygonsChange])

  const SPIN_ZOOM_THRESHOLD = 5
  const SPIN_SPEED = 1.5 // degrees per second

  const spinGlobe = useCallback(() => {
    if (!map.current) return
    const zoom = map.current.getZoom()
    if (!userInteracting.current && zoom < SPIN_ZOOM_THRESHOLD) {
      spinEnabled.current = true
      const center = map.current.getCenter()
      center.lng += SPIN_SPEED
      map.current.easeTo({
        center,
        duration: 1000,
        easing: (n: number) => n,
      })
    }
  }, [])

  const zoomToEarth = useCallback(() => {
    if (!map.current) return
    map.current.flyTo({
      center: [0, 20],
      zoom: 1.5,
      essential: true,
      duration: 2000,
    })
  }, [])

  useImperativeHandle(ref, () => ({
    deleteAll: unlockAndClear,
    zoomToEarth,
  }), [unlockAndClear, zoomToEarth])

  const updatePolygons = useCallback((isCreate?: boolean) => {
    if (!draw.current) return

    // If locked, prevent any modification
    if (isLocked.current && !isCreate) return

    const data = draw.current.getAll()
    const polygons: SolarPolygon[] = []

    if (data.features.length > 0) {
      for (const feature of data.features) {
        if (feature.geometry.type === "Polygon") {
          const polygonArea = area(feature)
          polygons.push({
            id: feature.id as string,
            area: polygonArea,
            coordinates: feature.geometry.coordinates as number[][][],
          })
        }
      }
    }

    if (isCreate && polygons.length > 0) {
      // Check area limit
      const latest = polygons[polygons.length - 1]
      if (latest.area > maxAreaM2) {
        const maxLabel = maxAreaM2 >= 1000
          ? `${(maxAreaM2 / 1000).toLocaleString()}k`
          : maxAreaM2.toLocaleString()
        setAreaWarning(
          `Area too large (${Math.round(latest.area).toLocaleString()} m²). Maximum is ${maxLabel} m².`
        )
        // Remove the oversized polygon and re-enable drawing
        draw.current.delete(latest.id)
        // Defer mode change so it runs after MapboxDraw finishes processing the delete
        setTimeout(() => {
          draw.current?.changeMode("draw_polygon")
        }, 0)
        setTimeout(() => setAreaWarning(null), 4000)
        return
      }

      onLoadingChange?.(true)
      // Lock the polygon after creation
      lockPolygon()
    }

    onPolygonsChange(polygons)
  }, [onPolygonsChange, onLoadingChange, lockPolygon])

  const handleLocationSelect = useCallback((center: [number, number]) => {
    if (!map.current) return

    map.current.flyTo({
      center: center,
      zoom: 17,
      essential: true,
    })

    if (marker.current) {
      marker.current.remove()
    }

    marker.current = new mapboxgl.Marker({ color: "#f59e0b" })
      .setLngLat(center)
      .addTo(map.current)
  }, [])

  useEffect(() => {
    if (map.current) return

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN

    map.current = new mapboxgl.Map({
      container: mapContainer.current!,
      style: mapStyle,
      center: [0, 20],
      zoom: 1.5,
      pitch: 0,
      projection: "globe" as unknown as mapboxgl.Projection,
    })

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: "draw_polygon",
      styles: [
        // Polygon fill - active
        {
          id: "gl-draw-polygon-fill-active",
          type: "fill",
          filter: [
            "all",
            ["==", "$type", "Polygon"],
            ["!=", "mode", "static"],
          ],
          paint: {
            "fill-color": "#f59e0b",
            "fill-outline-color": "#f59e0b",
            "fill-opacity": 0.25,
          },
        },
        // Polygon fill - static
        {
          id: "gl-draw-polygon-fill-static",
          type: "fill",
          filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
          paint: {
            "fill-color": "#f59e0b",
            "fill-outline-color": "#f59e0b",
            "fill-opacity": 0.25,
          },
        },
        // Polygon outline - active
        {
          id: "gl-draw-polygon-stroke-active",
          type: "line",
          filter: [
            "all",
            ["==", "$type", "Polygon"],
            ["!=", "mode", "static"],
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#f59e0b",
            "line-dasharray": [0.2, 2],
            "line-width": 2,
          },
        },
        // Polygon outline - static
        {
          id: "gl-draw-polygon-stroke-static",
          type: "line",
          filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#f59e0b",
            "line-width": 2,
          },
        },
        // Vertices
        {
          id: "gl-draw-point",
          type: "circle",
          filter: [
            "all",
            ["==", "meta", "vertex"],
            ["==", "$type", "Point"],
            ["!=", "mode", "static"],
          ],
          paint: {
            "circle-radius": 5,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#f59e0b",
            "circle-stroke-width": 2,
          },
        },
        // Midpoints
        {
          id: "gl-draw-point-midpoint",
          type: "circle",
          filter: ["all", ["==", "meta", "midpoint"], ["==", "$type", "Point"]],
          paint: {
            "circle-radius": 3,
            "circle-color": "#f59e0b",
          },
        },
        // Lines
        {
          id: "gl-draw-line",
          type: "line",
          filter: [
            "all",
            ["==", "$type", "LineString"],
            ["!=", "mode", "static"],
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#f59e0b",
            "line-dasharray": [0.2, 2],
            "line-width": 2,
          },
        },
      ],
    })

    map.current.scrollZoom.setWheelZoomRate(1 / 200)
    map.current.addControl(new mapboxgl.NavigationControl(), "bottom-right")
    map.current.addControl(draw.current, "top-right")

    map.current.on("style.load", () => {
      if (map.current?.getLayer("background")) {
        map.current.setPaintProperty("background", "background-color", "#ffffff")
      }
    })

    map.current.on("draw.create", () => updatePolygons(true))
    map.current.on("draw.delete", () => {
      if (isLocked.current) return
      updatePolygons(false)
    })
    map.current.on("draw.update", () => {
      if (isLocked.current) return
      updatePolygons(false)
    })
    map.current.on("draw.selectionchange", () => {
      // Deselect if locked to prevent editing (deferred to avoid infinite loop)
      if (isLocked.current && draw.current) {
        setTimeout(() => {
          draw.current?.changeMode("simple_select", { featureIds: [] })
        }, 0)
      }
    })

    let zoomRafId: number | null = null
    map.current.on("zoom", () => {
      if (zoomRafId) return
      zoomRafId = requestAnimationFrame(() => {
        onZoomChange?.(map.current?.getZoom() ?? 0)
        zoomRafId = null
      })
    })

    // Globe spin: pause on interaction, resume after idle
    const onInteractionStart = () => {
      userInteracting.current = true
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current)
        spinTimeoutRef.current = null
      }
    }
    const onInteractionEnd = () => {
      userInteracting.current = false
      // Resume spinning after a short delay
      spinTimeoutRef.current = setTimeout(() => {
        spinGlobe()
      }, 3000)
    }

    map.current.on("mousedown", onInteractionStart)
    map.current.on("touchstart", onInteractionStart)
    map.current.on("mouseup", onInteractionEnd)
    map.current.on("touchend", onInteractionEnd)
    map.current.on("dragend", onInteractionEnd)
    map.current.on("zoomend", onInteractionEnd)

    // Trigger spin continuously after each ease finishes
    map.current.on("moveend", () => {
      if (!userInteracting.current && spinEnabled.current && map.current!.getZoom() < SPIN_ZOOM_THRESHOLD) {
        spinGlobe()
      }
    })

    // Start the initial spin
    spinGlobe()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (map.current) {
      map.current.setStyle(mapStyle, { diff: true })
    }
  }, [mapStyle])

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />
      <div className="absolute top-4 left-4 z-10">
        <LocationSearch
          accessToken={MAPBOX_ACCESS_TOKEN}
          onSelect={handleLocationSelect}
          onLoadingChange={onLoadingChange}
        />
      </div>

      {/* Area limit warning */}
      {areaWarning && (
        <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-card/95 px-4 py-3 shadow-xl backdrop-blur-sm">
            <svg className="h-4 w-4 shrink-0 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span className="text-sm font-medium text-foreground">{areaWarning}</span>
          </div>
        </div>
      )}
    </div>
  )
})
