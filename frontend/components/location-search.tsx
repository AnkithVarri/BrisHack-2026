"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { MapPin } from "lucide-react"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

interface GeocoderFeature {
  id: string
  place_name: string
  center: [number, number]
}

interface LocationSearchProps {
  onSelect: (center: [number, number], placeName: string) => void
  onLoadingChange?: (isLoading: boolean) => void
}

function formatPhotonPlace(properties: Record<string, string | undefined>): string {
  const parts = [
    properties.name,
    properties.street,
    properties.city || properties.county,
    properties.state,
    properties.country,
  ].filter((part): part is string => Boolean(part))

  return [...new Set(parts)].join(", ")
}

export function LocationSearch({ onSelect, onLoadingChange }: LocationSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GeocoderFeature[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchLocations = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([])
        return
      }

      onLoadingChange?.(true)
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&limit=5`
        )
        const data = await response.json()
        const features = (data.features || []) as Array<{
          geometry?: { coordinates?: [number, number] }
          properties?: Record<string, string | undefined>
        }>
        setResults(
          features
            .filter((feature) => feature.geometry?.coordinates)
            .map((feature, index) => ({
              id: String(feature.properties?.osm_id ?? `${feature.geometry!.coordinates!.join(",")}-${index}`),
              place_name: formatPhotonPlace(feature.properties ?? {}),
              center: feature.geometry!.coordinates!,
            }))
        )
      } catch (error) {
        console.error("Geocoding error:", error)
        setResults([])
      } finally {
        onLoadingChange?.(false)
      }
    },
    [onLoadingChange]
  )

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchLocations(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, searchLocations])

  const handleSelect = (feature: GeocoderFeature) => {
    onSelect(feature.center, feature.place_name)
    setQuery(feature.place_name)
    setIsOpen(false)
    setResults([])
  }

  return (
    <div className="relative w-80">
      <Command className="rounded-2xl border shadow-lg bg-background overflow-hidden" shouldFilter={false}>
        <CommandInput
          placeholder="Search for a location..."
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
        />
        {isOpen && (query.trim() || results.length > 0) && (
          <CommandList>
            {query.trim() && results.length === 0 && (
              <CommandEmpty>No locations found.</CommandEmpty>
            )}
            {results.length > 0 && (
              <CommandGroup heading="Locations">
                {results.map((feature) => (
                  <CommandItem
                    key={feature.id}
                    value={feature.id}
                    onSelect={() => handleSelect(feature)}
                    className="cursor-pointer"
                  >
                    <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{feature.place_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  )
}
